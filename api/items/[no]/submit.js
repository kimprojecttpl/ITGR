import { getSupabase } from "../../../lib/supabase.js";
import { requireAnyRole } from "../../../lib/auth.js";
import { SUBMITTABLE_STATES } from "../../../lib/workflow.js";

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
    .select("status, owner, note, workflow_state")
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
  if (!SUBMITTABLE_STATES.includes(existing.workflow_state)) {
    res.status(409).json({ error: `Cannot submit an item in state "${existing.workflow_state}"` });
    return;
  }
  if (!existing.owner.trim() || !existing.note.trim()) {
    res.status(400).json({ error: "Owner and Evidence must be filled in before submitting" });
    return;
  }

  const newStatus = existing.status === "Not Started" ? "In Progress" : existing.status;

  const { error: updateErr } = await supabase
    .from("item_status")
    .update({
      workflow_state: "Pending Review",
      status: newStatus,
      updated_by: session.sub,
      updated_at: new Date().toISOString(),
    })
    .eq("item_no", itemNo);
  if (updateErr) {
    res.status(500).json({ error: "Failed to submit item" });
    return;
  }

  await supabase.from("item_workflow_events").insert({
    item_no: itemNo,
    actor_id: session.sub,
    from_state: existing.workflow_state,
    to_state: "Pending Review",
  });

  res.status(200).json({ ok: true, workflow_state: "Pending Review" });
}
