import { getSupabase } from "../../lib/supabase.js";
import { requireRole } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const session = requireRole(req, res, "read_only");
  if (!session) return;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("checklist_items")
    .select("*, item_status(status, owner, note, clickup_url, workflow_state, updated_at)")
    .order("no", { ascending: true });

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
    };
  });

  res.status(200).json({ items });
}
