import { getSupabase } from "../../lib/supabase.js";
import { requireRole } from "../../lib/auth.js";

const VALID_STATUSES = ["Not Started", "In Progress", "Compliant", "Partial", "Not Applicable"];
const EDITABLE_FIELDS = ["status", "owner", "note"];

export default async function handler(req, res) {
  if (req.method !== "PATCH") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const session = requireRole(req, res, "read_write");
  if (!session) return;

  const itemNo = Number(req.query.no);
  if (!Number.isInteger(itemNo)) {
    res.status(400).json({ error: "Invalid item number" });
    return;
  }

  const body = req.body || {};
  const updates = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) updates[field] = body[field];
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No editable fields provided" });
    return;
  }
  if (updates.status !== undefined && !VALID_STATUSES.includes(updates.status)) {
    res.status(400).json({ error: "Invalid status value" });
    return;
  }

  const supabase = getSupabase();

  const { data: existing, error: fetchErr } = await supabase
    .from("item_status")
    .select("status, owner, note")
    .eq("item_no", itemNo)
    .maybeSingle();
  if (fetchErr) {
    res.status(500).json({ error: "Failed to load current status" });
    return;
  }
  if (!existing) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  const { error: updateErr } = await supabase
    .from("item_status")
    .update({ ...updates, updated_by: session.sub, updated_at: new Date().toISOString() })
    .eq("item_no", itemNo);
  if (updateErr) {
    res.status(500).json({ error: "Failed to update item" });
    return;
  }

  const auditRows = Object.entries(updates)
    .filter(([field, value]) => existing[field] !== value)
    .map(([field, value]) => ({
      user_id: session.sub,
      item_no: itemNo,
      field,
      old_value: existing[field],
      new_value: value,
    }));
  if (auditRows.length) {
    await supabase.from("audit_log").insert(auditRows);
  }

  res.status(200).json({ ok: true });
}
