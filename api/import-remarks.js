// v1.9 — import the "Remarks Column" from an uploaded copy of the Marubeni
// ITGR checklist workbook (PRD.md § 13).
//
// One-way by design: Marubeni owns the file and shares it read-only, so
// nothing is ever written back. The workbook is uploaded by hand rather
// than fetched from Box, which is why this endpoint needs no Box API, no
// Box Custom App and no stored credentials.
//
// Never touches `status`/`workflow_state`: a Remark is context, not a
// compliance verdict, and only User -> Reviewer -> Approver may set one
// (PRD.md § Goal 6, § 13.2 D2).
import { getSupabase } from "../lib/supabase.js";
import { requireAnyRole } from "../lib/auth.js";
import { parseChecklistRemarks } from "../lib/checklistRemarks.js";

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
  if (typeof data_base64 !== "string" || !data_base64) {
    res.status(400).json({ error: "data_base64 is required" });
    return;
  }

  const buffer = Buffer.from(data_base64, "base64");
  if (buffer.length === 0 || buffer.length > MAX_DECODED_BYTES) {
    res.status(400).json({ error: `File must be between 1 byte and ${MAX_DECODED_BYTES / (1024 * 1024)}MB` });
    return;
  }

  const supabase = getSupabase();

  let remarks;
  try {
    remarks = await parseChecklistRemarks(buffer);
  } catch (e) {
    await logImport(supabase, {
      file_name: file_name || null, items_updated: 0, success: false,
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
        file_name: file_name || null, items_updated: 0, success: false,
        error: upsertErr.message, imported_by: session.sub,
      });
      res.status(500).json({ error: "Failed to save the imported remarks" });
      return;
    }
  }

  await logImport(supabase, {
    file_name: file_name || null, items_updated: changed.length, success: true,
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
