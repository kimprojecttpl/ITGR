// v1.9 — import the "Remarks Column" from an uploaded copy of the Marubeni
// ITGR checklist workbook (PRD.md § 13).
//
// One-way by design: Marubeni owns the file and shares it read-only, so
// nothing is ever written back.
//
// Two ways in, same code path after that:
//   - `data_base64` in the body — the workbook uploaded by hand.
//   - no body — fetch the admin-configured Box shared link directly. This
//     is a plain public download, not the Box API, so it still needs no Box
//     app and no credentials. It only works if Marubeni's link permits
//     download; when it doesn't, the caller falls back to uploading.
//
// Never touches `status`/`workflow_state`: a Remark is context, not a
// compliance verdict, and only User -> Reviewer -> Approver may set one
// (PRD.md § Goal 6, § 13.2 D2).
import { getSupabase } from "../lib/supabase.js";
import { requireAnyRole } from "../lib/auth.js";
import { parseChecklistRemarks, boxDirectDownloadUrl } from "../lib/checklistRemarks.js";

const UNDEFINED_COLUMN = "42703";
const UNDEFINED_TABLE = ["42P01", "PGRST205"];
// Same base64-JSON upload shape as api/items/[no]/evidence.js. The real
// workbook is ~136KB; this cap is generous enough to survive it growing.
const MAX_DECODED_BYTES = 10 * 1024 * 1024;

async function logImport(supabase, row) {
  try {
    await supabase.from("remark_import_log").insert(row);
  } catch {
    // best-effort: a missing audit table must not fail the import itself
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const session = requireAnyRole(req, res, ["marubeni", "admin"]);
  if (!session) return;

  const { file_name, data_base64 } = req.body || {};
  const supabase = getSupabase();

  let buffer;
  let sourceName = file_name || null;

  if (typeof data_base64 === "string" && data_base64) {
    buffer = Buffer.from(data_base64, "base64");
  } else {
    // No file supplied — try the configured Box link.
    const { data: config, error: configErr } = await supabase
      .from("box_checklist_source")
      .select("box_url")
      .eq("id", 1)
      .maybeSingle();
    if (configErr && !UNDEFINED_TABLE.includes(configErr.code)) {
      res.status(500).json({ error: "Failed to load the Box link" });
      return;
    }
    if (!config?.box_url) {
      res.status(400).json({ error: "No Box link is configured yet — an admin can set it in the Admin tab, or upload the file instead" });
      return;
    }
    let downloadUrl;
    try {
      downloadUrl = boxDirectDownloadUrl(config.box_url);
    } catch (e) {
      res.status(400).json({ error: e.message });
      return;
    }
    let resp;
    try {
      resp = await fetch(downloadUrl, { redirect: "follow", signal: AbortSignal.timeout(20000) });
    } catch (e) {
      await logImport(supabase, { file_name: sourceName, items_updated: 0, success: false, error: `fetch failed: ${e.message}`, imported_by: session.sub });
      res.status(502).json({ error: `Could not reach Box: ${e.message}` });
      return;
    }
    if (!resp.ok) {
      const msg = `Box refused the download (HTTP ${resp.status}) — the link may require a login or not allow downloads. Upload the file instead.`;
      await logImport(supabase, { file_name: sourceName, items_updated: 0, success: false, error: msg, imported_by: session.sub });
      res.status(502).json({ error: msg });
      return;
    }
    buffer = Buffer.from(await resp.arrayBuffer());
    sourceName = sourceName || "(fetched from Box)";
  }

  if (buffer.length === 0 || buffer.length > MAX_DECODED_BYTES) {
    res.status(400).json({ error: `File must be between 1 byte and ${MAX_DECODED_BYTES / (1024 * 1024)}MB` });
    return;
  }

  let remarks;
  try {
    remarks = await parseChecklistRemarks(buffer);
  } catch (e) {
    await logImport(supabase, {
      file_name: sourceName, items_updated: 0, success: false,
      error: e.message, imported_by: session.sub,
    });
    res.status(400).json({ error: `Could not read the workbook: ${e.message}` });
    return;
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("item_status")
    .select("item_no, box_remark");
  if (fetchErr) {
    if (fetchErr.code === UNDEFINED_COLUMN || UNDEFINED_TABLE.includes(fetchErr.code)) {
      res.status(501).json({ error: "Remark import (v1.9) is not migrated yet — see supabase/schema.sql" });
      return;
    }
    res.status(500).json({ error: "Failed to load current remarks" });
    return;
  }

  const current = new Map(existing.map((r) => [r.item_no, r.box_remark ?? ""]));
  const now = new Date().toISOString();
  const changed = [];
  const unknown = [];
  for (const [itemNo, remark] of remarks) {
    if (!current.has(itemNo)) {
      unknown.push(itemNo);
      continue;
    }
    // Only touch rows whose text actually differs, so box_remark_at stays a
    // meaningful "when this text last changed" rather than "when someone
    // last ran an import".
    if (current.get(itemNo) !== remark) {
      changed.push({ item_no: itemNo, box_remark: remark, box_remark_at: now });
    }
  }

  if (changed.length) {
    const { error: upsertErr } = await supabase
      .from("item_status")
      .upsert(changed, { onConflict: "item_no" });
    if (upsertErr) {
      await logImport(supabase, {
        file_name: sourceName, items_updated: 0, success: false,
        error: upsertErr.message, imported_by: session.sub,
      });
      res.status(500).json({ error: "Failed to save the imported remarks" });
      return;
    }
  }

  await logImport(supabase, {
    file_name: sourceName, items_updated: changed.length, success: true,
    error: null, imported_by: session.sub,
  });

  res.status(200).json({
    ok: true,
    rows_in_file: remarks.size,
    updated: changed.length,
    unchanged: remarks.size - changed.length - unknown.length,
    unknown_items: unknown,
  });
}
