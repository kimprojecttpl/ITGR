// v1.9 (proposed) — Box.com Remark Sync.
//
// Corrected design (2026-09-09, stakeholder): there is no Box "comment"
// involved at all — the earlier Box-Comments-API design was wrong. What's
// actually wanted is the content of one cell per row in the single master
// checklist workbook (the same "Remarks Column (Reasons for the Check
// Results, etc.)" that scripts/extract-xlsx.py already reads once, offline,
// into self_assessment_note). This file reads/writes that live, so the
// column is located dynamically by its header text — never a hardcoded
// column letter — matching scripts/extract-xlsx.py's own defensive posture
// about the layout drifting between FY workbooks.
//
// No Box Custom App has been authorized yet (PRD.md § 13.6, § 9 — blocking
// open question outside this codebase), so the actual Box download/upload
// calls are still stubs. The xlsx parsing/writing logic below is real and
// tested (against source/Marubeni_Group_IT_Governance_Rules_Checklist_English.xlsx)
// — it's the one part of this feature that doesn't need Box access to build
// or verify.
import ExcelJS from "exceljs";

const CHECKLIST_SHEET_PATTERN = /checklist/i;
const REMARKS_HEADER_PATTERN = /remarks column/i;
const HEADER_ROW = 8;
const FIRST_DATA_ROW = 10; // matches scripts/extract-xlsx.py
const ITGR_TAG = "[ITGR]";

export function isBoxConfigured() {
  return Boolean(
    process.env.BOX_CLIENT_ID && process.env.BOX_CLIENT_SECRET && process.env.BOX_ENTERPRISE_ID
  );
}

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value.richText) return value.richText.map((p) => p.text).join("");
  if (value.text) return value.text;
  return String(value);
}

function findChecklistSheet(workbook) {
  const sheet = workbook.worksheets.find((w) => CHECKLIST_SHEET_PATTERN.test(w.name));
  if (!sheet) throw new Error("No worksheet with 'checklist' in its name was found");
  return sheet;
}

function findRemarksColumn(sheet) {
  for (let c = 1; c <= sheet.columnCount; c++) {
    if (REMARKS_HEADER_PATTERN.test(cellText(sheet.getCell(HEADER_ROW, c).value))) {
      return c;
    }
  }
  throw new Error(`Could not find a "Remarks Column" header in row ${HEADER_ROW}`);
}

// Reads every item's Remarks-column cell from a downloaded workbook buffer.
// Returns a Map<itemNo, remarkText>. Used by the (not yet built) scheduled
// pull job to refresh item_status.box_remark for every item in one pass.
export async function parseChecklistRemarks(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = findChecklistSheet(workbook);
  const col = findRemarksColumn(sheet);

  const remarks = new Map();
  for (let r = FIRST_DATA_ROW; r <= sheet.rowCount; r++) {
    const no = sheet.getCell(r, 1).value;
    if (typeof no !== "number") continue;
    remarks.set(no, cellText(sheet.getCell(r, col).value));
  }
  return remarks;
}

// Appends an `[ITGR] ...` line to one item's Remarks-column cell and returns
// the modified workbook as a new buffer. Deliberately APPENDS rather than
// replaces — the same cell may already carry a human-authored (Marubeni or
// AutoCorp) note, and overwriting it outright would destroy real audit
// text. Throws if the item's row isn't found.
export async function writeChecklistRemark(buffer, itemNo, text) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = findChecklistSheet(workbook);
  const col = findRemarksColumn(sheet);

  for (let r = FIRST_DATA_ROW; r <= sheet.rowCount; r++) {
    if (sheet.getCell(r, 1).value === itemNo) {
      const cell = sheet.getCell(r, col);
      const existing = cellText(cell.value);
      const line = `${ITGR_TAG} ${text}`;
      cell.value = existing ? `${existing}\n${line}` : line;
      return workbook.xlsx.writeBuffer();
    }
  }
  throw new Error(`Item ${itemNo} not found in the checklist workbook (row scan starting at ${FIRST_DATA_ROW})`);
}

// Would fetch the configured single master-checklist file's current bytes
// from Box (resolving the shared link, then downloading its content). Not
// implemented — there is no Box connection to call yet.
export async function downloadChecklistFile(/* boxUrl */) {
  throw new Error(
    "Box integration is not connected yet — BOX_CLIENT_ID/BOX_CLIENT_SECRET/BOX_ENTERPRISE_ID are not set. See PRD.md § 13.6."
  );
}

// Would upload a modified workbook buffer back to Box as a new file version.
// Not implemented for the same reason as downloadChecklistFile above.
export async function uploadChecklistFile(/* boxUrl, buffer */) {
  throw new Error(
    "Box integration is not connected yet — BOX_CLIENT_ID/BOX_CLIENT_SECRET/BOX_ENTERPRISE_ID are not set. See PRD.md § 13.6."
  );
}
