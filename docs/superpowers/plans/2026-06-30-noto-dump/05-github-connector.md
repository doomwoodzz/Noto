# P4 — GitHub Connector

> Read `00-global-constraints.md` and the "Cross-phase function seams" in `overview.md` first. This phase makes Dump's third source — a **GitHub App** connector — work end to end: env + CSP wiring, the connectors list/disconnect router, the App-JWT → installation-token auth helpers, the install/callback OAuth flow (cloned from `auth/google.ts`), the **github** `SourceProvider`, and the repo-picker endpoint. It depends on P0 (tables + `saveConnectorToken`/`getConnectorToken`/`listConnectors`/`deleteConnector` + `RawItem`/`FetchCtx`/`SourceProvider`), P1 (`dumpRouter`, the `cookieUser` guard, the worker), and P2 (the `getProvider` registry at `server/dump/providers/index.ts`).
>
> **Design choice (D8):** GitHub App — install-time *per-repo* consent, read-only `contents`/`metadata`/`issues`, short-lived (~1h) installation tokens minted on demand from the App JWT. We store the **installation_id** (not a long-lived token) and mint a fresh installation token per fetch. P4 and P5 (Notion) are independent and may be built in parallel once P3 is done.
>
> **Hard rules carried from `00-global-constraints.md`:**
> - **Cookie-session ONLY** on `/api/connectors/*` and `/api/dump/github/*` — reuse the `cookieUser(req, res)` guard from P1 (`if (req.apiUser) → 403`; then `getCurrentUser(req)`). The user is **already logged in** when linking a connector.
> - **All connector HTTP** through an SSRF host check (`isPrivateIp` / DNS) — §9. `safeFetch` does GETs but adds no `Authorization` header and takes no POST body, so authenticated/POST GitHub calls go through a thin `ghFetch` wrapper that performs the same host check via `assertPublicHost` and then `fetch` with method/headers/body.
> - **Tokens encrypted at rest** via the keyvault (§8). Installation tokens are ephemeral and never stored; any stored token (the OAuth user token, if retained) is `encryptKey(...)`.
> - **Make every external HTTP injectable** so tests need no network: `signAppJwt(now)` takes `now`; `mintInstallationToken(id, fetchImpl?)`, the provider's `ghClient`, and the repo-list endpoint's client are all injectable.
> - **Least-privilege, gating:** when `!env.githubConfigured || !keyvaultConfigured()` → **503**.

**Files:**
- Modify: `landing/server/env.ts` (GitHub env vars + `githubConfigured`), `landing/server/app.ts` (CSP `connectSrc` + mount `connectorsRouter`), `landing/server/auth/routes.ts` (mount `/github/install` + `/github/callback`), `landing/server/dump/routes.ts` (add `GET /github/repos`), `landing/server/dump/providers/index.ts` (register `github`), `landing/.env.example` (document new vars)
- Create: `landing/server/connectors/routes.ts`, `landing/server/connectors/githubApp.ts`, `landing/server/auth/github.ts`, `landing/server/dump/providers/github.ts`
- Test: `landing/server/connectors/routes.test.ts`, `landing/server/connectors/githubApp.test.ts`, `landing/server/auth/github.test.ts`, `landing/server/dump/providers/github.test.ts`, `landing/server/dump/github-repos.test.ts`

---

## Task 1: Env + CSP + connectors router skeleton

Adds the GitHub env vars and the `githubConfigured` gate (copied verbatim from `00 §17`), opens CSP `connectSrc` to GitHub's hosts, and creates a small cookie-only `connectorsRouter` that lists and disconnects connectors. This is the first runnable surface and proves the cookie-only + 503 gating before any OAuth exists.

**Files:**
- Modify: `landing/server/env.ts`
- Modify: `landing/server/app.ts`
- Modify: `landing/.env.example`
- Create: `landing/server/connectors/routes.ts`
- Test: `landing/server/connectors/routes.test.ts`

- [ ] **Step 1: Add the GitHub env vars + `githubConfigured` to `env.ts`**

In `landing/server/env.ts`, add to the zod `schema` object (right after the `GOOGLE_REDIRECT_URI` field, keeping the Notion vars for P5 — add both blocks now so the schema is stable):
```typescript
  /** GitHub App connector — optional; the feature returns 503 until these are set. */
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),   // PEM (with literal \n or real newlines)
  GITHUB_APP_SLUG: z.string().optional(),          // for the install URL
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_REDIRECT_URI: z.string().url().optional(),
  /** Notion OAuth connector — optional (wired in P5). */
  NOTION_CLIENT_ID: z.string().optional(),
  NOTION_CLIENT_SECRET: z.string().optional(),
  NOTION_REDIRECT_URI: z.string().url().optional(),
```

In the exported `env` object (after `openaiConfigured: Boolean(raw.OPENAI_API_KEY),`), add the two `*Configured` booleans **verbatim** from `00 §17`:
```typescript
  githubConfigured: Boolean(
    raw.GITHUB_APP_ID && raw.GITHUB_APP_PRIVATE_KEY && raw.GITHUB_CLIENT_ID && raw.GITHUB_CLIENT_SECRET && raw.GITHUB_REDIRECT_URI,
  ),
  notionConfigured: Boolean(raw.NOTION_CLIENT_ID && raw.NOTION_CLIENT_SECRET && raw.NOTION_REDIRECT_URI),
```

- [ ] **Step 2: Open CSP `connectSrc` in `app.ts`**

In `landing/server/app.ts`, change the `connectSrc` line (currently `const connectSrc = ["'self'", "https://accounts.google.com"];`) to include the connector hosts (matching `00 §11`; `https://api.notion.com` is included now so P5 needs no further CSP change):
```typescript
  const connectSrc = [
    "'self'",
    "https://accounts.google.com",
    "https://github.com",
    "https://api.github.com",
    "https://api.notion.com",
  ];
```
Leave the `if (!env.isProd) { connectSrc.push("ws:", "http://localhost:5173"); }` block exactly as is, below this.

- [ ] **Step 3: Document the new vars in `.env.example`**

Append to `landing/.env.example` (create the keys if absent; values are placeholders only — never commit real secrets):
```bash
# GitHub App connector (optional — Dump's GitHub source is 503 until all five are set)
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_APP_SLUG=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=
# Notion OAuth connector (optional — wired in a later phase)
NOTION_CLIENT_ID=
NOTION_CLIENT_SECRET=
NOTION_REDIRECT_URI=
```

- [ ] **Step 4: Write the failing integration test**

Create `landing/server/connectors/routes.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { startTestServer, signup, mintToken, makePatClient } from "../test-helpers.ts";

describe("/api/connectors", () => {
  it("returns [] for a user with no connectors", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `c-${crypto.randomUUID()}@t.local`);
      const res = await client.req("GET", "/api/connectors");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    } finally {
      srv.close();
    }
  });

  it("lists a saved connector and disconnects it (204)", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `c2-${crypto.randomUUID()}@t.local`);
      // Resolve this user's id, then seed a connector row directly.
      const me = (await (await client.req("GET", "/api/auth/me")).json()) as { user: { id: string } };
      const { saveConnectorToken } = await import("../db.ts");
      saveConnectorToken({ userId: me.user.id, provider: "github", externalAccount: "octocat", installationId: "42", scopes: "contents:read" });

      const list = await client.req("GET", "/api/connectors");
      const rows = (await list.json()) as { provider: string; externalAccount: string | null }[];
      expect(rows.map((r) => r.provider)).toContain("github");
      expect(rows.find((r) => r.provider === "github")?.externalAccount).toBe("octocat");

      const del = await client.req("DELETE", "/api/connectors/github");
      expect(del.status).toBe(204);
      expect(await (await client.req("GET", "/api/connectors")).json()).toEqual([]);
    } finally {
      srv.close();
    }
  });

  it("rejects PAT auth on connectors (cookie-only → 403)", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `c3-${crypto.randomUUID()}@t.local`);
      const token = await mintToken(client, ["read", "write"]);
      const pat = makePatClient(srv.baseURL, token);
      const res = await pat.req("GET", "/api/connectors");
      expect(res.status).toBe(403);
    } finally {
      srv.close();
    }
  });

  it("rejects an unknown provider on DELETE (400)", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `c4-${crypto.randomUUID()}@t.local`);
      const res = await client.req("DELETE", "/api/connectors/dropbox");
      expect(res.status).toBe(400);
    } finally {
      srv.close();
    }
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd landing && npx vitest run server/connectors/routes.test.ts`
Expected: **FAIL** — `connectorsRouter` is not mounted (`/api/connectors` 404s).

- [ ] **Step 6: Implement `connectors/routes.ts`**

Create `landing/server/connectors/routes.ts` (mirror the `cookieUser` guard pattern from `dump/routes.ts` exactly — cookie-session only):
```typescript
/**
 * Connector management — list + disconnect linked source connectors (GitHub, Notion).
 *
 * Cookie-session ONLY (browser-first; never PAT/MCP-reachable). The OAuth/App
 * install + callback flows live on authRouter (auth/github.ts, auth/notion.ts);
 * this router only reads and revokes the resulting connector_tokens rows.
 */
import express, { type Request, type Response } from "express";
import { getCurrentUser } from "../auth/session.ts";
import { listConnectors, deleteConnector } from "../db.ts";

export const connectorsRouter = express.Router();

const PROVIDERS = new Set(["github", "notion"]);

// Cookie-session ONLY. Connectors are never reachable via PAT/MCP. (Mirrors dump/routes.ts.)
function cookieUser(req: Request, res: Response): string | null {
  if (req.apiUser) { res.status(403).json({ error: "Connectors are not available via API tokens" }); return null; }
  const user = getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return user.id;
}

interface PublicConnector { provider: string; externalAccount: string | null; connectedAt: number }

connectorsRouter.get("/", (req: Request, res: Response) => {
  const uid = cookieUser(req, res); if (!uid) return;
  const out: PublicConnector[] = listConnectors(uid).map((c) => ({
    provider: c.provider,
    externalAccount: c.external_account,
    connectedAt: c.created_at,
  }));
  res.json(out);
});

connectorsRouter.delete("/:provider", (req: Request, res: Response) => {
  const uid = cookieUser(req, res); if (!uid) return;
  const provider = req.params.provider as string;
  if (!PROVIDERS.has(provider)) { res.status(400).json({ error: "Unknown connector" }); return; }
  // This endpoint only revokes the stored token. Purging notes derived from the
  // source is offered separately in the UI disconnect flow (07-ui-client.md), which
  // calls DELETE /api/dump/jobs/:id?purgeNotes=1 for the user's dumps from this source.
  deleteConnector(uid, provider as "github" | "notion");
  res.status(204).end();
});
```

> The `connector_tokens` row never serializes its cipher columns — `PublicConnector` carries only `{provider, externalAccount, connectedAt}`. Never return `access_token_cipher`/`refresh_token_cipher`.

- [ ] **Step 7: Mount the router in `app.ts`**

In `landing/server/app.ts`, add the import near the other routers:
```typescript
import { connectorsRouter } from "./connectors/routes.ts";
```
and mount it right after the dump router (mounted in P1):
```typescript
  app.use("/api/dump", dumpRouter);          // P1
  app.use("/api/connectors", connectorsRouter); // P4
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd landing && npx vitest run server/connectors/routes.test.ts`
Expected: **PASS** (all four cases).

- [ ] **Step 9: Typecheck + lint + commit**

```bash
cd landing && npm run typecheck:server && npx eslint server/connectors/routes.ts server/env.ts server/app.ts
git add landing/server/env.ts landing/server/app.ts landing/.env.example landing/server/connectors/routes.ts landing/server/connectors/routes.test.ts
git commit -m "feat(dump): GitHub env vars + CSP hosts + connectors list/disconnect router"
```

---

## Task 2: GitHub App auth helpers (`connectors/githubApp.ts`)

Pure-`node:crypto` GitHub App authentication: an RS256 App JWT (no `jsonwebtoken` dependency — `00 §12.10` prefers dep-free) and an installation-token minter. The App JWT proves "I am this App"; exchanging it at `/app/installations/<id>/access_tokens` yields a short-lived (~1h) installation token scoped to the installed repos. Both are unit-tested with an in-test RSA keypair and an injected fake `fetch` — **no network**.

**Files:**
- Create: `landing/server/connectors/githubApp.ts`
- Test: `landing/server/connectors/githubApp.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `landing/server/connectors/githubApp.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { signAppJwt, mintInstallationToken } from "./githubApp.ts";

// A throwaway RSA keypair stands in for the GitHub App private key.
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

let savedId: string | undefined;
let savedKey: string | undefined;
beforeEach(() => {
  savedId = process.env.GITHUB_APP_ID;
  savedKey = process.env.GITHUB_APP_PRIVATE_KEY;
  process.env.GITHUB_APP_ID = "123456";
  // Exercise the literal-\n path: store the PEM with escaped newlines.
  process.env.GITHUB_APP_PRIVATE_KEY = PEM.replace(/\n/g, "\\n");
});
afterEach(() => {
  if (savedId === undefined) delete process.env.GITHUB_APP_ID; else process.env.GITHUB_APP_ID = savedId;
  if (savedKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY; else process.env.GITHUB_APP_PRIVATE_KEY = savedKey;
});

describe("signAppJwt", () => {
  it("produces a verifiable RS256 JWT with iss/iat/exp", () => {
    const now = 1_700_000_000;
    const jwt = signAppJwt(now);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload).toEqual({ iat: now - 60, exp: now + 540, iss: "123456" });

    // The signature verifies against the matching public key over `${h}.${p}`.
    const ok = crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });
});

describe("mintInstallationToken", () => {
  it("POSTs to the installation access_tokens endpoint with a Bearer app JWT", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({ token: "ghs_installtoken", expires_at: "2026-01-01T00:00:00Z" }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    };
    const out = await mintInstallationToken("42", fakeFetch);
    expect(out.token).toBe("ghs_installtoken");
    expect(out.expiresAt).toBe(Date.parse("2026-01-01T00:00:00Z"));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.github.com/app/installations/42/access_tokens");
    expect(calls[0].init.method).toBe("POST");
    const headers = new Headers(calls[0].init.headers as HeadersInit);
    expect(headers.get("authorization")).toMatch(/^Bearer eyJ/); // an app JWT
    expect(headers.get("accept")).toBe("application/vnd.github+json");
  });

  it("throws on a non-2xx response", async () => {
    const fakeFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
    await expect(mintInstallationToken("42", fakeFetch)).rejects.toThrow(/GitHub installation token/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd landing && npx vitest run server/connectors/githubApp.test.ts`
Expected: **FAIL** — module not found.

- [ ] **Step 3: Implement `connectors/githubApp.ts`**

Create `landing/server/connectors/githubApp.ts`:
```typescript
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
```

> `ghFetch` is exported so the provider (Task 4) and the repo-list endpoint (Task 5) reuse the **same** SSRF-checked authenticated client. `mintInstallationToken` always signs a fresh App JWT from `Date.now()`; only `signAppJwt` takes an explicit `now` (for deterministic verification).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd landing && npx vitest run server/connectors/githubApp.test.ts`
Expected: **PASS** (signed JWT verifies; token minted; non-2xx throws).

- [ ] **Step 5: Typecheck + lint + commit**

```bash
cd landing && npm run typecheck:server && npx eslint server/connectors/githubApp.ts
git add landing/server/connectors/githubApp.ts landing/server/connectors/githubApp.test.ts
git commit -m "feat(dump): GitHub App JWT + installation-token minting (dep-free, injectable)"
```

---

## Task 3: GitHub App install/callback flow (`auth/github.ts`)

Clones the `auth/google.ts` OAuth template: a signed transient state cookie (HMAC over `SESSION_SECRET`), constant-time state compare, 10-min `httpOnly`+`secure`+`sameSite=lax` cookie. `startGithubInstall` redirects to the App's install page; `handleGithubCallback` verifies state, reads `installation_id` (and exchanges `code` for a user token to read the login identity), then `saveConnectorToken` with the installation id + `external_account=login`. **The user is already authenticated** for connector linking — resolve `getCurrentUser(req)` and reject if absent (unlike Google sign-in, which creates the session).

**Files:**
- Create: `landing/server/auth/github.ts`
- Modify: `landing/server/auth/routes.ts` (mount the two routes)
- Test: `landing/server/auth/github.test.ts`

- [ ] **Step 1: Write the failing gating test**

Create `landing/server/auth/github.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { startTestServer, signup } from "../test-helpers.ts";

describe("GitHub App install flow", () => {
  // env.githubConfigured is false under test (no GITHUB_* vars) → install gates to 503.
  it("503s the install endpoint when GitHub is not configured", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `gh-${crypto.randomUUID()}@t.local`);
      const res = await client.req("GET", "/api/auth/github/install");
      expect(res.status).toBe(503);
    } finally {
      srv.close();
    }
  });

  it("401s the install endpoint when not authenticated", async () => {
    const srv = await startTestServer();
    try {
      // A cookie client that never signed up → no session cookie.
      const { makeCookieClient } = await import("../test-helpers.ts");
      const client = makeCookieClient(srv.baseURL);
      await client.req("GET", "/api/health"); // prime CSRF only
      const res = await client.req("GET", "/api/auth/github/install");
      // Auth is checked before the config gate → 401 (not 503).
      expect(res.status).toBe(401);
    } finally {
      srv.close();
    }
  });

  it("callback fails closed without a valid state cookie (redirect to error)", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `gh2-${crypto.randomUUID()}@t.local`);
      const res = await client.req("GET", "/api/auth/github/callback?installation_id=42&state=bogus");
      // Either 503 (unconfigured) or a 302 redirect to the app with an error — never a 2xx success.
      expect([302, 303, 503]).toContain(res.status);
    } finally {
      srv.close();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd landing && npx vitest run server/auth/github.test.ts`
Expected: **FAIL** — routes not mounted (404, not 503/401).

- [ ] **Step 3: Implement `auth/github.ts`**

Create `landing/server/auth/github.ts`:
```typescript
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
function verifyState(value: string): any | null {
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
```

> `code` may be absent (a pure App install gives only `installation_id`); the connector still works — identity (`external_account`) is best-effort. The `redirect_uri` registered in the GitHub App must point at `/api/auth/github/callback` (the value in `GITHUB_REDIRECT_URI`).

- [ ] **Step 4: Mount the routes on `authRouter`**

In `landing/server/auth/routes.ts`, add the import near the Google one:
```typescript
import { startGithubInstall, handleGithubCallback } from "./github.ts";
```
and add the two routes right after the Google block at the bottom:
```typescript
/* ------------------------------ GitHub App ----------------------------- */
authRouter.get("/github/install", authLimiter, startGithubInstall);
authRouter.get("/github/callback", handleGithubCallback);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd landing && npx vitest run server/auth/github.test.ts`
Expected: **PASS** — 503 when unconfigured, 401 when unauthenticated, callback fails closed.

- [ ] **Step 6: Typecheck + lint + commit**

```bash
cd landing && npm run typecheck:server && npx eslint server/auth/github.ts server/auth/routes.ts
git add landing/server/auth/github.ts landing/server/auth/routes.ts landing/server/auth/github.test.ts
git commit -m "feat(dump): GitHub App install/callback flow (clone of google.ts)"
```

---

## Task 4: The `github` SourceProvider (`dump/providers/github.ts`)

The provider enumerates a repo's prose into `RawItem`s for the shared pipeline. It mints an installation token for the user's stored installation, reads the default branch + recursive tree, filters to prose (`README*`, `*.md`, `/docs/**`, plus an optional glob) **excluding** code/binaries, stops at `ctx.cap` in deterministic path-sorted order, fetches+base64-decodes each file's content, and (optionally) pages issues into one `RawItem` each. The prose filter (`isProsePath`) is a **pure** function tested directly; the provider is tested with an injected fake `ghClient` — **no network**.

**Files:**
- Create: `landing/server/dump/providers/github.ts`
- Modify: `landing/server/dump/providers/index.ts` (register `github`)
- Test: `landing/server/dump/providers/github.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `landing/server/dump/providers/github.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { isProsePath, makeGithubProvider, type GhClient } from "./github.ts";
import type { FetchCtx } from "../types.ts";

describe("isProsePath", () => {
  it("includes README, top-level .md, and docs/**", () => {
    expect(isProsePath("README.md")).toBe(true);
    expect(isProsePath("README")).toBe(true);
    expect(isProsePath("guide.md")).toBe(true);
    expect(isProsePath("docs/architecture.md")).toBe(true);
    expect(isProsePath("docs/sub/deep.markdown")).toBe(true);
  });
  it("excludes code, binaries, lockfiles, and dotfiles", () => {
    expect(isProsePath("src/index.ts")).toBe(false);
    expect(isProsePath("logo.png")).toBe(false);
    expect(isProsePath("package-lock.json")).toBe(false);
    expect(isProsePath("docs/diagram.svg")).toBe(false);
    expect(isProsePath(".github/workflows/ci.yml")).toBe(false);
  });
  it("honors an explicit glob (e.g. notes/**) on top of the prose defaults", () => {
    expect(isProsePath("notes/2026/jan.md", "notes/**")).toBe(true);
    expect(isProsePath("notes/2026/data.csv", "notes/**")).toBe(false); // glob widens path scope, not file types
  });
});

describe("github provider", () => {
  const tree = [
    { path: "README.md", type: "blob", sha: "r1" },
    { path: "docs/intro.md", type: "blob", sha: "d1" },
    { path: "docs/api.md", type: "blob", sha: "d2" },
    { path: "src/index.ts", type: "blob", sha: "s1" }, // excluded
    { path: "logo.png", type: "blob", sha: "p1" },      // excluded
  ];
  const contents: Record<string, string> = {
    "README.md": "# Acme\n\nHello.",
    "docs/intro.md": "# Intro\n\nStart here.",
    "docs/api.md": "# API\n\nEndpoints.",
  };
  function fakeClient(overrides: Partial<GhClient> = {}): GhClient {
    return {
      mintToken: async () => "ghs_test",
      getRepo: async () => ({ default_branch: "main" }),
      getTree: async () => ({ tree, truncated: false }),
      getBlob: async (_token, _repo, path) => ({ contentB64: Buffer.from(contents[path] ?? "").toString("base64") }),
      listIssues: async () => [],
      ...overrides,
    };
  }
  function ctx(cap: number): FetchCtx {
    return { userId: "u1", sourceRef: { repo: "acme/widgets" }, cap, onProgress: () => {} };
  }

  it("yields one RawItem per prose file, code/binaries excluded, in path-sorted order", async () => {
    const provider = makeGithubProvider(fakeClient());
    const items = await provider.fetch(ctx(100));
    expect(items.map((i) => i.origin.path)).toEqual(["README.md", "docs/api.md", "docs/intro.md"]);
    expect(items[0].body).toBe("# Acme\n\nHello.");
    expect(items[0].sourceKey).toBe("github:acme/widgets@r1:README.md");
    expect(items[0].origin).toMatchObject({ type: "github", repo: "acme/widgets", ref: "r1", path: "README.md" });
    expect(items[0].origin.url).toBe("https://github.com/acme/widgets/blob/r1/README.md");
  });

  it("respects ctx.cap (stops after `cap` prose items, deterministic order)", async () => {
    const provider = makeGithubProvider(fakeClient());
    const items = await provider.fetch(ctx(2));
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.origin.path)).toEqual(["README.md", "docs/api.md"]);
  });

  it("includes issues as RawItems when includeIssues is set", async () => {
    const provider = makeGithubProvider(
      fakeClient({
        listIssues: async () => [
          { number: 7, title: "Bug: crash", body: "steps", html_url: "https://github.com/acme/widgets/issues/7", updated_at: "2026-01-02T00:00:00Z" },
        ],
      }),
    );
    const items = await provider.fetch({ userId: "u1", sourceRef: { repo: "acme/widgets", includeIssues: true }, cap: 100, onProgress: () => {} });
    const issue = items.find((i) => i.title.includes("Bug: crash"));
    expect(issue).toBeDefined();
    expect(issue!.sourceKey).toBe("github:acme/widgets#7@2026-01-02T00:00:00Z");
    expect(issue!.origin.url).toBe("https://github.com/acme/widgets/issues/7");
  });

  it("skips a failed blob fetch but keeps the others (partial failure)", async () => {
    const provider = makeGithubProvider(
      fakeClient({
        getBlob: async (_t, _r, path) => {
          if (path === "docs/api.md") throw new Error("500");
          return { contentB64: Buffer.from(contents[path] ?? "").toString("base64") };
        },
      }),
    );
    const items = await provider.fetch(ctx(100));
    expect(items.map((i) => i.origin.path)).toEqual(["README.md", "docs/intro.md"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd landing && npx vitest run server/dump/providers/github.test.ts`
Expected: **FAIL** — module not found.

- [ ] **Step 3: Implement `dump/providers/github.ts`**

Create `landing/server/dump/providers/github.ts`:
```typescript
/**
 * GitHub SourceProvider — enumerate a repo's PROSE into RawItems for the pipeline.
 *
 * Prose only (README*, *.md, /docs/**, + optional glob); code/binaries excluded.
 * The repo tree is read at the default-branch head, filtered, sorted by path
 * (deterministic), and truncated at ctx.cap BEFORE any content fetch (over-cap
 * items never cost a blob read / LLM call). Per-item failures are skipped so the
 * rest of the dump proceeds. All GitHub HTTP is behind an injectable GhClient.
 */
import { mintInstallationToken, ghFetch } from "../../connectors/githubApp.ts";
import { getConnectorToken } from "../../db.ts";
import type { RawItem, SourceProvider, FetchCtx } from "../types.ts";

const GITHUB_API = "https://api.github.com";

interface TreeEntry { path: string; type: string; sha: string }
interface IssueEntry { number: number; title: string; body: string | null; html_url: string; updated_at: string }

/** Injectable GitHub REST surface. Default impl uses ghFetch (SSRF-checked + installation token). */
export interface GhClient {
  mintToken(userId: string): Promise<string>;
  getRepo(token: string, repo: string): Promise<{ default_branch: string }>;
  getTree(token: string, repo: string, ref: string): Promise<{ tree: TreeEntry[]; truncated: boolean }>;
  getBlob(token: string, repo: string, path: string, ref: string): Promise<{ contentB64: string }>;
  listIssues(token: string, repo: string, cap: number): Promise<IssueEntry[]>;
}

const PROSE_NAME = /^(readme(\.(md|markdown|mdx|txt))?|.*\.(md|markdown|mdx))$/i;

/** Glob → RegExp for a leading directory scope like `docs/**` or `notes/**`. */
function globToDirRe(glob: string): RegExp | null {
  const cleaned = glob.trim().replace(/\/\*\*?$/, "");
  if (!cleaned || /[\\]/.test(cleaned)) return null;
  const esc = cleaned.replace(/[.*+?^${}()|[\]]/g, "\\$&");
  return new RegExp(`^${esc}/`, "i");
}

/**
 * Pure prose filter. A path is prose when it is a README / *.md(x) / under docs/,
 * OR (when `glob` is given) under that glob's directory AND still a prose file
 * type. The glob widens the *path scope*, not the allowed file types — so a
 * `notes/**` glob will not pull `notes/data.csv`.
 */
export function isProsePath(path: string, glob?: string): boolean {
  if (path.split("/").some((seg) => seg.startsWith("."))) return false; // skip dotfiles/dirs (.github, .git…)
  const base = path.split("/").pop() ?? path;
  const isProseFile = PROSE_NAME.test(base);
  if (!isProseFile) return false;
  if (/^docs\//i.test(path) || !path.includes("/")) return true; // /docs/** or top-level prose
  if (glob) {
    const dirRe = globToDirRe(glob);
    if (dirRe && dirRe.test(path)) return true;
  }
  return /\.(md|markdown|mdx)$/i.test(path) && /^docs\//i.test(path);
}

function parseRef(ref: unknown): { repo: string; includeIssues: boolean; glob?: string } {
  const r = (ref ?? {}) as { repo?: unknown; includeIssues?: unknown; glob?: unknown };
  const repo = typeof r.repo === "string" ? r.repo : "";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Invalid GitHub repo (expected owner/name)");
  return { repo, includeIssues: r.includeIssues === true, glob: typeof r.glob === "string" ? r.glob : undefined };
}

/** Default GhClient over the SSRF-checked authenticated ghFetch. */
function defaultClient(): GhClient {
  async function getJson<T>(token: string, url: string): Promise<T> {
    const resp = await ghFetch(url, { token, tokenType: "Bearer" });
    if (!resp.ok) throw new Error(`GitHub ${url} → ${resp.status}`);
    return (await resp.json()) as T;
  }
  return {
    async mintToken(userId) {
      const row = getConnectorToken(userId, "github");
      if (!row?.installation_id) throw new Error("GitHub is not connected");
      return (await mintInstallationToken(row.installation_id)).token;
    },
    getRepo: (token, repo) => getJson(token, `${GITHUB_API}/repos/${repo}`),
    getTree: (token, repo, ref) => getJson(token, `${GITHUB_API}/repos/${repo}/git/trees/${ref}?recursive=1`),
    async getBlob(token, repo, path, ref) {
      const json = await getJson<{ content?: string }>(
        token,
        `${GITHUB_API}/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
      );
      return { contentB64: json.content ?? "" };
    },
    async listIssues(token, repo, cap) {
      const out: IssueEntry[] = [];
      for (let page = 1; out.length < cap && page <= 10; page++) {
        const batch = await getJson<(IssueEntry & { pull_request?: unknown })[]>(
          token,
          `${GITHUB_API}/repos/${repo}/issues?state=all&per_page=100&page=${page}`,
        );
        if (batch.length === 0) break;
        for (const i of batch) if (!i.pull_request) out.push(i); // exclude PRs
        if (batch.length < 100) break;
      }
      return out.slice(0, cap);
    },
  };
}

/** Build a github provider over a (possibly fake) client. */
export function makeGithubProvider(client: GhClient = defaultClient()): SourceProvider {
  return {
    async fetch(ctx: FetchCtx): Promise<RawItem[]> {
      const { repo, includeIssues, glob } = parseRef(ctx.sourceRef);
      const token = await client.mintToken(ctx.userId);
      const { default_branch } = await client.getRepo(token, repo);
      const { tree } = await client.getTree(token, repo, default_branch);

      // Deterministic order: path-sorted prose blobs, truncated at cap.
      const prose = tree
        .filter((e) => e.type === "blob" && isProsePath(e.path, glob))
        .sort((a, b) => a.path.localeCompare(b.path))
        .slice(0, ctx.cap);

      const items: RawItem[] = [];
      let fetched = 0;
      for (const entry of prose) {
        try {
          const { contentB64 } = await client.getBlob(token, repo, entry.path, default_branch);
          const body = Buffer.from(contentB64, "base64").toString("utf8");
          items.push({
            sourceKey: `github:${repo}@${entry.sha}:${entry.path}`,
            title: entry.path.split("/").pop() ?? entry.path,
            body,
            origin: {
              type: "github",
              repo,
              path: entry.path,
              ref: entry.sha,
              url: `https://github.com/${repo}/blob/${entry.sha}/${entry.path}`,
            },
          });
          ctx.onProgress(++fetched);
        } catch {
          // Partial failure: skip this file, keep the rest.
        }
      }

      if (includeIssues && items.length < ctx.cap) {
        try {
          const issues = await client.listIssues(token, repo, ctx.cap - items.length);
          for (const issue of issues) {
            items.push({
              sourceKey: `github:${repo}#${issue.number}@${issue.updated_at}`,
              title: `Issue #${issue.number}: ${issue.title}`,
              body: issue.body ?? "",
              origin: { type: "github", repo, path: `issues/${issue.number}`, ref: issue.updated_at, url: issue.html_url },
            });
            ctx.onProgress(++fetched);
          }
        } catch {
          // Issues are best-effort; a listing failure does not fail the dump.
        }
      }

      return items;
    },
  };
}
```

> `parseRef` validates `owner/name` so a malformed `sourceRef` throws a clear auth/fatal error (matching the `SourceProvider` contract: "throw only on auth/fatal errors"). Per-blob and issue-listing failures are caught and skipped (partial failure, per spec §11 "Scale").

- [ ] **Step 4: Register `github` in the provider registry**

In `landing/server/dump/providers/index.ts` (the `getProvider` registry created in P2), import the factory and add the `github` case to the switch:
```typescript
import { makeGithubProvider } from "./github.ts";
// ...inside getProvider(type):
  if (type === "github") return makeGithubProvider();
```
(Keep the existing `raw` case from P2 and the `notion` case slot for P5. The `default` still throws `Unknown source type`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd landing && npx vitest run server/dump/providers/github.test.ts`
Expected: **PASS** — prose filter correct; path-sorted RawItems; cap respected; issues included; partial failure skips one blob.

- [ ] **Step 6: Typecheck + lint + commit**

```bash
cd landing && npm run typecheck:server && npx eslint server/dump/providers/github.ts server/dump/providers/index.ts
git add landing/server/dump/providers/github.ts landing/server/dump/providers/index.ts landing/server/dump/providers/github.test.ts
git commit -m "feat(dump): github SourceProvider (prose filter, cap, issues, partial failure)"
```

---

## Task 5: Repo-picker endpoint (`GET /api/dump/github/repos`)

The modal needs the repos the user's installation can see. Add `GET /api/dump/github/repos` to `dumpRouter` (cookie-only): mint the installation token, `GET /installation/repositories`, return `[{fullName, defaultBranch}]`. Gate on config (503) and connection (409). The GitHub client is injectable so the gating tests run without network.

**Files:**
- Modify: `landing/server/dump/routes.ts` (add the route + an injectable lister)
- Test: `landing/server/dump/github-repos.test.ts`

- [ ] **Step 1: Write the failing gating tests**

Create `landing/server/dump/github-repos.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { startTestServer, signup } from "../test-helpers.ts";

describe("GET /api/dump/github/repos", () => {
  it("503s when GitHub is not configured", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `r-${crypto.randomUUID()}@t.local`);
      const res = await client.req("GET", "/api/dump/github/repos");
      // githubConfigured is false under test → 503 (config gate precedes the connection check).
      expect(res.status).toBe(503);
    } finally {
      srv.close();
    }
  });

  it("rejects PAT auth (cookie-only → 403)", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `r2-${crypto.randomUUID()}@t.local`);
      const { mintToken, makePatClient } = await import("../test-helpers.ts");
      const token = await mintToken(client, ["read", "write"]);
      const pat = makePatClient(srv.baseURL, token);
      const res = await pat.req("GET", "/api/dump/github/repos");
      expect(res.status).toBe(403);
    } finally {
      srv.close();
    }
  });
});
```

> The configured (200) path is covered by the provider unit tests' injected client and a live smoke (DoD); the integration gate here asserts the cookie-only + 503/403 contract without GitHub credentials.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd landing && npx vitest run server/dump/github-repos.test.ts`
Expected: **FAIL** — route not defined (404).

- [ ] **Step 3: Add the route to `dump/routes.ts`**

In `landing/server/dump/routes.ts`, add these imports near the top (alongside the existing P1 imports):
```typescript
import { env } from "../env.ts";
import { keyvaultConfigured } from "../ai/keyvault.ts";
import { getConnectorToken } from "../db.ts";
import { mintInstallationToken, ghFetch, type FetchImpl } from "../connectors/githubApp.ts";
```
Add an injectable lister + the route (place it after the existing `dumpRouter.post("/", ...)` job-create route):
```typescript
const GITHUB_API = "https://api.github.com";

/** List repos the installation can see. Injectable for tests (no network). */
export async function listInstallationRepos(
  installationId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<{ fullName: string; defaultBranch: string }[]> {
  const { token } = await mintInstallationToken(installationId, fetchImpl);
  const out: { fullName: string; defaultBranch: string }[] = [];
  for (let page = 1; page <= 10; page++) {
    const resp = await ghFetch(`${GITHUB_API}/installation/repositories?per_page=100&page=${page}`, { token, tokenType: "Bearer" }, fetchImpl);
    if (!resp.ok) throw new Error(`GitHub repositories → ${resp.status}`);
    const json = (await resp.json()) as { repositories?: { full_name: string; default_branch: string }[] };
    const batch = json.repositories ?? [];
    for (const r of batch) out.push({ fullName: r.full_name, defaultBranch: r.default_branch });
    if (batch.length < 100) break;
  }
  return out;
}

dumpRouter.get("/github/repos", async (req: Request, res: Response) => {
  const uid = cookieUser(req, res); if (!uid) return;
  if (!env.githubConfigured || !keyvaultConfigured()) { res.status(503).json({ error: "GitHub connector is not configured" }); return; }
  const conn = getConnectorToken(uid, "github");
  if (!conn?.installation_id) { res.status(409).json({ error: "GitHub is not connected" }); return; }
  try {
    res.json(await listInstallationRepos(conn.installation_id));
  } catch {
    res.status(502).json({ error: "Could not reach GitHub" });
  }
});
```

> `cookieUser` is the same guard already defined in `dump/routes.ts` (P1) — do **not** redefine it. The config gate (503) is checked **before** the connection gate (409) so an unconfigured server never leaks whether a connector row exists.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd landing && npx vitest run server/dump/github-repos.test.ts`
Expected: **PASS** — 503 unconfigured, 403 on PAT.

- [ ] **Step 5: Full verification + commit**

```bash
cd landing && npm run typecheck:server && npx eslint server/dump/routes.ts && npx vitest run server/dump server/connectors server/auth/github.test.ts && npm run build
git add landing/server/dump/routes.ts landing/server/dump/github-repos.test.ts
git commit -m "feat(dump): GET /api/dump/github/repos (installation repo picker, gated)"
```

---

**P4 done when:**
- `env.githubConfigured` exists (true only when all five `GITHUB_*` vars are set); `.env.example` documents the vars; CSP `connectSrc` includes `https://github.com` + `https://api.github.com`.
- `GET /api/connectors` lists `{provider, externalAccount, connectedAt}` (no cipher columns) and `DELETE /api/connectors/:provider` returns 204; both reject PAT auth (403); unknown providers are 400; an unconnected user gets `[]`.
- `signAppJwt(now)` produces an RS256 JWT that verifies against the App public key with the exact `{iat:now-60, exp:now+540, iss:GITHUB_APP_ID}` payload (literal-`\n` PEM handled); `mintInstallationToken(id, fetchImpl?)` POSTs to `/app/installations/<id>/access_tokens` with a `Bearer` App JWT + `Accept: application/vnd.github+json` and throws on non-2xx — verified with an injected fake fetch (no network).
- `GET /api/auth/github/install` requires login (401), gates on `githubConfigured && keyvaultConfigured()` (503), and redirects to `https://github.com/apps/<slug>/installations/new?state=<signed>`; `GET /api/auth/github/callback` verifies state constant-time, persists `installation_id` + best-effort `external_account` via `saveConnectorToken` (any retained token `encryptKey`'d), and fails closed on bad state — verified by the gating test.
- `isProsePath(path, glob?)` is pure and correct (README/`*.md(x)`/`docs/**` included; code/binaries/lockfiles/dotfiles excluded; glob widens path scope only); the `github` provider yields one `RawItem` per prose file in path-sorted order with `sourceKey github:<owner>/<repo>@<sha>:<path>` + a github-blob `origin.url`, respects `ctx.cap`, optionally pages issues, and skips per-item failures — all via an injected fake `ghClient`. `getProvider("github")` returns it.
- `GET /api/dump/github/repos` is cookie-only (403 on PAT), 503 when unconfigured, 409 when not connected, and `listInstallationRepos(id, fetchImpl?)` is injectable.
- All connector HTTP routes through the SSRF host check (`ghFetch`/`safeFetch`); no `jsonwebtoken` (or any new) dependency added.
- `npm run typecheck:server` passes, `npx eslint` is clean on every new/changed file, the P4 vitest files are green, and `npm run build` exits 0.
