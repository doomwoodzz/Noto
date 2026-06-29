/**
 * CSRF protection — double-submit token + Origin pinning.
 *
 * Layered defence (any one of these alone would mostly suffice; together they
 * are robust):
 *  1. SameSite=Lax session cookie already blocks cross-site POSTs.
 *  2. Double-submit token: a random value is set in a readable (non-httpOnly)
 *     cookie and must be echoed back in the `X-CSRF-Token` header. An attacker
 *     on another origin cannot read the cookie, so cannot forge the header.
 *  3. Origin/Referer pinning: state-changing requests must originate from our
 *     own APP_ORIGIN.
 *
 * Tokens are compared in constant time.
 */
import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { env } from "../env.ts";

const CSRF_COOKIE = "noto_csrf";
const HEADER = "x-csrf-token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Ensure a CSRF cookie exists for this client; returns the token. */
export function ensureCsrfCookie(req: Request, res: Response): string {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token || typeof token !== "string") {
    token = crypto.randomBytes(32).toString("base64url");
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // must be readable by our own JS to echo back
      secure: env.isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60 * 1000,
    });
  }
  return token;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function originAllowed(req: Request): boolean {
  const origin = req.get("origin");
  if (origin) return origin === env.APP_ORIGIN;
  // Some legitimate clients omit Origin; fall back to Referer prefix check.
  const referer = req.get("referer");
  if (referer) return referer.startsWith(env.APP_ORIGIN);
  // No Origin and no Referer on a state-changing request → reject.
  return false;
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (req.apiUser) {            // PAT auth: no cookie, no CSRF surface
    next();
    return;
  }
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (!originAllowed(req)) {
    res.status(403).json({ error: "Bad origin" });
    return;
  }
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(HEADER);
  if (
    !cookieToken ||
    !headerToken ||
    typeof cookieToken !== "string" ||
    typeof headerToken !== "string" ||
    !timingSafeEqualStr(cookieToken, headerToken)
  ) {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }
  next();
}
