// Session issuing/verification for the PIN-login BFF.
// Session = signed JWT { sub: user.id, role, name } in an httpOnly cookie.
import jwt from "jsonwebtoken";
import * as cookie from "cookie";

const COOKIE_NAME = "itgr_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET env var is not set");
  return s;
}

export function signSession(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.display_name },
    secret(),
    { expiresIn: SESSION_TTL_SECONDS }
  );
}

export function verifySessionToken(token) {
  try {
    return jwt.verify(token, secret());
  } catch {
    return null;
  }
}

export function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    cookie.serialize(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== "development",
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    })
  );
}

export function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    cookie.serialize(COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV !== "development",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    })
  );
}

export function getSession(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parsed = cookie.parse(header);
  const token = parsed[COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(token);
}

const ROLE_RANK = { read_only: 0, read_write: 1, admin: 2 };

/**
 * Enforces auth + minimum role for an API handler.
 * Returns the session on success. On failure, writes the error response and
 * returns null — callers must `if (!session) return;` immediately after.
 */
export function requireRole(req, res, minRole) {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  if (ROLE_RANK[session.role] === undefined || ROLE_RANK[session.role] < ROLE_RANK[minRole]) {
    res.status(403).json({ error: "Insufficient permissions" });
    return null;
  }
  return session;
}
