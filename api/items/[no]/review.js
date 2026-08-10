import { getSupabase } from "../../../lib/supabase.js";
import { requireAnyRole } from "../../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const session = requireAnyRole(req, res, ["reviewer", "admin"]);
  if (!session) return;

  const itemNo = Number(req.query.no);
  if (!Number.isInteger(itemNo)) {
    res.status(400).json({ error: "Invalid item number" });
    return;
  }

  const { decision, comment } = req.body || {};
  if (!["ok", "reject"].includes(decision)) {
    res.status(400).json({ error: 'decision must be "ok" or "reject"' });
    return;
  }
  if (decision === "reject" && !(comment || "").trim()) {
    res.status(400).json({ error: "A comment is required when rejecting" });
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
  if (existing.workflow_state !== "Pending Review") {
    res.status(409).json({ error: `Item is not pending review (currently "${existing.workflow_state}")` });
    return;
  }

  const toState = decision === "ok" ? "Pending Approval" : "Rejected";

  const { error: updateErr } = await supabase
    .from("item_status")
    .update({ workflow_state: toState, updated_by: session.sub, updated_at: new Date().toISOString() })
    .eq("item_no", itemNo);
  if (updateErr) {
    res.status(500).json({ error: "Failed to record review" });
    return;
  }

  await supabase.from("item_workflow_events").insert({
    item_no: itemNo,
    actor_id: session.sub,
    from_state: "Pending Review",
    to_state: toState,
    comment: comment || null,
  });

  res.status(200).json({ ok: true, workflow_state: toState });
}
