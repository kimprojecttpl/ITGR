// One-time migration helper: pulls the ITEMS / DRIVE / APPX consts out of the
// legacy index.html and writes them to data/*.json for Supabase seeding.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const html = readFileSync(path.join(root, "index.html"), "utf8");

function extract(constName) {
  const marker = `const ${constName} = `;
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(`could not find ${marker}`);
  const bodyStart = start + marker.length;
  const end = html.indexOf("];", bodyStart);
  if (end === -1) throw new Error(`could not find end of ${constName}`);
  const jsonText = html.slice(bodyStart, end + 1);
  return JSON.parse(jsonText);
}

const items = extract("ITEMS");
const drive = extract("DRIVE");
const appx = extract("APPX");

writeFileSync(path.join(root, "data/items.json"), JSON.stringify(items, null, 2));
writeFileSync(path.join(root, "data/drive.json"), JSON.stringify(drive, null, 2));
writeFileSync(path.join(root, "data/appendices.json"), JSON.stringify(appx, null, 2));

console.log(`items: ${items.length}, drive folders: ${drive.length}, appendices: ${appx.length}`);
