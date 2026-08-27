// PATCH/DELETE /api/admin/tokens/[id] — revoke, rename, rescope, or
// permanently remove an external-API token. Session-authenticated (admin
// only). Deleting is safe for the audit trail: api_request_log.token_id
// references api_tokens ON DELETE SET NULL, so past log rows survive.
import { getSupabase } from "../../../lib/supabase.js";
import { requireRole } from "../../../lib/auth.js";
import { API_SCOPES } from "../../../lib/apiToken.js";

export default async function handler(req, res) {
  const session = requireRole(req, res, "admin");
  if (!session) return;

  const supabase = getSupabase();
  const { id } = req.query;

  if (req.method === "PATCH") {
    const { active, name, scopes, expires_at } = req.body || {};
    const updates = {};
    if (active !== undefined) updates.active = Boolean(active);
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        res.status(400).json({ error: "name must be a non-empty string" });
        return;
      }
      updates.name = name.trim();
    }
    if (scopes !== undefined) {
      if (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every((s) => API_SCOPES.includes(s))) {
        res.status(400).json({ error: `scopes must be a non-empty array from: ${API_SCOPES.join(", ")}` });
        return;
      }
      updates.scopes = scopes;
    }
    if (expires_at !== undefined) {
      if (expires_at === null || expires_at === "") {
        updates.expires_at = null;
      } else {
        const parsed = new Date(expires_at);
        if (Number.isNaN(parsed.getTime())) {
          res.status(400).json({ error: "expires_at must be a valid date" });
          return;
        }
        updates.expires_at = parsed.toISOString();
      }
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No editable fields provided" });
      return;
    }

    const { data, error } = await supabase
      .from("api_tokens")
      .update(updates)
      .eq("id", id)
      .select("id, name, prefix, scopes, active, expires_at")
      .single();
    if (error) {
      res.status(500).json({ error: "Failed to update token" });
      return;
    }
    res.status(200).json({ token: data });
    return;
  }

  if (req.method === "DELETE") {
    const { error } = await supabase.from("api_tokens").delete().eq("id", id);
    if (error) {
      res.status(500).json({ error: "Failed to delete token" });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
