import { getSupabase } from "../../lib/supabase.js";
import { requireRole } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const session = requireRole(req, res, "admin");
  if (!session) return;

  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, item_no, field, old_value, new_value, created_at, users(display_name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    res.status(500).json({ error: "Failed to load audit log" });
    return;
  }

  const entries = data.map((row) => ({
    id: row.id,
    item_no: row.item_no,
    field: row.field,
    old_value: row.old_value,
    new_value: row.new_value,
    created_at: row.created_at,
    user_name: row.users?.display_name ?? "(deleted user)",
  }));

  res.status(200).json({ entries });
}
