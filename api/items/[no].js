import { getSupabase } from "../../lib/supabase.js";
import { requireAnyRole } from "../../lib/auth.js";
import { TERMINAL_STATES } from "../../lib/workflow.js";

const VALID_STATUSES = ["Not Started", "In Progress", "Compliant", "Partial", "Not Compliant"];
// Owner/Evidence(note) are locked once an item reaches a terminal decision
// (v1.4 — reopen via "Request for Approval" instead). ClickUp is exempt —
// it's a reference to external work, not compliance evidence, and stays
// editable regardless of workflow_state.
const LOCKABLE_FIELDS = ["owner", "note"];
const ALWAYS_EDITABLE_FIELDS = ["clickup_url"];

export default async function handler(req, res) {
  if (req.method !== "PATCH") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  // `user` prepares Owner/Evidence/ClickUp; `admin` can override anything
  // (including a direct status change, and editing locked fields) as a
  // break-glass path. `reviewer` and `approver` don't touch these fields —
  // they act only through /review and /approve.
  const session = requireAnyRole(req, res, ["user", "admin"]);
  if (!session) return;

  const itemNo = Number(req.query.no);
  if (!Number.isInteger(itemNo)) {
    res.status(400).json({ error: "Invalid item number" });
    return;
  }

  const supabase = getSupabase();

  const { data: existing, error: fetchErr } = await supabase
    .from("item_status")
    .select("status, owner, note, clickup_url, workflow_state")
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

  const body = req.body || {};
  const isLocked = TERMINAL_STATES.includes(existing.workflow_state);
  const updates = {};

  for (const field of ALWAYS_EDITABLE_FIELDS) {
    if (field in body) updates[field] = body[field];
  }
  for (const field of LOCKABLE_FIELDS) {
    if (field in body) {
      if (isLocked && session.role !== "admin") {
        res.status(403).json({ error: `Item is ${existing.workflow_state} — use "Request for Approval" to reopen it before editing Owner/Evidence` });
        return;
      }
      updates[field] = body[field];
    }
  }
  if ("status" in body) {
    if (session.role !== "admin") {
      res.status(403).json({ error: "Status changes go through the approval workflow, not a direct edit" });
      return;
    }
    if (!VALID_STATUSES.includes(body.status)) {
      res.status(400).json({ error: "Invalid status value" });
      return;
    }
    updates.status = body.status;
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No editable fields provided" });
    return;
  }

  // Quiet UX nicety: a User's first edit on an untouched item moves it out
  // of "Not Started" without requiring a separate manual step.
  if (session.role === "user" && existing.status === "Not Started" && updates.status === undefined) {
    updates.status = "In Progress";
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
