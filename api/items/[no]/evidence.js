import { getSupabase } from "../../../lib/supabase.js";
import { requireAnyRole } from "../../../lib/auth.js";

const BUCKET = "evidence";
// Uploaded as base64 JSON (keeps the frontend dependency-free and the BFF
// as the sole Supabase touchpoint) rather than multipart/direct-to-storage
// — fine for compliance documents (PDF/DOCX/screenshots), but caps well
// under Vercel's serverless request body limit once base64-inflated.
const MAX_DECODED_BYTES = 3 * 1024 * 1024; // 3MB

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const session = requireAnyRole(req, res, ["approver", "admin"]);
  if (!session) return;

  const itemNo = Number(req.query.no);
  if (!Number.isInteger(itemNo)) {
    res.status(400).json({ error: "Invalid item number" });
    return;
  }

  const { file_name, content_type, data_base64 } = req.body || {};
  if (!file_name || typeof data_base64 !== "string" || !data_base64) {
    res.status(400).json({ error: "file_name and data_base64 are required" });
    return;
  }

  let buffer;
  try {
    buffer = Buffer.from(data_base64, "base64");
  } catch {
    res.status(400).json({ error: "data_base64 is not valid base64" });
    return;
  }
  if (buffer.length === 0 || buffer.length > MAX_DECODED_BYTES) {
    res.status(400).json({ error: `File must be between 1 byte and ${MAX_DECODED_BYTES / (1024 * 1024)}MB` });
    return;
  }

  const supabase = getSupabase();

  const { data: item, error: itemErr } = await supabase
    .from("checklist_items")
    .select("no")
    .eq("no", itemNo)
    .maybeSingle();
  if (itemErr || !item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  const safeName = String(file_name).replace(/[^\w.\-]+/g, "_").slice(-120);
  const storagePath = `${itemNo}/${Date.now()}-${safeName}`;

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: content_type || "application/octet-stream" });
  if (uploadErr) {
    res.status(500).json({ error: "Failed to upload file" });
    return;
  }

  const { data: fileRow, error: insertErr } = await supabase
    .from("item_evidence_files")
    .insert({
      item_no: itemNo,
      uploaded_by: session.sub,
      storage_path: storagePath,
      file_name: String(file_name),
      content_type: content_type || null,
    })
    .select("id, file_name, uploaded_at")
    .single();
  if (insertErr) {
    res.status(500).json({ error: "Uploaded but failed to record the file" });
    return;
  }

  res.status(201).json({ file: fileRow });
}
