// v1.9 — where the master checklist workbook lives in Marubeni's Box.
// This is a bookmark, not a connection: nothing here calls Box. It just
// tells whoever runs the Remark import where to download the current copy
// from (PRD.md § 13). GET is readable by anyone who can run an import
// (marubeni/admin); only admin can change it.
import { getSupabase } from "../../lib/supabase.js";
import { requireAnyRole, requireRole } from "../../lib/auth.js";

// Postgres itself would say "42P01" for a genuinely missing table, but
// requests here go through Supabase's PostgREST layer, which maintains its
// own schema cache and fails with its own code ("PGRST205" — "Could not
// find the table ... in the schema cache") before the query ever reaches
// Postgres. Checking both covers either path.
const UNDEFINED_TABLE = ["42P01", "PGRST205"];

export default async function handler(req, res) {
  const supabase = getSupabase();

  if (req.method === "GET") {
    const session = requireAnyRole(req, res, ["marubeni", "admin"]);
    if (!session) return;

    const { data, error } = await supabase
      .from("box_checklist_source")
      .select("box_url, updated_at")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      if (UNDEFINED_TABLE.includes(error.code)) {
        res.status(200).json({ box_url: "", migrated: false });
        return;
      }
      res.status(500).json({ error: "Failed to load Box config" });
      return;
    }
    res.status(200).json({ box_url: data?.box_url ?? "", updated_at: data?.updated_at ?? null, migrated: true });
    return;
  }

  if (req.method === "PUT") {
    const session = requireRole(req, res, "admin");
    if (!session) return;

    const { box_url } = req.body || {};
    if (typeof box_url !== "string") {
      res.status(400).json({ error: "box_url (string) is required" });
      return;
    }

    const { error } = await supabase
      .from("box_checklist_source")
      .upsert({ id: 1, box_url, updated_by: session.sub, updated_at: new Date().toISOString() });
    if (error) {
      if (UNDEFINED_TABLE.includes(error.code)) {
        res.status(501).json({ error: "Box Remark Sync (v1.9) tables are not migrated yet — see supabase/schema.sql" });
        return;
      }
      res.status(500).json({ error: "Failed to save Box config" });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
