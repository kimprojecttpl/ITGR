import { getSupabase } from "../../../lib/supabase.js";
import { requireRole } from "../../../lib/auth.js";
import { hashPin } from "../../../lib/pin.js";

const VALID_ROLES = ["admin", "user", "reviewer", "approver", "read_only"];

export default async function handler(req, res) {
  const session = requireRole(req, res, "admin");
  if (!session) return;

  const supabase = getSupabase();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("users")
      .select("id, display_name, role, active, created_at")
      .order("created_at", { ascending: true });
    if (error) {
      res.status(500).json({ error: "Failed to load users" });
      return;
    }
    res.status(200).json({ users: data });
    return;
  }

  if (req.method === "POST") {
    const { display_name, pin, role } = req.body || {};
    if (typeof display_name !== "string" || !display_name.trim()) {
      res.status(400).json({ error: "display_name is required" });
      return;
    }
    if (!VALID_ROLES.includes(role)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }
    let pin_hash;
    try {
      pin_hash = hashPin(pin);
    } catch (e) {
      res.status(400).json({ error: e.message });
      return;
    }

    const { data, error } = await supabase
      .from("users")
      .insert({ display_name: display_name.trim(), role, pin_hash })
      .select("id, display_name, role, active, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        res.status(409).json({ error: "PIN already in use" });
        return;
      }
      res.status(500).json({ error: "Failed to create user" });
      return;
    }
    res.status(201).json({ user: data });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
