// v1.9 (PROPOSED) — write the item's Remark directly in-app, an alternative
// to leaving a Box comment. Scoped to `marubeni`/`admin` only (PRD.md §
// 13.7) — deliberately NOT `user`/`reviewer`/`approver`, and never touches
// `status`/`workflow_state` (decision D2, § 13.2). This is a pure DB write;
// it does not itself push anything to Box — that's POST .../box-sync.
import { getSupabase } from "../../../lib/supabase.js";
import { requireAnyRole } from "../../../lib/auth.js";

const UNDEFINED_COLUMN = "42703";

export default async function handler(req, res) {
  if (req.method !== "PATCH") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const session = requireAnyRole(req, res, ["marubeni", "admin"]);
  if (!session) return;

  const itemNo = Number(req.query.no);
  if (!Number.isInteger(itemNo)) {
    res.status(400).json({ error: "Invalid item number" });
    return;
  }

  const { remark } = req.body || {};
  if (typeof remark !== "string") {
    res.status(400).json({ error: "remark (string) is required" });
    return;
  }

  const supabase = getSupabase();
  const { data: existing, error: fetchErr } = await supabase
    .from("item_status")
    .select("box_remark")
    .eq("item_no", itemNo)
    .maybeSingle();
  if (fetchErr) {
    if (fetchErr.code === UNDEFINED_COLUMN) {
      res.status(501).json({ error: "Box Remark Sync (v1.9) columns are not migrated yet — see supabase/schema.sql" });
      return;
    }
    res.status(500).json({ error: "Failed to load current remark" });
    return;
  }
  if (!existing) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  const nowIso = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("item_status")
    .update({
      box_remark: remark,
      box_remark_by: session.name || "",
      box_remark_at: nowIso,
      box_remark_source: "app",
      updated_by: session.sub,
      updated_at: nowIso,
    })
    .eq("item_no", itemNo);
  if (updateErr) {
    res.status(500).json({ error: "Failed to save remark" });
    return;
  }

  if (existing.box_remark !== remark) {
    await supabase.from("audit_log").insert({
      user_id: session.sub,
      item_no: itemNo,
      field: "box_remark",
      old_value: existing.box_remark,
      new_value: remark,
    });
  }

  res.status(200).json({ ok: true, box_remark_by: session.name || "", box_remark_at: nowIso, box_remark_source: "app" });
}
