/**
 * GitHub App connector — install + callback. Cloned from auth/google.ts.
 *
 * Unlike Google sign-in (which CREATES a session), connector linking requires an
 * already-authenticated user: we resolve getCurrentUser(req) and reject if absent.
 *
 * Flow:
 *   1. /api/auth/github/install  → require login; gate on githubConfigured +
 *      keyvaultConfigured; stash a signed transient state cookie; redirect to the
 *      App's installation page (per-repo consent happens on GitHub).
 *   2. /api/auth/github/callback → verify state (constant-time); read installation_id
 *      from the query; exchange `code` for a user token to read the login identity;
 *      saveConnectorToken({ provider:'github', installationId, externalAccount:login }),
 *      encrypting any retained token; redirect back into the app.
 */
import type { Request, Response } from "express";
import crypto from "node:crypto";
import { env } from "../env.ts";
import { getCurrentUser } from "./session.ts";
import { saveConnectorToken } from "../db.ts";
import { keyvaultConfigured, encryptKey } from "../ai/keyvault.ts";
import { ghFetch } from "../connectors/githubApp.ts";

const STATE_COOKIE = "noto_gh_oauth";
const INSTALL_BASE = "https://github.com/apps";
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const API_USER = "https://api.github.com/user";
const COOKIE_TTL_MS = 10 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/* ---- tamper-proof transient state cookie (HMAC over the payload) ---- (clone of google.ts) */
function signState(payload: object): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const mac = crypto.createHmac("sha256", env.SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verifyState(value: string): { state?: unknown; userId?: unknown } | null {
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const body = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = crypto.createHmac("sha256", env.SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { state?: unknown; userId?: unknown };
  } catch {
    return null;
  }
}

function fail(res: Response, reason: string): void {
  res.clearCookie(STATE_COOKIE, { path: "/" });
  const url = new URL("/app.html", env.APP_ORIGIN);
  url.searchParams.set("connector", "github");
  url.searchParams.set("error", reason);
  res.redirect(url.toString());
}

export function startGithubInstall(req: Request, res: Response): void {
  // The user must already be authenticated to link a connector.
  const user = getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!env.githubConfigured || !keyvaultConfigured()) {
    res.status(503).json({ error: "GitHub connector is not configured" });
    return;
  }

  // Bind the install round-trip to this user + a random nonce (CSRF for OAuth).
  const state = b64url(crypto.randomBytes(16));
  res.cookie(STATE_COOKIE, signState({ state, userId: user.id }), {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_TTL_MS,
  });

  // GitHub App install page (per-repo consent). `state` round-trips on callback.
  const url = new URL(`${INSTALL_BASE}/${env.GITHUB_APP_SLUG}/installations/new`);
  url.searchParams.set("state", state);
  res.redirect(url.toString());
}

export async function handleGithubCallback(req: Request, res: Response): Promise<void> {
  if (!env.githubConfigured || !keyvaultConfigured()) {
    res.status(503).json({ error: "GitHub connector is not configured" });
    return;
  }

  const cookie = req.cookies?.[STATE_COOKIE];
  const saved = typeof cookie === "string" ? verifyState(cookie) : null;
  res.clearCookie(STATE_COOKIE, { path: "/" });

  const { code, state, installation_id } = req.query;
  if (typeof state !== "string" || typeof installation_id !== "string") return fail(res, "github_params");
  if (!saved || typeof saved.state !== "string" || typeof saved.userId !== "string") return fail(res, "github_state");

  // Constant-time state comparison (CSRF protection for the round-trip).
  const sa = Buffer.from(state);
  const sb = Buffer.from(saved.state);
  if (sa.length !== sb.length || !crypto.timingSafeEqual(sa, sb)) return fail(res, "github_state");

  // The session user must still match the user who started the install.
  const current = getCurrentUser(req);
  if (!current || current.id !== saved.userId) return fail(res, "github_session");

  // Exchange `code` (when present) for a user token to read the GitHub login.
  // The user token is short-lived identity context only; we persist the
  // installation_id (tokens are minted on demand from the App JWT).
  let login: string | null = null;
  let userTokenCipher: Uint8Array | null = null;
  if (typeof code === "string" && code.length > 0) {
    try {
      const body = new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID!,
        client_secret: env.GITHUB_CLIENT_SECRET!,
        code,
        redirect_uri: env.GITHUB_REDIRECT_URI!,
      });
      const tokResp = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
      });
      if (tokResp.ok) {
        const tok = (await tokResp.json()) as { access_token?: string };
        if (tok.access_token) {
          userTokenCipher = encryptKey(tok.access_token);
          const who = await ghFetch(API_USER, { token: tok.access_token, tokenType: "Bearer" });
          if (who.ok) login = ((await who.json()) as { login?: string }).login ?? null;
        }
      }
    } catch {
      // Identity is best-effort — the installation_id is what makes the connector work.
    }
  }

  saveConnectorToken({
    userId: saved.userId,
    provider: "github",
    externalAccount: login,
    installationId: installation_id,
    accessTokenCipher: userTokenCipher,
    scopes: "contents:read,metadata:read,issues:read",
  });

  const url = new URL("/app.html", env.APP_ORIGIN);
  url.searchParams.set("connector", "github");
  url.searchParams.set("connected", "1");
  res.redirect(url.toString());
}
