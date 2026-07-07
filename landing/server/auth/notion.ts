/**
 * Notion OAuth (public integration) — connector linking, not sign-in.
 *
 * The user is ALREADY authenticated (cookie session); this flow grants Noto
 * read access to a set of Notion pages/databases the user selects on Notion's
 * own consent screen. We never see pages the user did not grant.
 *
 *   1. /api/auth/notion/install  → require a current user; build a signed state
 *                                  in a short-lived httpOnly cookie; redirect to
 *                                  Notion's authorize URL (owner=user).
 *   2. /api/auth/notion/callback → verify state (constant-time), exchange the
 *                                  code at Notion's token endpoint using HTTP
 *                                  Basic auth (base64 client_id:client_secret),
 *                                  encrypt the access_token into connector_tokens
 *                                  (provider 'notion', external_account =
 *                                  workspace_name), redirect into the app.
 *
 * The token endpoint is reached server-to-server over TLS; the access token is
 * stored only as AES-256-GCM ciphertext (keyvault) and is never logged.
 */
import type { Request, Response } from "express";
import crypto from "node:crypto";
import { env } from "../env.ts";
import { getCurrentUser } from "./session.ts";
import { saveConnectorToken } from "../db.ts";
import { encryptKey, keyvaultConfigured } from "../ai/keyvault.ts";

const OAUTH_COOKIE = "noto_notion_oauth";
const AUTH_ENDPOINT = "https://api.notion.com/v1/oauth/authorize";
const TOKEN_ENDPOINT = "https://api.notion.com/v1/oauth/token";
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
function verifyState(value: string): { state?: string; userId?: string } | null {
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

function fail(res: Response, reason: string): void {
  res.clearCookie(OAUTH_COOKIE, { path: "/" });
  const url = new URL("/app.html", env.APP_ORIGIN);
  url.searchParams.set("connector", "notion");
  url.searchParams.set("error", reason);
  res.redirect(url.toString());
}

export function startNotionInstall(req: Request, res: Response): void {
  if (!env.notionConfigured || !keyvaultConfigured()) {
    res.status(503).json({ error: "Notion connector is not configured" });
    return;
  }
  const user = getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const state = b64url(crypto.randomBytes(16));
  res.cookie(OAUTH_COOKIE, signState({ state, userId: user.id }), {
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_TTL_MS,
  });

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", env.NOTION_CLIENT_ID!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner", "user");
  url.searchParams.set("redirect_uri", env.NOTION_REDIRECT_URI!);
  url.searchParams.set("state", state);
  res.redirect(url.toString());
}

export async function handleNotionCallback(req: Request, res: Response): Promise<void> {
  if (!env.notionConfigured || !keyvaultConfigured()) {
    res.status(503).json({ error: "Notion connector is not configured" });
    return;
  }

  const cookie = req.cookies?.[OAUTH_COOKIE];
  const saved = typeof cookie === "string" ? verifyState(cookie) : null;
  res.clearCookie(OAUTH_COOKIE, { path: "/" });

  const { code, state } = req.query;
  if (req.query.error || typeof code !== "string" || typeof state !== "string") {
    return fail(res, "oauth_denied");
  }
  if (!saved || typeof saved.state !== "string" || typeof saved.userId !== "string") {
    return fail(res, "oauth_state");
  }
  // Constant-time state comparison (CSRF protection for the OAuth round-trip).
  const sa = Buffer.from(state);
  const sb = Buffer.from(saved.state);
  if (sa.length !== sb.length || !crypto.timingSafeEqual(sa, sb)) {
    return fail(res, "oauth_state");
  }

  // The user must still be the same authenticated session that started the flow.
  const user = getCurrentUser(req);
  if (!user || user.id !== saved.userId) return fail(res, "oauth_session");

  // Exchange the code for a token. Notion uses HTTP Basic auth (client_id:secret)
  // plus a JSON body, reached server-to-server over TLS.
  let tokenJson: {
    access_token?: string;
    workspace_name?: string;
    workspace_id?: string;
    bot_id?: string;
  };
  try {
    const basic = Buffer.from(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`).toString("base64");
    const resp = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Basic ${basic}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: env.NOTION_REDIRECT_URI!,
      }),
    });
    if (!resp.ok) return fail(res, "oauth_token");
    tokenJson = (await resp.json()) as typeof tokenJson;
  } catch {
    return fail(res, "oauth_token");
  }

  if (typeof tokenJson.access_token !== "string" || !tokenJson.access_token) {
    return fail(res, "oauth_token");
  }

  saveConnectorToken({
    userId: user.id,
    provider: "notion",
    externalAccount: tokenJson.workspace_name ?? tokenJson.workspace_id ?? null,
    installationId: tokenJson.workspace_id ?? null,
    accessTokenCipher: encryptKey(tokenJson.access_token),
    scopes: "read",
  });

  const url = new URL("/app.html", env.APP_ORIGIN);
  url.searchParams.set("connector", "notion");
  url.searchParams.set("status", "connected");
  res.redirect(url.toString());
}
