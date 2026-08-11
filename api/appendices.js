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
  const { data, error } = await supabase
    .from("appendices")
    .select("*")
    .order("seq", { ascending: true });

  if (error) {
    res.status(500).json({ error: "Failed to load appendices" });
    return;
  }

  const appendices = data.map((a) => ({
    n: a.id,
    title: a.title,
    titleTh: a.title_th,
    cat: a.cat,
    catShort: a.cat_short,
    catShortTh: a.cat_short_th,
    relatedQ: a.related_q,
    kind: a.kind,
    data: a.data,
    // v1.5 — Thai table rows, same shape as `data`. Empty array means "not
    // translated"; the client falls back to the English rows.
    dataTh: a.data_th ?? [],
    note: a.note ?? "",
    noteTh: a.note_th ?? "",
  }));

  res.status(200).json({ appendices });
}
