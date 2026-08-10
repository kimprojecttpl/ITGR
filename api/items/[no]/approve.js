import { getSupabase } from "../../../lib/supabase.js";
import { requireAnyRole } from "../../../lib/auth.js";
import { DECISION_TO_STATUS, DECISION_TO_WORKFLOW_STATE } from "../../../lib/workflow.js";

const DECISIONS = ["compliant", "complied_with_condition", "not_compliant", "reject"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const session = requireAnyRole(req, res, ["approver", "admin"]);
  if (!session) return;

  const itemNo = Number(req.query.no);
  if (!Number.isInteger(itemNo)) {
    res.status(400).json({ error: "Invalid item number" });
    return;
  }

  const { decision, comment, evidence_file_ids } = req.body || {};
  if (!DECISIONS.includes(decision)) {
    res.status(400).json({ error: `decision must be one of: ${DECISIONS.join(", ")}` });
    return;
  }
  const fileIds = Array.isArray(evidence_file_ids) ? evidence_file_ids.filter(Number.isInteger) : [];
  const hasComment = Boolean((comment || "").trim());

  if (decision === "reject" && !hasComment) {
    res.status(400).json({ error: "A comment is required when rejecting" });
    return;
  }
  if (decision === "complied_with_condition" && !hasComment && fileIds.length === 0) {
    res.status(400).json({ error: "Complied with Condition requires an attached evidence file or a comment" });
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
  if (existing.workflow_state !== "Pending Approval") {
    res.status(409).json({ error: `Item is not pending approval (currently "${existing.workflow_state}")` });
    return;
  }

  if (fileIds.length) {
    const { data: files, error: fileErr } = await supabase
      .from("item_evidence_files")
      .select("id")
      .eq("item_no", itemNo)
      .in("id", fileIds);
    if (fileErr) {
      res.status(500).json({ error: "Failed to verify evidence files" });
      return;
    }
    if ((files || []).length !== fileIds.length) {
      res.status(400).json({ error: "One or more evidence_file_ids do not belong to this item" });
      return;
    }
  }

  const toState = decision === "reject" ? "Rejected" : DECISION_TO_WORKFLOW_STATE[decision];
  const updates = {
    updated_by: session.sub,
    updated_at: new Date().toISOString(),
    workflow_state: toState,
  };
  if (decision !== "reject") {
    updates.status = DECISION_TO_STATUS[decision];
  }

  const { error: updateErr } = await supabase.from("item_status").update(updates).eq("item_no", itemNo);
  if (updateErr) {
    res.status(500).json({ error: "Failed to record decision" });
    return;
  }

  await supabase.from("item_workflow_events").insert({
    item_no: itemNo,
    actor_id: session.sub,
    from_state: "Pending Approval",
    to_state: toState,
    comment: comment || null,
    evidence_file_id: fileIds[0] ?? null,
  });

  res.status(200).json({ ok: true, workflow_state: toState });
}
