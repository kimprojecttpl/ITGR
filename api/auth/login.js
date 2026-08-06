import { getSupabase } from "../../lib/supabase.js";
import { hashPin } from "../../lib/pin.js";
import { signSession, setSessionCookie } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { pin } = req.body || {};
  if (typeof pin !== "string" || !/^\d{4,8}$/.test(pin)) {
    res.status(400).json({ error: "Invalid PIN" });
    return;
  }

  let pinHash;
  try {
    pinHash = hashPin(pin);
  } catch {
    res.status(400).json({ error: "Invalid PIN" });
    return;
  }

  const supabase = getSupabase();
  const { data: user, error } = await supabase
    .from("users")
    .select("id, display_name, role, active")
    .eq("pin_hash", pinHash)
    .maybeSingle();

  // Same generic message whether the PIN doesn't exist, is inactive, or a
  // DB error occurred — avoid leaking which PINs are valid.
  if (error || !user || !user.active) {
    res.status(401).json({ error: "Invalid PIN" });
    return;
  }

  const token = signSession(user);
  setSessionCookie(res, token);
  res.status(200).json({ name: user.display_name, role: user.role });
}
