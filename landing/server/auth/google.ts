/**
 * Google OAuth 2.0 (Authorization Code + PKCE).
 *
 * The button stays inert until GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI are set,
 * so the app runs without credentials. When configured, the full flow is:
 *
 *   1. /api/auth/google         → build state + nonce + PKCE verifier, stash them
 *                                 in a short-lived signed httpOnly cookie, redirect
 *                                 the browser to Google.
 *   2. /api/auth/google/callback → verify state (CSRF for OAuth), exchange the code
 *                                 (with code_verifier) at Google's token endpoint
 *                                 over TLS using our client secret, validate the
 *                                 id_token claims (aud / iss / exp / nonce), upsert
 *                                 the user, open a session, redirect into the app.
 *
 * Because the id_token is received directly from Google's token endpoint over a
 * server-to-server TLS channel authenticated by our client secret, per Google's
 * guidance we validate the claims rather than re-verifying the JWT signature.
 */
import type { Request, Response } from "express";
import crypto from "node:crypto";
import { env } from "../env.ts";
import {
  getUserByGoogleSub,
  getUserByEmail,
  createUser,
  linkGoogleToUser,
} from "../db.ts";
import { createSession } from "./session.ts";

const OAUTH_COOKIE = "noto_oauth";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const COOKIE_TTL_MS = 10 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/* ---- tamper-proof transient state cookie (HMAC over the payload) ---- */
function signState(payload: object): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const mac = crypto.createHmac("sha256", env.SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verifyState(value: string): Record<string, unknown> | null {
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const body = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = crypto.createHmac("sha256", env.SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function startGoogleLogin(_req: Request, res: Response): void {
  if (!env.googleConfigured) {
    res.status(503).json({ error: "Google sign-in is not configured" });
    return;
  }
  const state = b64url(crypto.randomBytes(16));
  const nonce = b64url(crypto.randomBytes(16));
  const codeVerifier = b64url(crypto.randomBytes(32));
  const codeChallenge = b64url(crypto.createHash("sha256").update(codeVerifier).digest());

  res.cookie(OAUTH_COOKIE, signState({ state, nonce, codeVerifier }), {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_TTL_MS,
  });

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  res.redirect(url.toString());
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function fail(res: Response, reason: string): void {
  // Redirect back to the flow with a generic error flag (no internal details).
  res.clearCookie(OAUTH_COOKIE, { path: "/" });
  const url = new URL("/get-started.html", env.APP_ORIGIN);
  url.searchParams.set("error", reason);
  res.redirect(url.toString());
}

export async function handleGoogleCallback(req: Request, res: Response): Promise<void> {
  if (!env.googleConfigured) {
    res.status(503).json({ error: "Google sign-in is not configured" });
    return;
  }

  const cookie = req.cookies?.[OAUTH_COOKIE];
  const saved = typeof cookie === "string" ? verifyState(cookie) : null;
  res.clearCookie(OAUTH_COOKIE, { path: "/" });

  const { code, state } = req.query;
  if (req.query.error || typeof code !== "string" || typeof state !== "string") {
    return fail(res, "oauth_denied");
  }
  if (!saved || typeof saved.state !== "string") return fail(res, "oauth_state");
  // Constant-time state comparison (CSRF protection for the OAuth round-trip).
  const sa = Buffer.from(state);
  const sb = Buffer.from(saved.state);
  if (sa.length !== sb.length || !crypto.timingSafeEqual(sa, sb)) {
    return fail(res, "oauth_state");
  }

  // Exchange the authorization code for tokens.
  let tokenJson: Record<string, unknown>;
  try {
    const body = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      code,
      code_verifier: String(saved.codeVerifier),
      grant_type: "authorization_code",
      redirect_uri: env.GOOGLE_REDIRECT_URI!,
    });
    const resp = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!resp.ok) return fail(res, "oauth_token");
    tokenJson = (await resp.json()) as Record<string, unknown>;
  } catch {
    return fail(res, "oauth_token");
  }

  const idToken = tokenJson.id_token;
  const claims = typeof idToken === "string" ? decodeJwtPayload(idToken) : null;
  if (!claims) return fail(res, "oauth_token");

  // Validate id_token claims.
  const validIss = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (
    !validIss ||
    claims.aud !== env.GOOGLE_CLIENT_ID ||
    typeof claims.exp !== "number" ||
    claims.exp * 1000 < Date.now() ||
    claims.nonce !== saved.nonce
  ) {
    return fail(res, "oauth_claims");
  }
  if (!claims.email || claims.email_verified === false) {
    return fail(res, "oauth_email");
  }

  const sub = String(claims.sub);
  const email = String(claims.email).toLowerCase();
  const name = claims.name ? String(claims.name) : null;
  const picture = claims.picture ? String(claims.picture) : null;

  // Upsert: match on google_sub, else link to an existing email account, else create.
  let user = getUserByGoogleSub(sub);
  if (!user) {
    const existing = getUserByEmail(email);
    if (existing) {
      linkGoogleToUser(existing.id, sub, picture, name);
      user = existing;
    } else {
      user = createUser({
        email,
        googleSub: sub,
        displayName: name,
        avatarUrl: picture,
        emailVerified: true,
      });
    }
  }

  createSession(req, res, user.id);
  res.redirect(new URL("/get-started.html?step=theme", env.APP_ORIGIN).toString());
}
