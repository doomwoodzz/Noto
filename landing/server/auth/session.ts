/**
 * Session management — server-side sessions behind an httpOnly cookie.
 *
 * Noto has no accounts: sessions are minted automatically by ensureLocalSession
 * (auth/localSession.ts) for any cookie-less non-PAT request, and every session
 * resolves to the single local owner. There is no login or logout — sessions
 * simply expire after SESSION_TTL_DAYS (expired rows are dropped on next use
 * here and by the boot-time deleteExpiredSessions() sweep in db.ts).
 *
 * Security model:
 *  - The cookie holds a 256-bit opaque random token. It is NOT a JWT and carries
 *    no data, so it can't be tampered with to escalate privileges.
 *  - Only sha256(token) is stored in the DB. A database leak therefore does not
 *    hand an attacker usable session tokens.
 *  - The cookie is httpOnly (invisible to JS → not stealable via XSS), Secure in
 *    production (HTTPS only), and SameSite=Lax (sent on top-level navigation so
 *    the connector OAuth callbacks work, but not on cross-site sub-requests →
 *    CSRF baseline).
 */
import type { Request, Response } from "express";
import crypto from "node:crypto";
import { env } from "../env.ts";
import {
  insertSession,
  getSession,
  deleteSession,
  getUserById,
  type User,
} from "../db.ts";

const TTL_MS = env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Issue a new session for `userId` and set the cookie on the response. */
export function createSession(req: Request, res: Response, userId: string): void {
  const token = crypto.randomBytes(32).toString("base64url"); // 256 bits of entropy
  const id = hashToken(token);
  const ts = Date.now();
  insertSession({
    id,
    user_id: userId,
    created_at: ts,
    expires_at: ts + TTL_MS,
    user_agent: req.get("user-agent")?.slice(0, 512) ?? null,
    ip: req.ip ?? null,
  });
  res.cookie(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: TTL_MS,
  });
}

/** Resolve the current user from the session cookie, or null. */
export function getCurrentUser(req: Request): User | null {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (!token || typeof token !== "string") return null;
  const session = getSession(hashToken(token));
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    deleteSession(session.id);
    return null;
  }
  return getUserById(session.user_id) ?? null;
}
