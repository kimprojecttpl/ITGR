// PIN hashing — HMAC-SHA256(pin, PIN_PEPPER), hex-encoded.
// A pepper (server-only secret, not per-user) lets us keep a unique index on
// pin_hash for O(1) login lookup while still making offline PIN guessing
// require the pepper, not just the DB dump. This is deliberately NOT bcrypt:
// bcrypt is salted-per-row by design, which rules out an indexed equality
// lookup — for a short numeric PIN, a keyed hash + rate limiting is the
// right tradeoff for an internal tool.
import crypto from "node:crypto";

function pepper() {
  const p = process.env.PIN_PEPPER;
  if (!p) throw new Error("PIN_PEPPER env var is not set");
  return p;
}

export function hashPin(pin) {
  if (!/^\d{4,8}$/.test(pin)) {
    throw new Error("PIN must be 4-8 digits");
  }
  return crypto.createHmac("sha256", pepper()).update(pin).digest("hex");
}

export function pinsEqual(hashA, hashB) {
  const a = Buffer.from(hashA, "hex");
  const b = Buffer.from(hashB, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
