// Runs supabase/schema.sql against a direct Postgres connection — needed for
// DDL (CREATE TABLE/ALTER TABLE), which the Supabase REST API (service role
// key) cannot execute. schema.sql is idempotent, so this is safe to re-run.
//
// Usage: DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres" node scripts/run-migration.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL must be set (Supabase → Project Settings → Database → Connection string, URI, direct connection).");
  process.exit(1);
}

const sql = readFileSync(path.join(root, "supabase/schema.sql"), "utf8");

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  console.log("Migration applied successfully.");
} finally {
  await client.end();
}
