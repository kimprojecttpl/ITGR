// External API token generation/hashing — same construction as lib/pin.js
// (HMAC-SHA256 with a pepper, hex-encoded, indexed for O(1) lookup) but
// keyed with its own pepper (API_TOKEN_PEPPER). Deliberately never shares
// PIN_PEPPER: rotating one secret must never invalidate the other kind of
// credential, and a leaked API token pepper must never help decode PINs.
import crypto from "node:crypto";

const TOKEN_PREFIX = "itgr_live_";
const PREFIX_DISPLAY_LEN = 18; // "itgr_live_" (10) + 8 chars of the random part

export const API_SCOPES = ["items:read", "summary:read", "history:read"];
// Decision D3 (2026-08-27): history:read is NOT in the default set — a new
// token has to opt into reading workflow comments, not receive it for free.
export const DEFAULT_API_SCOPES = ["items:read", "summary:read"];

function pepper() {
  const p = process.env.API_TOKEN_PEPPER;
  if (!p) throw new Error("API_TOKEN_PEPPER env var is not set");
  return p;
}

// Generates a new bearer token. Returns the raw value (shown to the admin
// exactly once — the caller must not persist it anywhere but the hash) and
// the display prefix (safe to store and show repeatedly).
export function generateApiToken() {
  const token = TOKEN_PREFIX + crypto.randomBytes(24).toString("base64url");
  return { token, prefix: token.slice(0, PREFIX_DISPLAY_LEN) };
}

export function hashApiToken(token) {
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX) || token.length < 20) {
    throw new Error("Malformed API token");
  }
  return crypto.createHmac("sha256", pepper()).update(token).digest("hex");
}

export function isValidScope(scope) {
  return API_SCOPES.includes(scope);
}
