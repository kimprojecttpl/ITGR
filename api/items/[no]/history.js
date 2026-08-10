import { getSupabase } from "../../../lib/supabase.js";
import { requireRole } from "../../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const session = requireRole(req, res, "read_only");
  if (!session) return;

  const itemNo = Number(req.query.no);
  if (!Number.isInteger(itemNo)) {
    res.status(400).json({ error: "Invalid item number" });
    return;
  }

  const supabase = getSupabase();
  const [{ data: events, error: eventsErr }, { data: files, error: filesErr }] = await Promise.all([
    supabase
      .from("item_workflow_events")
      .select("id, from_state, to_state, comment, evidence_file_id, created_at, users(display_name)")
      .eq("item_no", itemNo)
      .order("created_at", { ascending: true }),
    supabase
      .from("item_evidence_files")
      .select("id, file_name, content_type, uploaded_at, users(display_name)")
      .eq("item_no", itemNo)
      .order("uploaded_at", { ascending: true }),
  ]);

  if (eventsErr || filesErr) {
    res.status(500).json({ error: "Failed to load history" });
    return;
  }

  res.status(200).json({
    events: (events || []).map((e) => ({
      id: e.id,
      from_state: e.from_state,
      to_state: e.to_state,
      comment: e.comment,
      evidence_file_id: e.evidence_file_id,
      created_at: e.created_at,
      actor_name: e.users?.display_name ?? "(deleted user)",
    })),
    evidence: (files || []).map((f) => ({
      id: f.id,
      file_name: f.file_name,
      content_type: f.content_type,
      uploaded_at: f.uploaded_at,
      uploaded_by_name: f.users?.display_name ?? "(deleted user)",
    })),
  });
}
