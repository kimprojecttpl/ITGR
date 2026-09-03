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

// Writes the audit row for one /api/v1/* call. Called by respond()/
// respondError() BEFORE the response is sent — see the comment on those
// functions for why the ordering is load-bearing, not stylistic.
async function insertLog(req, tokenId, status, startedAt) {
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
    // Logging must never surface as an API-level error.
  }
}

// Logs the request, THEN sends the JSON response.
//
// This ordering was verified the hard way: logging in a try/finally
// *around* res.status().json() — i.e. after the response — dropped roughly
// 8 out of 9 requests in production. Vercel's Node runtime does not
// reliably keep a function alive for awaited work that starts only after
// the response has already been flushed to the client. Logging first, then
// responding, means the insert completes while the function is
// unambiguously still executing — no dependence on any post-response
// guarantee. Every /api/v1/* handler must go through this (or
// respondError) for every exit path, not just the success path.
export async function respond(req, res, tokenId, startedAt, status, body) {
  await insertLog(req, tokenId, status, startedAt);
  res.status(status).json(body);
}

export async function respondError(req, res, tokenId, startedAt, status, code, message, extra) {
  await respond(req, res, tokenId, startedAt, status, { error: { code, message, ...(extra || {}) } });
}

// The one path that can reject a request before any token has been looked
// up (wrong HTTP method) — nothing meaningful to log yet, so this is the
// only response in the external API that isn't audited.
export function methodNotAllowed(res) {
  res.status(405).json({ error: { code: "method_not_allowed", message: "Method not allowed" } });
}

/**
 * Validates the `Authorization: Bearer <token>` header, enforces the
 * required scopes and the per-token rate limit. On success, returns the
 * token row `{ id, name, scopes }`. On ANY failure, sends the error
 * response (logged first, per respondError()) and returns null — callers
 * must `const token = await requireApiToken(...); if (!token) return;`
 * immediately after.
 */
export async function requireApiToken(req, res, requiredScopes, startedAt) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(\S+)$/.exec(header);
  if (!match) {
    await respondError(req, res, null, startedAt, 401, "missing_token", 'Missing or malformed "Authorization: Bearer <token>" header.');
    return null;
  }

  let tokenHash;
  try {
    tokenHash = hashApiToken(match[1]);
  } catch {
    await respondError(req, res, null, startedAt, 401, "invalid_token", "Token is malformed.");
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
    await respondError(req, res, token?.id ?? null, startedAt, 401, "invalid_token", "Token is invalid or has been revoked.");
    return null;
  }
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) {
    await respondError(req, res, token.id, startedAt, 401, "token_expired", "Token has expired.");
    return null;
  }

  const missing = (requiredScopes || []).filter((s) => !token.scopes.includes(s));
  if (missing.length) {
    await respondError(
      req, res, token.id, startedAt, 403, "insufficient_scope",
      `Token is missing required scope(s): ${missing.join(", ")}.`,
      { required_scopes: requiredScopes, token_scopes: token.scopes }
    );
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
    await respondError(
      req, res, token.id, startedAt, 429, "rate_limited",
      `Rate limit exceeded (${RATE_LIMIT_PER_MINUTE} requests/minute). Retry after 60 seconds.`
    );
    return null;
  }

  // Awaited, not fire-and-forget — same reasoning as insertLog() above:
  // work that isn't awaited before this function returns is not reliably
  // completed on this platform once the caller moves on to send a response.
  try {
    await supabase.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", token.id);
  } catch {
    // best-effort — a missed last_used_at bump is not worth failing the request over
  }

  return token;
}
