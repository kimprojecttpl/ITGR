// v1.9 (PROPOSED) — manually trigger a push of the item's current Remark
// into its row's cell in the single, shared master checklist workbook on
// Box, instead of waiting for the automatic push-on-status-change or the
// next scheduled pull (PRD.md § 13.7). Scoped to `marubeni`/`admin` only.
//
// Corrected design (2026-09-09): there is one workbook for the whole
// system (box_checklist_source), not a per-item Box folder — an earlier
// version of this endpoint checked item_status.box_url, which no longer
// exists. No Box Custom App has been authorized yet (§ 13.6, § 9 —
// blocking open question outside this codebase), so this always fails with
// a clear 501 right now. The endpoint still does everything else for real
// — validates the item, resolves the shared workbook link, and writes a
// box_sync_log row — so the only thing left once Box credentials exist is
// implementing downloadChecklistFile()/uploadChecklistFile() in
// lib/boxSync.js (parseChecklistRemarks()/writeChecklistRemark() are
// already built and tested against the real workbook structure).
import { getSupabase } from "../../../lib/supabase.js";
import { requireAnyRole } from "../../../lib/auth.js";
import {
  isBoxConfigured,
  downloadChecklistFile,
  writeChecklistRemark,
  uploadChecklistFile,
} from "../../../lib/boxSync.js";

const UNDEFINED_COLUMN = "42703";
// Requests go through Supabase's PostgREST layer, which fails a missing
// table with its own "PGRST205" before Postgres's own "42P01" ever applies.
const UNDEFINED_TABLE = ["42P01", "PGRST205"];

async function logAttempt(supabase, { itemNo, success, error, triggeredBy }) {
  // box_sync_log/box_checklist_source may not exist yet if this ships
  // before the v1.9 migration runs — don't let a missing audit table break
  // the actual response.
  try {
    await supabase.from("box_sync_log").insert({
      item_no: itemNo,
      direction: "push",
      success,
      error: error || null,
      triggered_by: triggeredBy,
    });
  } catch {
    // best-effort — see comment above
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
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

  const supabase = getSupabase();
  const { data: existing, error: fetchErr } = await supabase
    .from("item_status")
    .select("status, box_remark")
    .eq("item_no", itemNo)
    .maybeSingle();
  if (fetchErr) {
    if (fetchErr.code === UNDEFINED_COLUMN) {
      res.status(501).json({ error: "Box Remark Sync (v1.9) columns are not migrated yet — see supabase/schema.sql" });
      return;
    }
    res.status(500).json({ error: "Failed to load item" });
    return;
  }
  if (!existing) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  const { data: config, error: configErr } = await supabase
    .from("box_checklist_source")
    .select("box_url")
    .eq("id", 1)
    .maybeSingle();
  if (configErr) {
    if (UNDEFINED_TABLE.includes(configErr.code)) {
      res.status(501).json({ error: "Box Remark Sync (v1.9) tables are not migrated yet — see supabase/schema.sql" });
      return;
    }
    res.status(500).json({ error: "Failed to load Box config" });
    return;
  }
  if (!config?.box_url) {
    res.status(400).json({ error: "No Box checklist workbook is configured yet (Admin tab)" });
    return;
  }

  if (!isBoxConfigured()) {
    const message =
      "Box integration is not connected yet — a Box Custom App has not been authorized (PRD.md § 13.6, § 9). Nothing was sent to Box.";
    await logAttempt(supabase, { itemNo, success: false, error: message, triggeredBy: session.sub });
    res.status(501).json({ error: message });
    return;
  }

  // Unreachable until BOX_CLIENT_ID/BOX_CLIENT_SECRET/BOX_ENTERPRISE_ID are
  // set — kept here so the only remaining work, once they are, is
  // implementing the two Box HTTP calls themselves.
  try {
    const buffer = await downloadChecklistFile(config.box_url);
    const updated = await writeChecklistRemark(
      buffer,
      itemNo,
      `Status: ${existing.status}${existing.box_remark ? " — " + existing.box_remark : ""}`
    );
    await uploadChecklistFile(config.box_url, updated);
    await logAttempt(supabase, { itemNo, success: true, triggeredBy: session.sub });
    res.status(200).json({ ok: true });
  } catch (e) {
    await logAttempt(supabase, { itemNo, success: false, error: e.message, triggeredBy: session.sub });
    res.status(502).json({ error: e.message });
  }
}
