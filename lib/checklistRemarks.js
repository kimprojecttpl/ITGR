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

// Downloads the workbook straight from a Box shared link.
//
// This is NOT the Box API — no app, no OAuth, no credentials. It is the
// same anonymous download path a browser uses when someone clicks
// Download on a shared link, so it works whenever Marubeni's link allows
// downloading (`can_download`). If they ever turn that off, this fails and
// the caller falls back to uploading the file by hand.
//
// Two things here are non-obvious and were found the hard way:
//   1. `/shared/static/<hash>.xlsx` — the "direct link" form — returns 403
//      for an ordinary shared link even when downloads are allowed. The
//      working route is the one below, which needs the file's numeric id,
//      and the id only exists in the share page's HTML.
//   2. Box serves 404s to requests without a browser User-Agent, which
//      looks exactly like a dead link. Hence the explicit header.
//
// Host is pinned to app.box.com: the URL comes from an admin-editable
// setting, and fetching an arbitrary admin-supplied URL server-side would
// otherwise be an SSRF hole.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export function parseBoxShareUrl(shareUrl) {
  let url;
  try {
    url = new URL(String(shareUrl).trim());
  } catch {
    throw new Error("The configured Box link is not a valid URL");
  }
  if (url.protocol !== "https:" || url.hostname !== "app.box.com") {
    throw new Error("The configured link must be an https://app.box.com/... shared link");
  }
  // Already a direct-download link — usable as-is.
  if (url.pathname.startsWith("/shared/static/")) return { directUrl: url.toString() };
  const m = url.pathname.match(/^\/s\/([A-Za-z0-9]+)\/?$/);
  if (!m) throw new Error("Expected a shared link like https://app.box.com/s/<id>");
  return { sharedName: m[1], pageUrl: `https://app.box.com/s/${m[1]}` };
}

export async function fetchSharedWorkbook(shareUrl, { timeoutMs = 25000 } = {}) {
  const target = parseBoxShareUrl(shareUrl);

  const get = async (u) => {
    const r = await fetch(u, {
      redirect: "follow",
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r;
  };

  if (target.directUrl) {
    const r = await get(target.directUrl);
    if (!r.ok) throw new Error(`Box returned HTTP ${r.status} for that direct link`);
    return Buffer.from(await r.arrayBuffer());
  }

  const page = await get(target.pageUrl);
  if (!page.ok) {
    throw new Error(`Box returned HTTP ${page.status} for the shared link — check the link is still valid`);
  }
  const html = await page.text();
  const idMatch =
    html.match(/"typedID"\s*:\s*"f_(\d+)"/) || html.match(/"itemID"\s*:\s*(\d+)/);
  if (!idMatch) {
    throw new Error("Could not find a file on that shared link — is it a folder rather than the workbook?");
  }

  const dl = await get(
    `https://app.box.com/index.php?rm=box_download_shared_file&shared_name=${encodeURIComponent(
      target.sharedName
    )}&file_id=f_${idMatch[1]}`
  );
  if (!dl.ok) {
    throw new Error(
      `Box refused the download (HTTP ${dl.status}) — the link may require a login, a password, or have downloads turned off`
    );
  }
  return Buffer.from(await dl.arrayBuffer());
}
