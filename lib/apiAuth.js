// Auth for the external read-only API (/api/v1/*).
//
// Fully separate from the PIN/session login in lib/auth.js: different
// table (api_tokens vs users), different transport (Authorization: Bearer
// header vs httpOnly cookie), different secret (API_TOKEN_PEPPER vs
// PIN_PEPPER/JWT_SECRET). Neither credential works against the other's
// endpoints. No CORS headers are ever set on /api/v1/* responses — that is
// deliberate, not an oversight: it keeps a token from being usable by
// JavaScript running in someone else's browser tab.
import { getSupabase } from "./supabase.js";
import { hashApiToken } from "./apiToken.js";

const RATE_LIMIT_PER_MINUTE = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

export function apiError(res, status, code, message, extra) {
  res.status(status).json({ error: { code, message, ...(extra || {}) } });
}

// Fire-and-forget audit row. Every /api/v1/* call is logged here — including
// rejected auth attempts, via the token_id resolved so far (null if the
// token itself never matched). Logging must never throw into the caller or
// delay the response the caller already sent.
export async function logApiRequest(req, tokenId, status, startedAt) {
  try {
    const supabase = getSupabase();
    await supabase.from("api_request_log").insert({
      token_id: tokenId ?? null,
      path: (req.url || "").split("?")[0],
      query: req.query || {},
      status,
      duration_ms: Date.now() - startedAt,
    });
  } catch {
    // Never let logging failure surface as an API-level error.
  }
}

/**
 * Validates the `Authorization: Bearer <token>` header, enforces the
 * required scopes and the per-token rate limit, and — on ANY failure —
 * writes the error response, logs the attempt, and returns null. Callers
 * must `const token = await requireApiToken(...); if (!token) return;`
 * immediately after.
 *
 * On success, returns the token row `{ id, name, scopes }` and does NOT log
 * yet — the calling handler is responsible for calling `logApiRequest` once
 * it knows the final response status (wrap the handler body in
 * try/finally).
 */
export async function requireApiToken(req, res, requiredScopes, startedAt) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(\S+)$/.exec(header);
  if (!match) {
    apiError(res, 401, "missing_token", 'Missing or malformed "Authorization: Bearer <token>" header.');
    await logApiRequest(req, null, 401, startedAt);
    return null;
  }

  let tokenHash;
  try {
    tokenHash = hashApiToken(match[1]);
  } catch {
    apiError(res, 401, "invalid_token", "Token is malformed.");
    await logApiRequest(req, null, 401, startedAt);
    return null;
  }

  const supabase = getSupabase();
  const { data: token, error } = await supabase
    .from("api_tokens")
    .select("id, name, scopes, active, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  // Same generic-failure posture as lib/pin.js's login check — a DB error
  // and "no such token" must look identical to the caller.
  if (error || !token || !token.active) {
    apiError(res, 401, "invalid_token", "Token is invalid or has been revoked.");
    await logApiRequest(req, token?.id ?? null, 401, startedAt);
    return null;
  }
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) {
    apiError(res, 401, "token_expired", "Token has expired.");
    await logApiRequest(req, token.id, 401, startedAt);
    return null;
  }

  const missing = (requiredScopes || []).filter((s) => !token.scopes.includes(s));
  if (missing.length) {
    apiError(
      res,
      403,
      "insufficient_scope",
      `Token is missing required scope(s): ${missing.join(", ")}.`,
      { required_scopes: requiredScopes, token_scopes: token.scopes }
    );
    await logApiRequest(req, token.id, 403, startedAt);
    return null;
  }

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error: countErr } = await supabase
    .from("api_request_log")
    .select("id", { count: "exact", head: true })
    .eq("token_id", token.id)
    .gte("created_at", since);
  if (!countErr && (count ?? 0) >= RATE_LIMIT_PER_MINUTE) {
    res.setHeader("Retry-After", "60");
    apiError(
      res,
      429,
      "rate_limited",
      `Rate limit exceeded (${RATE_LIMIT_PER_MINUTE} requests/minute). Retry after 60 seconds.`
    );
    await logApiRequest(req, token.id, 429, startedAt);
    return null;
  }

  // Bookkeeping only — never block or fail the request on this.
  (async () => {
    try {
      await supabase.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", token.id);
    } catch {
      // best-effort
    }
  })();

  return token;
}
