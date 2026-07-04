/**
 * GitHub App authentication — dependency-free (node:crypto only).
 *
 * The App JWT (RS256, signed with the App private key) proves "I am this App".
 * Exchanging it at /app/installations/<id>/access_tokens yields a short-lived
 * (~1h) installation token scoped to the installed repo(s) — minted on demand,
 * never stored. The HTTP call is injectable so it is unit-tested without network.
 */
import crypto from "node:crypto";
import { isPrivateIp } from "../links/fetchMeta.ts";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const GITHUB_API = "https://api.github.com";
const ACCEPT_JSON = "application/vnd.github+json";

/** Minimal fetch shape so tests can inject a fake. */
export type FetchImpl = (url: string | URL, init?: RequestInit) => Promise<Response>;

function b64urlJson(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

/** Normalize a PEM stored with literal `\n` (common in single-line env vars). */
function readPrivateKey(): string {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!raw) throw new Error("GITHUB_APP_PRIVATE_KEY is not configured");
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

/**
 * Build a signed App JWT. `now` is epoch SECONDS (injected for deterministic
 * tests). Backdate iat by 60s for clock skew; expire in 9 minutes (GitHub caps
 * App JWTs at 10 minutes).
 */
export function signAppJwt(now: number): string {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) throw new Error("GITHUB_APP_ID is not configured");
  const header = b64urlJson({ alg: "RS256", typ: "JWT" });
  const payload = b64urlJson({ iat: now - 60, exp: now + 540, iss: appId });
  const signingInput = `${header}.${payload}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(readPrivateKey()).toString("base64url");
  return `${signingInput}.${signature}`;
}

/** SSRF host check for an authenticated GitHub call (mirrors safeFetch's assertPublicHost). */
async function assertPublicHost(hostname: string): Promise<void> {
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("Refusing to fetch a private address");
    return;
  }
  const addrs = await lookup(hostname, { all: true });
  if (addrs.length === 0) throw new Error("Host did not resolve");
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error("Refusing to fetch a private address");
}

/**
 * Authenticated GitHub JSON request: SSRF host check + fetch with method/headers/
 * body. Used for the App JWT POST and (by the provider/repo-list) installation-
 * token GETs. safeFetch can't be used here because it adds no Authorization
 * header and takes no POST body. `fetchImpl` defaults to global fetch; injected
 * in tests.
 */
export async function ghFetch(
  url: string,
  init: { method?: string; token: string; tokenType: "Bearer"; body?: string },
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  await assertPublicHost(new URL(url).hostname);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetchImpl(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `${init.tokenType} ${init.token}`,
        Accept: ACCEPT_JSON,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Noto-Dump",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mint a short-lived installation access token for `installationId`. Returns the
 * token + its expiry (epoch ms). `fetchImpl` is injectable for tests.
 */
export async function mintInstallationToken(
  installationId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<{ token: string; expiresAt: number }> {
  const appJwt = signAppJwt(Math.floor(Date.now() / 1000));
  const url = `${GITHUB_API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`;
  const resp = await ghFetch(url, { method: "POST", token: appJwt, tokenType: "Bearer" }, fetchImpl);
  if (!resp.ok) throw new Error(`GitHub installation token request failed (${resp.status})`);
  const json = (await resp.json()) as { token?: string; expires_at?: string };
  if (!json.token) throw new Error("GitHub installation token response missing token");
  return { token: json.token, expiresAt: json.expires_at ? Date.parse(json.expires_at) : Date.now() + 3_600_000 };
}
