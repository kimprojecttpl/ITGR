import { getSupabase } from "../../../lib/supabase.js";
import { requireAnyRole } from "../../../lib/auth.js";
import { TERMINAL_STATES } from "../../../lib/workflow.js";

// v1.4: "Request for Approval" — reopens a terminal item for editing by
// moving it back to In Progress. The item then walks the normal
// Submit -> Review -> Approve flow again from scratch.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
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
    .select("workflow_state")
    .eq("item_no", itemNo)
    .maybeSingle();
  if (fetchErr) {
    res.status(500).json({ error: "Failed to load item" });
    return;
  }
  if (!existing) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!TERMINAL_STATES.includes(existing.workflow_state)) {
    res.status(409).json({ error: `Cannot reopen an item in state "${existing.workflow_state}"` });
    return;
  }

  const { error: updateErr } = await supabase
    .from("item_status")
    .update({
      workflow_state: "In Progress",
      status: "In Progress",
      updated_by: session.sub,
      updated_at: new Date().toISOString(),
    })
    .eq("item_no", itemNo);
  if (updateErr) {
    res.status(500).json({ error: "Failed to reopen item" });
    return;
  }

  await supabase.from("item_workflow_events").insert({
    item_no: itemNo,
    actor_id: session.sub,
    from_state: existing.workflow_state,
    to_state: "In Progress",
    comment: (req.body && req.body.comment) || null,
  });

  res.status(200).json({ ok: true, workflow_state: "In Progress" });
}
