// One-time setup: creates the private Supabase Storage bucket that holds
// Approver-attached evidence files (v1.3). Idempotent — safe to re-run.
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/setup-storage.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const BUCKET = "evidence";

const { data: existing } = await supabase.storage.getBucket(BUCKET);
if (existing) {
  console.log(`Bucket "${BUCKET}" already exists.`);
} else {
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: "5MB",
  });
  if (error) {
    console.error("Failed to create bucket:", error.message);
    process.exit(1);
  }
  console.log(`Created private bucket "${BUCKET}".`);
}
