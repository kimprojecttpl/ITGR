import { getSupabase } from "../../lib/supabase.js";
import { requireRole } from "../../lib/auth.js";

const BUCKET = "evidence";
const SIGNED_URL_TTL_SECONDS = 60;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  // Evidence is part of the compliance record — anyone who can view the
  // dashboard (including read_only) can view attached evidence.
  const session = requireRole(req, res, "read_only");
  if (!session) return;

  const fileId = Number(req.query.id);
  if (!Number.isInteger(fileId)) {
    res.status(400).json({ error: "Invalid file id" });
    return;
  }

  const supabase = getSupabase();
  const { data: file, error: fetchErr } = await supabase
    .from("item_evidence_files")
    .select("storage_path, file_name")
    .eq("id", fileId)
    .maybeSingle();
  if (fetchErr) {
    res.status(500).json({ error: "Failed to load file" });
    return;
  }
  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed) {
    res.status(500).json({ error: "Failed to generate download link" });
    return;
  }

  res.status(200).json({ url: signed.signedUrl, file_name: file.file_name });
}
