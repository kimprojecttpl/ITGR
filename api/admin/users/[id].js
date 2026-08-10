import { getSupabase } from "../../../lib/supabase.js";
import { requireRole } from "../../../lib/auth.js";
import { hashPin } from "../../../lib/pin.js";

const VALID_ROLES = ["admin", "user", "reviewer", "approver", "read_only"];

export default async function handler(req, res) {
  const session = requireRole(req, res, "admin");
  if (!session) return;

  const supabase = getSupabase();
  const { id } = req.query;

  if (req.method === "PATCH") {
    const { role, active, pin, display_name } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        res.status(400).json({ error: "Invalid role" });
        return;
      }
      updates.role = role;
    }
    if (active !== undefined) updates.active = Boolean(active);
    if (display_name !== undefined) updates.display_name = String(display_name).trim();
    if (pin !== undefined) {
      try {
        updates.pin_hash = hashPin(pin);
      } catch (e) {
        res.status(400).json({ error: e.message });
        return;
      }
    }

    // Prevent an admin from locking themselves out by demoting/deactivating
    // the very last active admin account.
    if ((updates.role && updates.role !== "admin") || updates.active === false) {
      const { data: current } = await supabase.from("users").select("role").eq("id", id).single();
      if (current?.role === "admin") {
        const { count } = await supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin")
          .eq("active", true);
        if ((count ?? 0) <= 1) {
          res.status(400).json({ error: "Cannot remove the last active admin" });
          return;
        }
      }
    }

    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", id)
      .select("id, display_name, role, active, created_at")
      .single();

    if (error) {
      res.status(500).json({ error: "Failed to update user" });
      return;
    }
    res.status(200).json({ user: data });
    return;
  }

  if (req.method === "DELETE") {
    const { error } = await supabase.from("users").delete().eq("id", id);
    if (error) {
      res.status(500).json({ error: "Failed to delete user" });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
