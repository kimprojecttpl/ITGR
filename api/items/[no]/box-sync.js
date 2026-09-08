// v1.9 (PROPOSED) — manually trigger a push of the item's current status +
// Remark to its configured Box folder, instead of waiting for the automatic
// push-on-status-change or the next poll cycle (PRD.md § 13.7). Scoped to
// `marubeni`/`admin` only.
//
// No Box Custom App has been authorized yet (§ 13.6, § 9 — blocking open
// question outside this codebase), so this always fails with a clear 501
// right now. The endpoint still does everything else for real — validates
// the item, resolves its box_url, and writes a box_sync_log row — so the
// only thing left once Box credentials exist is filling in the actual API
// call in lib/boxSync.js.
import { getSupabase } from "../../../lib/supabase.js";
import { requireAnyRole } from "../../../lib/auth.js";
import { isBoxConfigured, pushStatusComment } from "../../../lib/boxSync.js";

const UNDEFINED_COLUMN = "42703";

async function logAttempt(supabase, { itemNo, success, error, triggeredBy }) {
  // box_sync_log may not exist yet if this ships before the v1.9 migration
  // runs — don't let a missing audit table break the actual response.
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
    .select("status, box_url, box_remark")
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
  if (!existing.box_url) {
    res.status(400).json({ error: "This item has no Box Folder link configured yet" });
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
  // implementing pushStatusComment() itself.
  try {
    await pushStatusComment(existing.box_url, `[ITGR] สถานะปัจจุบัน: ${existing.status} — ${existing.box_remark || ""}`.trim());
    await logAttempt(supabase, { itemNo, success: true, triggeredBy: session.sub });
    res.status(200).json({ ok: true });
  } catch (e) {
    await logAttempt(supabase, { itemNo, success: false, error: e.message, triggeredBy: session.sub });
    res.status(502).json({ error: e.message });
  }
}
