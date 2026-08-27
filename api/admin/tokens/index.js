// GET/POST /api/admin/tokens — issue and list external-API bearer tokens.
// Session-authenticated (admin only), NOT part of /api/v1/* — an external
// API token can never be used to mint another one.
import { getSupabase } from "../../../lib/supabase.js";
import { requireRole } from "../../../lib/auth.js";
import { generateApiToken, hashApiToken, API_SCOPES, DEFAULT_API_SCOPES } from "../../../lib/apiToken.js";

export default async function handler(req, res) {
  const session = requireRole(req, res, "admin");
  if (!session) return;

  const supabase = getSupabase();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("api_tokens")
      .select("id, name, prefix, scopes, active, expires_at, last_used_at, created_at, users(display_name)")
      .order("created_at", { ascending: true });
    if (error) {
      res.status(500).json({ error: "Failed to load tokens" });
      return;
    }
    res.status(200).json({
      tokens: data.map((t) => ({
        id: t.id,
        name: t.name,
        prefix: t.prefix,
        scopes: t.scopes,
        active: t.active,
        expires_at: t.expires_at,
        last_used_at: t.last_used_at,
        created_at: t.created_at,
        created_by_name: t.users?.display_name ?? null,
      })),
    });
    return;
  }

  if (req.method === "POST") {
    const { name, scopes, expires_at } = req.body || {};
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    let grantedScopes = DEFAULT_API_SCOPES;
    if (scopes !== undefined) {
      if (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every((s) => API_SCOPES.includes(s))) {
        res.status(400).json({ error: `scopes must be a non-empty array from: ${API_SCOPES.join(", ")}` });
        return;
      }
      grantedScopes = scopes;
    }
    let expiresAt = null;
    if (expires_at !== undefined && expires_at !== null && expires_at !== "") {
      const parsed = new Date(expires_at);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: "expires_at must be a valid date" });
        return;
      }
      expiresAt = parsed.toISOString();
    }

    const { token, prefix } = generateApiToken();
    const tokenHash = hashApiToken(token);

    const { data, error } = await supabase
      .from("api_tokens")
      .insert({
        name: name.trim(),
        token_hash: tokenHash,
        prefix,
        scopes: grantedScopes,
        expires_at: expiresAt,
        created_by: session.sub,
      })
      .select("id, name, prefix, scopes, expires_at, created_at")
      .single();
    if (error) {
      res.status(500).json({ error: "Failed to create token" });
      return;
    }

    // The only time the raw value is ever returned. It cannot be recovered
    // afterward — only token_hash is stored.
    res.status(201).json({ token, ...data });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
