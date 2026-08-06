import { requireRole } from "../lib/auth.js";

export default function handler(req, res) {
  const session = requireRole(req, res, "read_only");
  if (!session) return;
  res.status(200).json({ name: session.name, role: session.role });
}
