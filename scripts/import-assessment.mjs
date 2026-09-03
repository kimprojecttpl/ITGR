// Loads the self-assessment recorded in the ITGR workbook (data/assessment.json,
// produced by scripts/extract-xlsx.py) into item_status.
//
//   node --env-file=.env scripts/import-assessment.mjs [--commit]
//
// Runs as a dry run unless --commit is passed.
//
// The answers land in `self_assessment` / `self_assessment_note`, NOT in
// `status`. `status` may only reach a compliance verdict through the
// User -> Reviewer -> Approver workflow; writing 45 "Compliant" rows here
// would fabricate approvals nobody gave. Keeping them apart lets the dashboard
// report Marubeni's official score (computed from the self-assessment, exactly
// as the auditor computes it) while `status` keeps meaning "verified by our
// own approval workflow".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const commit = process.argv.includes("--commit");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const rows = JSON.parse(readFileSync(path.join(root, "data/assessment.json"), "utf8"));
const answered = rows.filter((r) => r.answer);

const tally = answered.reduce((a, r) => ({ ...a, [r.answer]: (a[r.answer] || 0) + 1 }), {});
console.log(`data/assessment.json: ${rows.length} rows, ${answered.length} answered`, tally);
console.log(`remarks present on ${rows.filter((r) => r.remarks).length} items`);

const { error: probeErr } = await supabase.from("item_status").select("self_assessment").limit(1);
if (probeErr?.code === "42703") {
  console.error(
    "\nitem_status.self_assessment does not exist yet — apply the v1.7 block of" +
    "\nsupabase/schema.sql in the Supabase SQL editor first, then re-run."
  );
  process.exit(1);
}

if (!commit) {
  console.log("\nDRY RUN — nothing written. Re-run with --commit to apply.");
  console.log("Sample of what would be written:");
  for (const r of answered.slice(0, 3)) {
    console.log(`  item ${r.no}: ${r.answer}  ${r.remarks.slice(0, 70).replace(/\n/g, " ")}`);
  }
  process.exit(0);
}

let written = 0;
for (const r of rows) {
  const { error } = await supabase
    .from("item_status")
    .update({ self_assessment: r.answer || null, self_assessment_note: r.remarks || "" })
    .eq("item_no", r.no);
  if (error) {
    console.error(`  item ${r.no}: ${error.message}`);
    process.exit(1);
  }
  written++;
}
console.log(`\nWrote self-assessment to ${written} items.`);
