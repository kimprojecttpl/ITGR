import { getSupabase } from "../lib/supabase.js";
import { requireRole } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const session = requireRole(req, res, "read_only");
  if (!session) return;

  const supabase = getSupabase();
  const { data: folders, error } = await supabase
    .from("drive_folders")
    .select("*, drive_files(*)")
    .order("seq", { ascending: true });

  if (error) {
    res.status(500).json({ error: "Failed to load drive index" });
    return;
  }

  const result = folders.map((f) => ({
    n: f.id,
    title: f.title,
    url: f.url,
    files: (f.drive_files || [])
      .sort((a, b) => a.seq - b.seq)
      .map((file) => ({ t: file.title, ty: file.file_type, url: file.url })),
  }));

  res.status(200).json({ folders: result });
}
