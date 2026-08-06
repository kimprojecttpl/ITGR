// Seeds a Supabase project with the ITGR checklist master data extracted to
// data/*.json (run scripts/extract-data.mjs first if those files are stale).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed.mjs
//
// Safe to re-run — every insert is an upsert on the natural key.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

function readJson(name) {
  return JSON.parse(readFileSync(path.join(root, "data", name), "utf8"));
}

async function seedChecklistItems() {
  const items = readJson("items.json");
  const rows = items.map((it) => ({
    no: it.no,
    cat_no: it.catNo,
    category: it.category,
    cat_short: it.catShort,
    cat_short_th: it.catShortTh,
    name: it.name,
    content: it.content,
    standard: it.standard ?? "",
    evidence: it.evidence ?? "",
    article: it.article ?? "",
    issue: it.issue ?? "",
    risk: it.risk ?? "",
    priority: it.priority ?? "",
    qtype: it.qtype ?? "",
  }));
  const { error } = await supabase.from("checklist_items").upsert(rows, { onConflict: "no" });
  if (error) throw error;

  // Seed default (Not Started) item_status rows for any items that don't have one yet.
  const statusRows = items.map((it) => ({ item_no: it.no }));
  const { error: statusErr } = await supabase
    .from("item_status")
    .upsert(statusRows, { onConflict: "item_no", ignoreDuplicates: true });
  if (statusErr) throw statusErr;

  console.log(`checklist_items + item_status: ${rows.length} rows`);
}

async function seedDrive() {
  const drive = readJson("drive.json");
  const folderRows = drive.map((f, i) => ({ id: f.n, seq: i, title: f.title, url: f.url }));
  const { error: folderErr } = await supabase
    .from("drive_folders")
    .upsert(folderRows, { onConflict: "id" });
  if (folderErr) throw folderErr;

  // Files don't have a stable natural key in the legacy data, so replace
  // per-folder on every seed run to stay idempotent.
  for (const f of drive) {
    const { error: delErr } = await supabase.from("drive_files").delete().eq("folder_id", f.n);
    if (delErr) throw delErr;
    const fileRows = (f.files || []).map((file, i) => ({
      folder_id: f.n,
      seq: i,
      title: file.t,
      file_type: file.ty,
      url: file.url,
    }));
    if (fileRows.length) {
      const { error: insErr } = await supabase.from("drive_files").insert(fileRows);
      if (insErr) throw insErr;
    }
  }
  console.log(`drive_folders: ${folderRows.length} rows`);
}

async function seedAppendices() {
  const appx = readJson("appendices.json");
  const rows = appx.map((a, i) => ({
    id: a.n,
    seq: i,
    title: a.title,
    title_th: a.titleTh,
    cat: a.cat,
    cat_short: a.catShort,
    cat_short_th: a.catShortTh,
    related_q: a.relatedQ ?? [],
    kind: a.kind,
    data: a.data,
  }));
  const { error } = await supabase.from("appendices").upsert(rows, { onConflict: "id" });
  if (error) throw error;
  console.log(`appendices: ${rows.length} rows`);
}

await seedChecklistItems();
await seedDrive();
await seedAppendices();
console.log("Seed complete.");
console.log(
  "Next: create the first admin user with `node scripts/create-user.mjs \"Name\" 1234 admin`"
);
