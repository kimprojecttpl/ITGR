// v1.9 — reads the "Remarks Column" out of the Marubeni ITGR checklist
// workbook, so what a reviewer types in that spreadsheet shows up in the
// dashboard without anyone re-typing it.
//
// There is no Box API here on purpose. The workbook lives in Marubeni's Box
// and reaches us as a shared link, which grants read access but not the
// Editor collaboration a write would need — so the sync is one-way and the
// file arrives by upload (PRD.md § 13). That also means no Box Custom App,
// no admin authorization, and no stored credentials.
//
// The column is located by its header text rather than a fixed letter,
// matching scripts/extract-xlsx.py's own caution about the layout drifting
// between FY workbooks.
import ExcelJS from "exceljs";

const CHECKLIST_SHEET_PATTERN = /checklist/i;
const REMARKS_HEADER_PATTERN = /remarks column/i;
const HEADER_ROW = 8;
const FIRST_DATA_ROW = 10; // matches scripts/extract-xlsx.py

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  // Excel stores styled cells as rich text — a plain String() here yields
  // "[object Object]", which is how this silently returns garbage if the
  // workbook's formatting ever changes.
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

// Reads every item's Remarks-column cell from an uploaded workbook buffer.
// Returns a Map<itemNo, remarkText>.
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
  if (remarks.size === 0) {
    throw new Error("No checklist rows found — is this the ITGR checklist workbook?");
  }
  return remarks;
}
