// GET /api/v1/items/{no}/history — workflow timeline for one item.
// See PRD §5 R6 + decision D3. Requires BOTH items:read and history:read —
// workflow comments can name people and describe issues plainly, so a
// token has to opt into this on top of ordinary item access.
//
// Evidence entries are descriptive only: file_name + uploaded_at + who
// uploaded it. No file id, no storage path, no signed URL — per the PRD's
// "no evidence file export" non-goal, this must never be a path to the
// actual file contents. (For context: /api/evidence/[id] that DOES issue
// signed URLs is gated on the PIN-login session cookie, not a bearer
// token, so it's unreachable this way regardless — the omission here is
// defense in depth, not the only thing stopping it.)
import { getSupabase } from "../../../../lib/supabase.js";
import { requireApiToken, respond, respondError, methodNotAllowed } from "../../../../lib/apiAuth.js";

export default async function handler(req, res) {
  const startedAt = Date.now();
  if (req.method !== "GET") {
    methodNotAllowed(res);
    return;
  }
  const token = await requireApiToken(req, res, ["items:read", "history:read"], startedAt);
  if (!token) return;

  const itemNo = Number(req.query.no);
  if (!Number.isInteger(itemNo)) {
    await respondError(req, res, token.id, startedAt, 400, "invalid_item_no", "Item number must be an integer.");
    return;
  }

  const supabase = getSupabase();
  const { data: exists, error: existsErr } = await supabase
    .from("checklist_items")
    .select("no")
    .eq("no", itemNo)
    .maybeSingle();
  if (existsErr) {
    await respondError(req, res, token.id, startedAt, 500, "internal_error", "Failed to load item");
    return;
  }
  if (!exists) {
    await respondError(req, res, token.id, startedAt, 404, "item_not_found", `No checklist item numbered ${itemNo}.`);
    return;
  }

  const [{ data: events, error: eventsErr }, { data: files, error: filesErr }] = await Promise.all([
    supabase
      .from("item_workflow_events")
      .select("from_state, to_state, comment, created_at, users(display_name)")
      .eq("item_no", itemNo)
      .order("created_at", { ascending: true }),
    supabase
      .from("item_evidence_files")
      .select("file_name, uploaded_at, users(display_name)")
      .eq("item_no", itemNo)
      .order("uploaded_at", { ascending: true }),
  ]);
  if (eventsErr || filesErr) {
    await respondError(req, res, token.id, startedAt, 500, "internal_error", "Failed to load history");
    return;
  }

  await respond(req, res, token.id, startedAt, 200, {
    item_no: itemNo,
    events: (events || []).map((e) => ({
      from_state: e.from_state,
      to_state: e.to_state,
      comment: e.comment,
      created_at: e.created_at,
      actor_name: e.users?.display_name ?? "(deleted user)",
    })),
    evidence: (files || []).map((f) => ({
      file_name: f.file_name,
      uploaded_at: f.uploaded_at,
      uploaded_by_name: f.users?.display_name ?? "(deleted user)",
    })),
  });
}
