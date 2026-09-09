import { getSupabase } from "../../lib/supabase.js";
import { requireRole } from "../../lib/auth.js";

const STATUS_COLS = "status, owner, note, clickup_url, workflow_state, updated_at";
// v1.7 columns. Selected separately so this handler keeps working if it is
// deployed before the v1.7 migration has been applied — Vercel ships code and
// Supabase migrations independently, and a hard failure here would take the
// whole dashboard down for every role until the SQL ran.
const STATUS_COLS_V17 = `${STATUS_COLS}, self_assessment, self_assessment_note`;
// v1.9 — the Remark imported from the checklist workbook. Same reasoning,
// one more tier. Read-only in the app: only POST /api/import-remarks writes
// it, so there is no author to record.
const STATUS_COLS_V19 = `${STATUS_COLS_V17}, box_remark, box_remark_at`;
const UNDEFINED_COLUMN = "42703";

async function loadItems(supabase) {
  const query = (cols) =>
    supabase
      .from("checklist_items")
      .select(`*, item_status(${cols})`)
      .order("no", { ascending: true });

  let { data, error } = await query(STATUS_COLS_V19);
  if (error?.code === UNDEFINED_COLUMN) {
    ({ data, error } = await query(STATUS_COLS_V17));
  }
  if (error?.code === UNDEFINED_COLUMN) {
    ({ data, error } = await query(STATUS_COLS));
  }
  return { data, error };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const session = requireRole(req, res, "read_only");
  if (!session) return;

  const supabase = getSupabase();
  const { data, error } = await loadItems(supabase);

  if (error) {
    res.status(500).json({ error: "Failed to load items" });
    return;
  }

  const items = data.map((row) => {
    const {
      item_status,
      cat_no,
      cat_short,
      cat_short_th,
      category_th,
      name_th,
      content_th,
      standard_th,
      evidence_th,
      qtype_th,
      ...item
    } = row;
    const status = Array.isArray(item_status) ? item_status[0] : item_status;
    return {
      ...item,
      catNo: cat_no,
      catShort: cat_short,
      catShortTh: cat_short_th,
      // v1.5 — Thai content for the TH/EN toggle. Empty string means "not
      // translated"; the client falls back to the English field.
      categoryTh: category_th ?? "",
      nameTh: name_th ?? "",
      contentTh: content_th ?? "",
      standardTh: standard_th ?? "",
      evidenceTh: evidence_th ?? "",
      qtypeTh: qtype_th ?? "",
      status: status?.status ?? "Not Started",
      owner: status?.owner ?? "",
      note: status?.note ?? "",
      clickupUrl: status?.clickup_url ?? "",
      workflowState: status?.workflow_state ?? "Not Started",
      selfAssessment: status?.self_assessment ?? "",
      selfAssessmentNote: status?.self_assessment_note ?? "",
      // v1.9
      boxRemark: status?.box_remark ?? "",
      boxRemarkAt: status?.box_remark_at ?? "",
    };
  });

  res.status(200).json({ items });
}
