# P5 — Notion Connector

> Read `00-global-constraints.md`, the "Cross-phase function seams" in `overview.md`, and `05-github-connector.md` first. This phase mirrors the GitHub connector's shape exactly — same `connectorsRouter` mount, same injectable-client + host-checked-fetch pattern, same gating tests — but for **Notion's public OAuth integration**. Notion's own consent screen is the page/database selector, so there is no installation flow; the user grants access to a set of pages/databases and we read only those.
>
> **Dependency policy (locked):** dependency-free. We talk to Notion with a minimal REST client over `fetch`, host-checked via `isPrivateIp` (NOT `@notionhq/client`). This matches the codebase (`fetchMeta.ts`, the GitHub connector in P4) and keeps the bundle clean. `Notion-Version: 2022-06-28` on every call.
>
> **P5 depends on P0–P3 and is independent of P4.** It may be built in parallel with P4 once P3 is done. It reuses, verbatim: `keyvault.ts` (§8), `isPrivateIp` from `fetchMeta.ts` (§9), the OAuth template from `google.ts` (§10), `getCurrentUser` from `session.ts`, the `connector_tokens` accessors from P0 (`saveConnectorToken`/`getConnectorToken`/`listConnectors`/`deleteConnector`), the provider registry seam `getProvider` (P2/`server/dump/providers/index.ts`), and the shared types `SourceProvider`/`RawItem`/`FetchCtx`/`ProvenanceOrigin` (P0/`server/dump/types.ts`).

**Files:**
- Modify: `landing/server/env.ts` (add `NOTION_*` to the zod schema + `notionConfigured`)
- Modify: `landing/.env.example` (document the three vars)
- Modify: `landing/server/app.ts` (add `https://api.notion.com` to CSP `connectSrc`)
- Create: `landing/server/auth/notion.ts` (`startNotionInstall` / `handleNotionCallback`)
- Modify: `landing/server/auth/routes.ts` (mount `/notion/install` + `/notion/callback`)
- Create: `landing/server/connectors/notion.ts` (`makeNotionClient` — injectable REST client)
- Create: `landing/server/dump/blocksToMarkdown.ts` (PURE block → markdown)
- Create: `landing/server/dump/providers/notion.ts` (the `notion` `SourceProvider`)
- Modify: `landing/server/dump/providers/index.ts` (register `notion` in `getProvider`)
- Modify: `landing/server/dump/routes.ts` (add `GET /api/dump/notion/pages`)
- Test: `landing/server/auth/notion.test.ts`, `landing/server/connectors/notion.test.ts`, `landing/server/dump/blocksToMarkdown.test.ts`, `landing/server/dump/providers/notion.test.ts`, `landing/server/dump/notionPages.test.ts`

> **Reuse the GitHub connector's seams, do not re-derive.** P4 already created `server/connectors/routes.ts` (the `connectorsRouter`, mounted at `/api/connectors`) and the `server/dump/providers/index.ts` registry with `raw` + `github` registered. This phase only **adds** to those files. If you are building P5 before P4 lands, the only file P5 strictly needs from P4 is `server/dump/providers/index.ts` (the registry) — `getProvider` is created in P2, so it exists regardless. The page-list endpoint lives on the **dump** router (it is selection UX for a dump), exactly like GitHub's `/api/dump/github/repos`.

---

## Task 1: Env vars + CSP for Notion

**Files:** Modify `landing/server/env.ts`, `landing/.env.example`, `landing/server/app.ts`. (Config wiring — verified by typecheck + a tiny env assertion; no new route yet.)

- [ ] **Step 1: Write the failing test**

Create `landing/server/connectors/notion.test.ts` with just the config assertion for now (the client tests are added in Task 3 — keep this file and append to it):
```typescript
import { describe, it, expect } from "vitest";
import { env } from "../env.ts";

describe("notion env", () => {
  it("exposes a notionConfigured boolean (false under test — no creds)", () => {
    expect(typeof env.notionConfigured).toBe("boolean");
    expect(env.notionConfigured).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd landing && npx vitest run server/connectors/notion.test.ts`
Expected: FAIL — `env.notionConfigured` is `undefined` (`typeof` is `"undefined"`, not `"boolean"`).

- [ ] **Step 3: Add the env vars + boolean**

In `landing/server/env.ts`, add to the zod `schema` object (after the `VAULT_KEY_SECRET` field, mirroring the GitHub block from P4 — keep both connectors' vars adjacent):
```typescript
  /** Notion OAuth (public integration) — optional; the connector is inert until set. */
  NOTION_CLIENT_ID: z.string().optional(),
  NOTION_CLIENT_SECRET: z.string().optional(),
  NOTION_REDIRECT_URI: z.string().url().optional(),
```

Add to the exported `env` object (after `openaiConfigured`, alongside `githubConfigured` from P4):
```typescript
  notionConfigured: Boolean(
    raw.NOTION_CLIENT_ID && raw.NOTION_CLIENT_SECRET && raw.NOTION_REDIRECT_URI,
  ),
```

- [ ] **Step 4: Document in `.env.example`**

Append to `landing/.env.example`:
```bash
# Notion OAuth (public integration). Create at https://www.notion.so/my-integrations
# (type: Public). The redirect URI must exactly match the integration's setting.
NOTION_CLIENT_ID=
NOTION_CLIENT_SECRET=
NOTION_REDIRECT_URI=http://localhost:5173/api/auth/notion/callback
```

- [ ] **Step 5: Add the CSP host in `app.ts`**

In `landing/server/app.ts`, extend `connectSrc`. After P4 this line already includes the GitHub hosts; the final value is:
```typescript
  const connectSrc = ["'self'", "https://accounts.google.com", "https://github.com", "https://api.github.com", "https://api.notion.com"];
```
> If P4 has not landed yet, the current line is `["'self'", "https://accounts.google.com"]` — add `"https://api.notion.com"` (and the GitHub hosts if P4 lands after you). The browser never calls Notion directly (all Notion traffic is server-side), but the connect-src host is added for completeness and parity with the GitHub connector, and harmlessly covers any future client probe.

- [ ] **Step 6: Run the test + typecheck**

Run: `cd landing && npx vitest run server/connectors/notion.test.ts && npm run typecheck:server`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
cd landing && git add server/env.ts .env.example server/app.ts server/connectors/notion.test.ts
git commit -m "feat(dump): Notion env vars + notionConfigured + api.notion.com CSP"
```

---

## Task 2: Notion OAuth (`server/auth/notion.ts`)

**Files:** Create `landing/server/auth/notion.ts`; Modify `landing/server/auth/routes.ts`; Test `landing/server/auth/notion.test.ts`.

This clones `google.ts` (§10): a short-lived signed `httpOnly` state cookie, constant-time state comparison on callback, server-to-server code→token exchange over TLS, and the encrypted token stored in `connector_tokens`. **Differences from Google:** (1) the user is **already authenticated** — resolve `getCurrentUser(req)` and 401 if absent (this links a connector to an existing account, it is not sign-in); (2) the token endpoint uses **HTTP Basic auth** (`base64(client_id:client_secret)`) with a JSON body, per Notion's spec; (3) no PKCE (Notion's public-integration flow does not use it); (4) `owner=user` on the authorize URL; (5) on success we store `access_token` + `workspace_name` and redirect into the app, not into onboarding.

- [ ] **Step 1: Write the failing gating test**

Create `landing/server/auth/notion.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { startTestServer, signup } from "../test-helpers.ts";

describe("notion oauth gating", () => {
  it("503s the install route when the connector is unconfigured", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `n-${crypto.randomUUID()}@t.local`);
      const res = await client.req("GET", "/api/auth/notion/install");
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/not configured/i);
    } finally {
      srv.close();
    }
  });

  it("401s the install route when not authenticated", async () => {
    const srv = await startTestServer();
    try {
      // Bare cookie client with no session (never signed up).
      const { makeCookieClient } = await import("../test-helpers.ts");
      const client = makeCookieClient(srv.baseURL);
      const res = await client.req("GET", "/api/auth/notion/install");
      // Unconfigured short-circuits to 503 before the auth check; assert it is NOT a redirect/200.
      expect([401, 503]).toContain(res.status);
    } finally {
      srv.close();
    }
  });

  it("503s the callback route when unconfigured", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `n2-${crypto.randomUUID()}@t.local`);
      const res = await client.req("GET", "/api/auth/notion/callback?code=x&state=y");
      expect(res.status).toBe(503);
    } finally {
      srv.close();
    }
  });
});
```
> The vitest env sets a valid `VAULT_KEY_SECRET` (keyvault IS configured under test) but no `NOTION_*` vars, so `notionConfigured` is false and both routes 503. The order check (`notionConfigured` before `getCurrentUser`) matches `google.ts`, where the `503` guard is the first statement.

- [ ] **Step 2: Run to verify failure** — `cd landing && npx vitest run server/auth/notion.test.ts` → FAIL (routes not mounted; 404).

- [ ] **Step 3: Implement `server/auth/notion.ts`**

```typescript
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
    secure: env.isProd,
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
```
> `saveConnectorToken` (P0) upserts on `(user_id, provider)`, so re-connecting replaces the prior token cleanly. The `Basic` credential and the access token never touch a log line. The redirect target `/app.html` matches the SPA entry the connectors settings live in (P6); the `connector`/`status`/`error` query params let the client surface a toast.

- [ ] **Step 4: Mount the routes in `auth/routes.ts`**

Add the import alongside the Google one and mount after the Google OAuth routes:
```typescript
import { startNotionInstall, handleNotionCallback } from "./notion.ts";
// ... after the `/google/callback` line:
/* ------------------------------ Notion OAuth --------------------------- */
authRouter.get("/notion/install", startNotionInstall);
authRouter.get("/notion/callback", handleNotionCallback);
```
> No `authLimiter` on the install route: it is gated by an existing cookie session (already rate-limited at the global `/api` ceiling), and the connector is a deliberate user action, not a credential endpoint. This matches how P4 mounts the GitHub install route.

- [ ] **Step 5: Run the gating test** — `cd landing && npx vitest run server/auth/notion.test.ts` → PASS (all three).

- [ ] **Step 6: Typecheck + commit**

```bash
cd landing && npm run typecheck:server
git add server/auth/notion.ts server/auth/routes.ts server/auth/notion.test.ts
git commit -m "feat(dump): Notion OAuth install/callback (encrypted token, gated 503/401)"
```

---

## Task 3: Minimal injectable Notion REST client (`server/connectors/notion.ts`)

**Files:** Create `landing/server/connectors/notion.ts`; Test extend `landing/server/connectors/notion.test.ts`.

A tiny dependency-free client. `makeNotionClient(token, fetchImpl?)` returns `{ search, blockChildren, retrievePage }`. Every request goes through a **host-checked** fetch: the URL host is resolved and rejected if it maps to a private IP (reuse `isPrivateIp` + `node:dns`), the `Notion-Version` header is pinned, and the `Bearer` token is attached. `fetchImpl` is injectable so tests never touch the network (the fake bypasses the host check by being called directly — see the test). All four-hundreds/five-hundreds throw a redacted `Error` so the provider can mark a single page failed without leaking the token.

- [ ] **Step 1: Write the failing tests** (append to `server/connectors/notion.test.ts`)

```typescript
import { makeNotionClient } from "./notion.ts";

describe("notion REST client", () => {
  function fakeFetch(routes: Record<string, unknown>) {
    return async (url: string, init?: RequestInit): Promise<Response> => {
      const key = `${init?.method ?? "GET"} ${new URL(url).pathname}`;
      const body = routes[key];
      if (body === undefined) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  }

  it("retrievePage hits the right URL and returns the page JSON", async () => {
    const client = makeNotionClient("ntn_secret", fakeFetch({
      "GET /v1/pages/p1": { id: "p1", last_edited_time: "2026-01-01T00:00:00.000Z" },
    }));
    const page = await client.retrievePage("p1");
    expect(page.id).toBe("p1");
  });

  it("search posts a query and returns results", async () => {
    const client = makeNotionClient("ntn_secret", fakeFetch({
      "POST /v1/search": { results: [{ id: "p1", object: "page" }], has_more: false },
    }));
    const out = await client.search();
    expect(out.results).toHaveLength(1);
  });

  it("blockChildren paginates via start_cursor", async () => {
    const client = makeNotionClient("ntn_secret", fakeFetch({
      "GET /v1/blocks/b1/children": { results: [{ id: "c1", type: "paragraph" }], has_more: true, next_cursor: "cur2" },
    }));
    const out = await client.blockChildren("b1");
    expect(out.results).toHaveLength(1);
    expect(out.next_cursor).toBe("cur2");
  });

  it("throws (redacted) on a non-2xx without leaking the token", async () => {
    const client = makeNotionClient("ntn_secret", async () => new Response("forbidden", { status: 403 }));
    await expect(client.retrievePage("p1")).rejects.toThrow(/Notion API error 403/);
    await expect(client.retrievePage("p1")).rejects.not.toThrow(/ntn_secret/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd landing && npx vitest run server/connectors/notion.test.ts` → FAIL (`makeNotionClient` not exported).

- [ ] **Step 3: Implement `server/connectors/notion.ts`**

```typescript
/**
 * Minimal dependency-free Notion REST client.
 *
 * We deliberately avoid @notionhq/client: this thin wrapper over fetch keeps the
 * bundle clean and routes every request through an SSRF host check (Notion's
 * host must resolve to a public IP). The token is sent as a Bearer credential
 * and never appears in a thrown error or a log line. `fetchImpl` is injectable
 * so unit tests run entirely offline.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateIp } from "../links/fetchMeta.ts";

const NOTION_VERSION = "2022-06-28";
const API_BASE = "https://api.notion.com";
const TIMEOUT_MS = 10_000;

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

/* ----- Narrow shapes we actually read (Notion returns far more) -------- */
export interface NotionRichText {
  plain_text?: string;
}
export interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  // Block payloads are keyed by `type`; we read them dynamically in the mapper.
  [key: string]: unknown;
}
export interface NotionPage {
  id: string;
  object?: string;
  last_edited_time?: string;
  url?: string;
  properties?: Record<string, unknown>;
  // Databases come back with object:"database" and a `title` array.
  title?: NotionRichText[];
}
export interface NotionSearchResult {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}
export interface NotionBlockChildren {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface NotionClient {
  search(input?: { query?: string; cursor?: string; pageSize?: number }): Promise<NotionSearchResult>;
  blockChildren(blockId: string, cursor?: string): Promise<NotionBlockChildren>;
  retrievePage(pageId: string): Promise<NotionPage>;
}

/** Resolve `host` and refuse if it maps to a private/loopback/link-local IP. */
async function assertPublicHost(hostname: string): Promise<void> {
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("Refusing to reach a private address");
    return;
  }
  const addrs = await lookup(hostname, { all: true });
  if (addrs.length === 0) throw new Error("Host did not resolve");
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error("Refusing to reach a private address");
  }
}

export function makeNotionClient(token: string, fetchImpl: FetchImpl = fetch): NotionClient {
  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const url = new URL(path, API_BASE);
    await assertPublicHost(url.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetchImpl(url.href, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      // Drain + drop the body; never echo the token or response text.
      await resp.body?.cancel().catch(() => {});
      throw new Error(`Notion API error ${resp.status}`);
    }
    return resp.json();
  }

  return {
    async search(input = {}) {
      const payload: Record<string, unknown> = { page_size: input.pageSize ?? 100 };
      if (input.query) payload.query = input.query;
      if (input.cursor) payload.start_cursor = input.cursor;
      return (await call("POST", "/v1/search", payload)) as NotionSearchResult;
    },
    async blockChildren(blockId, cursor) {
      const u = new URL(`/v1/blocks/${encodeURIComponent(blockId)}/children`, API_BASE);
      u.searchParams.set("page_size", "100");
      if (cursor) u.searchParams.set("start_cursor", cursor);
      return (await call("GET", u.pathname + u.search)) as NotionBlockChildren;
    },
    async retrievePage(pageId) {
      return (await call("GET", `/v1/pages/${encodeURIComponent(pageId)}`)) as NotionPage;
    },
  };
}
```
> The host check runs against `api.notion.com` on every call — a redundant but cheap defence-in-depth (the host is constant, but the check guarantees no future relative-path bug can redirect the client at a private address). In tests `fetchImpl` is the fake; `assertPublicHost("api.notion.com")` still runs and resolves to a public IP, so the fake's response is returned. `NotionBlock` carries an index signature so `blocksToMarkdown` (Task 4) reads `block[block.type]` without `any`.

- [ ] **Step 4: Run tests to verify they pass** — `cd landing && npx vitest run server/connectors/notion.test.ts` → PASS (config + 4 client tests).

- [ ] **Step 5: Typecheck + commit**

```bash
cd landing && npm run typecheck:server
git add server/connectors/notion.ts server/connectors/notion.test.ts
git commit -m "feat(dump): minimal injectable Notion REST client (host-checked fetch)"
```

---

## Task 4: Blocks → Markdown (`server/dump/blocksToMarkdown.ts`)

**Files:** Create `landing/server/dump/blocksToMarkdown.ts`; Test `landing/server/dump/blocksToMarkdown.test.ts`.

PURE: `blocksToMarkdown(blocks: NotionBlock[]): string`. No I/O, no clock — a deterministic mapping of a flat block list to markdown. Covers the common types; unsupported → a labeled placeholder so nothing is silently dropped. Rich-text is flattened to plain text by concatenating `plain_text`. Tables are rendered from their `table_row` children **when present inline** (the provider in Task 5 fetches a table's row children and passes them adjacent to the `table` block; if a `table` arrives without inline rows, it renders as the placeholder, which Task 5 avoids by inlining rows). Nested children (lists, toggles) are handled by the provider recursing and concatenating — this function maps **one flat list**.

- [ ] **Step 1: Write the failing tests**

Create `landing/server/dump/blocksToMarkdown.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { blocksToMarkdown } from "./blocksToMarkdown.ts";
import type { NotionBlock } from "../connectors/notion.ts";

function rt(text: string) {
  return [{ plain_text: text }];
}
function block(type: string, payload: Record<string, unknown>): NotionBlock {
  return { id: crypto.randomUUID(), type, [type]: payload };
}

describe("blocksToMarkdown", () => {
  it("maps headings 1/2/3", () => {
    const md = blocksToMarkdown([
      block("heading_1", { rich_text: rt("One") }),
      block("heading_2", { rich_text: rt("Two") }),
      block("heading_3", { rich_text: rt("Three") }),
    ]);
    expect(md).toContain("# One");
    expect(md).toContain("## Two");
    expect(md).toContain("### Three");
  });

  it("maps paragraphs and quotes", () => {
    const md = blocksToMarkdown([
      block("paragraph", { rich_text: rt("hello world") }),
      block("quote", { rich_text: rt("a quote") }),
    ]);
    expect(md).toContain("hello world");
    expect(md).toContain("> a quote");
  });

  it("maps bulleted + numbered list items", () => {
    const md = blocksToMarkdown([
      block("bulleted_list_item", { rich_text: rt("bullet") }),
      block("numbered_list_item", { rich_text: rt("first") }),
      block("numbered_list_item", { rich_text: rt("second") }),
    ]);
    expect(md).toContain("- bullet");
    expect(md).toContain("1. first");
    expect(md).toContain("2. second");
  });

  it("maps to_do checkboxes", () => {
    const md = blocksToMarkdown([
      block("to_do", { rich_text: rt("done"), checked: true }),
      block("to_do", { rich_text: rt("todo"), checked: false }),
    ]);
    expect(md).toContain("- [x] done");
    expect(md).toContain("- [ ] todo");
  });

  it("fences code with its language", () => {
    const md = blocksToMarkdown([
      block("code", { rich_text: rt("const x = 1;"), language: "typescript" }),
    ]);
    expect(md).toContain("```typescript");
    expect(md).toContain("const x = 1;");
    expect(md).toContain("\n```");
  });

  it("maps callouts to blockquotes and divider to ---", () => {
    const md = blocksToMarkdown([
      block("callout", { rich_text: rt("note this") }),
      block("divider", {}),
    ]);
    expect(md).toContain("> note this");
    expect(md).toContain("---");
  });

  it("emits a child_page placeholder line", () => {
    const md = blocksToMarkdown([
      { id: "cp1", type: "child_page", child_page: { title: "Sub Page" } } as NotionBlock,
    ]);
    expect(md).toContain("Sub Page");
    expect(md.toLowerCase()).toContain("child page");
  });

  it("renders a table from inlined table_row children", () => {
    const table = block("table", { table_width: 2, has_column_header: true }) as NotionBlock;
    table.has_children = true;
    const row1 = block("table_row", { cells: [rt("A"), rt("B")] });
    const row2 = block("table_row", { cells: [rt("1"), rt("2")] });
    const md = blocksToMarkdown([table, row1, row2]);
    expect(md).toContain("| A | B |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| 1 | 2 |");
  });

  it("labels unsupported blocks instead of dropping them", () => {
    const md = blocksToMarkdown([block("unsupported_widget", { foo: 1 })]);
    expect(md).toContain("> [unsupported: unsupported_widget]");
  });

  it("flattens multi-run rich text", () => {
    const md = blocksToMarkdown([
      block("paragraph", { rich_text: [{ plain_text: "foo " }, { plain_text: "bar" }] }),
    ]);
    expect(md).toContain("foo bar");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd landing && npx vitest run server/dump/blocksToMarkdown.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `server/dump/blocksToMarkdown.ts`**

```typescript
/**
 * Pure Notion-block → Markdown mapping. No I/O, no clock — deterministic.
 *
 * Maps the common block types; unsupported blocks become a labeled placeholder
 * so content is never silently dropped. Rich-text is flattened to plain text
 * (concatenated `plain_text`). Tables render from `table_row` children that the
 * caller inlines immediately after the `table` block.
 */
import type { NotionBlock, NotionRichText } from "../connectors/notion.ts";

/** Flatten a Notion rich-text array to plain text. */
function richText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return (value as NotionRichText[]).map((r) => r?.plain_text ?? "").join("");
}

/** Read the `<type>` payload object off a block. */
function payload(b: NotionBlock): Record<string, unknown> {
  const p = b[b.type];
  return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
}

function tableRowCells(b: NotionBlock): string[] {
  const cells = payload(b).cells;
  if (!Array.isArray(cells)) return [];
  // Each cell is itself a rich-text array.
  return (cells as unknown[]).map((cell) => richText(cell).replace(/\|/g, "\\|").trim());
}

export function blocksToMarkdown(blocks: NotionBlock[]): string {
  const out: string[] = [];
  let numberRun = 0; // running counter for numbered_list_item sequences

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const type = b.type;
    if (type !== "numbered_list_item") numberRun = 0;

    switch (type) {
      case "heading_1":
        out.push(`# ${richText(payload(b).rich_text)}`);
        break;
      case "heading_2":
        out.push(`## ${richText(payload(b).rich_text)}`);
        break;
      case "heading_3":
        out.push(`### ${richText(payload(b).rich_text)}`);
        break;
      case "paragraph": {
        const text = richText(payload(b).rich_text);
        out.push(text); // empty paragraphs become blank lines (spacing)
        break;
      }
      case "bulleted_list_item":
        out.push(`- ${richText(payload(b).rich_text)}`);
        break;
      case "numbered_list_item":
        numberRun += 1;
        out.push(`${numberRun}. ${richText(payload(b).rich_text)}`);
        break;
      case "to_do": {
        const checked = payload(b).checked === true;
        out.push(`- [${checked ? "x" : " "}] ${richText(payload(b).rich_text)}`);
        break;
      }
      case "quote":
        out.push(`> ${richText(payload(b).rich_text)}`);
        break;
      case "callout":
        out.push(`> ${richText(payload(b).rich_text)}`);
        break;
      case "code": {
        const lang = typeof payload(b).language === "string" ? (payload(b).language as string) : "";
        out.push("```" + lang + "\n" + richText(payload(b).rich_text) + "\n```");
        break;
      }
      case "child_page": {
        const title = typeof payload(b).title === "string" ? (payload(b).title as string) : "Untitled";
        out.push(`> [child page: ${title}]`);
        break;
      }
      case "child_database": {
        const title = typeof payload(b).title === "string" ? (payload(b).title as string) : "Untitled";
        out.push(`> [child database: ${title}]`);
        break;
      }
      case "divider":
        out.push("---");
        break;
      case "table": {
        // Consume the immediately-following table_row blocks the caller inlined.
        const rows: string[][] = [];
        let j = i + 1;
        while (j < blocks.length && blocks[j].type === "table_row") {
          rows.push(tableRowCells(blocks[j]));
          j++;
        }
        if (rows.length === 0) {
          out.push("> [unsupported: table]");
          break;
        }
        const width = Math.max(...rows.map((r) => r.length));
        const pad = (r: string[]) => {
          const cells = r.slice();
          while (cells.length < width) cells.push("");
          return `| ${cells.join(" | ")} |`;
        };
        out.push(pad(rows[0]));
        out.push(`| ${Array(width).fill("---").join(" | ")} |`);
        for (let k = 1; k < rows.length; k++) out.push(pad(rows[k]));
        i = j - 1; // skip the consumed rows
        break;
      }
      case "table_row":
        // Consumed by the preceding `table` case; a stray row is ignored.
        break;
      default:
        out.push(`> [unsupported: ${type}]`);
        break;
    }
  }

  // Join with blank lines, then collapse 3+ newlines to a single blank line.
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
```
> `numberRun` makes consecutive `numbered_list_item` blocks render `1. 2. 3.`; any non-numbered block resets the counter (a fresh ordered list later restarts at 1). The `table` case pulls the inlined `table_row` blocks Task 5 places right after the table; a table with no rows degrades to the unsupported placeholder rather than throwing.

- [ ] **Step 4: Run tests to verify they pass** — `cd landing && npx vitest run server/dump/blocksToMarkdown.test.ts` → PASS (all cases).

- [ ] **Step 5: Typecheck + commit**

```bash
cd landing && npm run typecheck:server
git add server/dump/blocksToMarkdown.ts server/dump/blocksToMarkdown.test.ts
git commit -m "feat(dump): pure Notion blocks→markdown mapper (headings/lists/todo/code/table/…)"
```

---

## Task 5: The `notion` SourceProvider (`server/dump/providers/notion.ts`)

**Files:** Create `landing/server/dump/providers/notion.ts`; Modify `landing/server/dump/providers/index.ts` (register `notion`); Test `landing/server/dump/providers/notion.test.ts`.

`fetch(ctx)` parses `ctx.sourceRef` as `{ pageIds: string[] }`, then for each page (deterministic order, stop at `ctx.cap`): `retrievePage` → title + `last_edited_time`; page through `blockChildren` (cursor pagination) collecting every block; for each `table` block, fetch its row children and **inline** them right after the table so `blocksToMarkdown` can render it; recurse into `child_page` blocks (bounded depth) emitting each as a **separate** `RawItem` under a path mirroring the tree; map blocks → body via `blocksToMarkdown`. `sourceKey = notion:<pageId>@<last_edited_time>`; `origin = { type: "notion", url, path, ref: last_edited_time }`. Self-throttle ~3 req/s via an injected `delayMs` (default ~340ms; **0 in tests**). The Notion client is injected (`makeNotionClient` is constructed by the provider from the stored token, but the provider takes a `client` param for tests via a factory seam — see below).

The provider needs the user's token. To keep `fetch(ctx)` matching the `SourceProvider` interface (no client param), the provider resolves the token from `connector_tokens` inside `fetch`, but exposes an **injectable factory** `makeNotionProvider({ getClient, delayMs })` so tests pass a fake client and zero delay. The registry registers `makeNotionProvider()` with production defaults.

- [ ] **Step 1: Write the failing test**

Create `landing/server/dump/providers/notion.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { makeNotionProvider } from "./notion.ts";
import type { NotionClient } from "../../connectors/notion.ts";

// A scripted fake Notion client: pages + their block children.
function fakeClient(script: {
  pages: Record<string, { last_edited_time: string; url?: string }>;
  children: Record<string, { results: any[]; next?: string }[]>; // pages of children per blockId
}): NotionClient {
  const cursors: Record<string, number> = {};
  return {
    async retrievePage(pageId) {
      const p = script.pages[pageId];
      if (!p) throw new Error("Notion API error 404");
      return { id: pageId, object: "page", last_edited_time: p.last_edited_time, url: p.url };
    },
    async blockChildren(blockId, cursor) {
      const pages = script.children[blockId] ?? [{ results: [] }];
      const idx = cursor ? (cursors[`${blockId}:${cursor}`] ?? 0) : 0;
      const page = pages[idx] ?? { results: [] };
      const next = page.next;
      if (next) cursors[`${blockId}:${next}`] = idx + 1;
      return { results: page.results, has_more: Boolean(next), next_cursor: next ?? null };
    },
    async search() {
      return { results: [], has_more: false, next_cursor: null };
    },
  };
}

const ctx = (pageIds: string[], cap = 100) => ({
  userId: "u1",
  sourceRef: { pageIds },
  cap,
  onProgress: () => {},
});

describe("notion provider", () => {
  it("turns one page into one RawItem with a stable source key + origin", async () => {
    const client = fakeClient({
      pages: { p1: { last_edited_time: "2026-01-01T00:00:00.000Z", url: "https://notion.so/p1" } },
      children: {
        p1: [{
          results: [
            { id: "h", type: "heading_1", heading_1: { rich_text: [{ plain_text: "Title" }] } },
            { id: "para", type: "paragraph", paragraph: { rich_text: [{ plain_text: "hello" }] } },
          ],
        }],
      },
    });
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    const items = await provider.fetch(ctx(["p1"]));
    expect(items).toHaveLength(1);
    expect(items[0].sourceKey).toBe("notion:p1@2026-01-01T00:00:00.000Z");
    expect(items[0].origin).toMatchObject({ type: "notion", url: "https://notion.so/p1", ref: "2026-01-01T00:00:00.000Z" });
    expect(items[0].body).toContain("# Title");
    expect(items[0].body).toContain("hello");
  });

  it("paginates block children via the cursor", async () => {
    const client = fakeClient({
      pages: { p1: { last_edited_time: "t" } },
      children: {
        p1: [
          { results: [{ id: "a", type: "paragraph", paragraph: { rich_text: [{ plain_text: "page1" }] } }], next: "cur2" },
          { results: [{ id: "b", type: "paragraph", paragraph: { rich_text: [{ plain_text: "page2" }] } }] },
        ],
      },
    });
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    const items = await provider.fetch(ctx(["p1"]));
    expect(items[0].body).toContain("page1");
    expect(items[0].body).toContain("page2");
  });

  it("emits child pages as separate RawItems under a mirrored path", async () => {
    const client = fakeClient({
      pages: {
        parent: { last_edited_time: "t1" },
        kid: { last_edited_time: "t2" },
      },
      children: {
        parent: [{
          results: [
            { id: "kid", type: "child_page", has_children: true, child_page: { title: "Kid Page" } },
          ],
        }],
        kid: [{ results: [{ id: "kp", type: "paragraph", paragraph: { rich_text: [{ plain_text: "child body" }] } }] }],
      },
    });
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    const items = await provider.fetch(ctx(["parent"]));
    expect(items.map((i) => i.sourceKey)).toContain("notion:kid@t2");
    const kid = items.find((i) => i.sourceKey === "notion:kid@t2")!;
    expect(kid.body).toContain("child body");
    expect(kid.origin.path).toContain("Kid Page");
  });

  it("inlines table rows so the body renders a markdown table", async () => {
    const client = fakeClient({
      pages: { p1: { last_edited_time: "t" } },
      children: {
        p1: [{
          results: [{ id: "tbl", type: "table", has_children: true, table: { table_width: 2 } }],
        }],
        tbl: [{
          results: [
            { id: "r1", type: "table_row", table_row: { cells: [[{ plain_text: "A" }], [{ plain_text: "B" }]] } },
            { id: "r2", type: "table_row", table_row: { cells: [[{ plain_text: "1" }], [{ plain_text: "2" }]] } },
          ],
        }],
      },
    });
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    const items = await provider.fetch(ctx(["p1"]));
    expect(items[0].body).toContain("| A | B |");
    expect(items[0].body).toContain("| 1 | 2 |");
  });

  it("stops at the cap and reports a partial failure without aborting the batch", async () => {
    const client = fakeClient({
      pages: { ok: { last_edited_time: "t" } }, // "bad" is missing → retrievePage throws
      children: { ok: [{ results: [{ id: "p", type: "paragraph", paragraph: { rich_text: [{ plain_text: "fine" }] } }] }] },
    });
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    const items = await provider.fetch(ctx(["ok", "bad"], 100));
    // "ok" yields an item; "bad" is skipped (best-effort per item).
    expect(items.map((i) => i.sourceKey)).toContain("notion:ok@t");
    expect(items.some((i) => i.sourceKey.startsWith("notion:bad"))).toBe(false);

    const capped = await makeNotionProvider({ getClient: () => client, delayMs: 0 }).fetch(ctx(["ok", "ok"], 1));
    expect(capped).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd landing && npx vitest run server/dump/providers/notion.test.ts` → FAIL (`makeNotionProvider` not exported).

- [ ] **Step 3: Implement `server/dump/providers/notion.ts`**

```typescript
/**
 * The `notion` SourceProvider.
 *
 * fetch(ctx): for each selected page (deterministic order, capped), retrieve the
 * page, page through its block children, inline each table's rows, recurse into
 * child pages (bounded depth) as separate RawItems mirroring the tree, and map
 * blocks → markdown. Best-effort per page: a failed page is skipped, others
 * proceed. Self-throttles to ~3 req/s via an injected delay (0 in tests).
 */
import { decryptKey } from "../../ai/keyvault.ts";
import { getConnectorToken } from "../../db.ts";
import { makeNotionClient, type NotionClient, type NotionBlock } from "../../connectors/notion.ts";
import { blocksToMarkdown } from "../blocksToMarkdown.ts";
import type { SourceProvider, FetchCtx, RawItem } from "../types.ts";

const MAX_DEPTH = 4;          // bounded child-page recursion
const MAX_BLOCK_PAGES = 50;   // hard ceiling on cursor pages per block (5000 blocks)

interface NotionProviderDeps {
  /** Resolve a client for the user. Production: build from the stored token. */
  getClient: (userId: string) => NotionClient;
  /** Per-request throttle (~340ms ≈ 3 req/s in prod; 0 in tests). */
  delayMs: number;
}

function defaultGetClient(userId: string): NotionClient {
  const row = getConnectorToken(userId, "notion");
  if (!row || !row.access_token_cipher) {
    throw new Error("Notion is not connected");
  }
  return makeNotionClient(decryptKey(row.access_token_cipher));
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

function plainTitle(block: NotionBlock): string {
  const payload = block[block.type];
  if (payload && typeof payload === "object") {
    const title = (payload as { title?: unknown }).title;
    if (typeof title === "string" && title.trim()) return title.trim();
  }
  return "Untitled";
}

export function makeNotionProvider(deps: NotionProviderDeps): SourceProvider {
  const { getClient, delayMs } = deps;

  return {
    async fetch(ctx: FetchCtx): Promise<RawItem[]> {
      const ref = ctx.sourceRef as { pageIds?: unknown };
      const pageIds = Array.isArray(ref?.pageIds)
        ? (ref.pageIds.filter((p): p is string => typeof p === "string"))
        : [];
      const client = getClient(ctx.userId);
      const items: RawItem[] = [];
      const seen = new Set<string>(); // guard against cyclic child references

      // Fetch the flat block list of a block id, paging the cursor, and inline
      // each table's row children right after the table block.
      async function fetchBlocks(blockId: string): Promise<NotionBlock[]> {
        const collected: NotionBlock[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_BLOCK_PAGES; page++) {
          await delay(delayMs);
          const res = await client.blockChildren(blockId, cursor);
          for (const block of res.results) {
            collected.push(block);
            if (block.type === "table" && block.has_children) {
              const rows = await fetchBlocks(block.id); // table_row children
              for (const row of rows) if (row.type === "table_row") collected.push(row);
            }
          }
          if (!res.has_more || !res.next_cursor) break;
          cursor = res.next_cursor;
        }
        return collected;
      }

      // Process one page → a RawItem, then recurse into its child pages.
      async function processPage(pageId: string, pathSegments: string[], depth: number): Promise<void> {
        if (items.length >= ctx.cap) return;
        if (seen.has(pageId)) return;
        seen.add(pageId);

        let lastEdited = "";
        let url: string | undefined;
        try {
          await delay(delayMs);
          const page = await client.retrievePage(pageId);
          lastEdited = typeof page.last_edited_time === "string" ? page.last_edited_time : "";
          url = typeof page.url === "string" ? page.url : undefined;
        } catch {
          return; // best-effort: skip a page we cannot read
        }

        let blocks: NotionBlock[];
        try {
          blocks = await fetchBlocks(pageId);
        } catch {
          return; // skip on a hard block-fetch failure
        }

        // Title hint: first heading_1, else the trailing path segment, else the id.
        const firstHeading = blocks.find((b) => b.type === "heading_1");
        const headingTitle = firstHeading
          ? blocksToMarkdown([firstHeading]).replace(/^#\s+/, "").trim()
          : "";
        const title = headingTitle || pathSegments[pathSegments.length - 1] || pageId;
        const path = [...pathSegments, title].join("/");

        items.push({
          sourceKey: `notion:${pageId}@${lastEdited}`,
          title,
          body: blocksToMarkdown(blocks),
          origin: { type: "notion", ref: lastEdited, url, path },
        });

        if (depth >= MAX_DEPTH) return;
        for (const block of blocks) {
          if (items.length >= ctx.cap) return;
          if (block.type === "child_page" && block.has_children !== false) {
            const childTitle = plainTitle(block);
            await processPage(block.id, [...pathSegments, title], depth + 1)
              .catch(() => {}); // a failing subtree never aborts the batch
            // Note: the child's own title is recomputed inside processPage from
            // its first heading; childTitle is only a fallback hint for the path.
            void childTitle;
          }
        }
        ctx.onProgress(items.length);
      }

      for (const pageId of pageIds) {
        if (items.length >= ctx.cap) break;
        await processPage(pageId, [], 0);
      }
      return items.slice(0, ctx.cap);
    },
  };
}

/** Production provider: real client from the stored token, ~3 req/s throttle. */
export const notionProvider: SourceProvider = makeNotionProvider({
  getClient: defaultGetClient,
  delayMs: 340,
});
```
> The cap is checked at every page boundary (before processing and before each child) and the result is `slice(0, cap)` as a belt-and-braces final clamp. `seen` prevents an infinite loop if Notion returns a cyclic `child_page` reference. Child-page titles are recomputed from their own first heading inside `processPage` (so the recursion is uniform); `childTitle`/`plainTitle` remain as a documented path-fallback hint and keep the `child_page` payload shape exercised. `MAX_BLOCK_PAGES`×100 = 5000 blocks/page caps a pathological page.

- [ ] **Step 4: Register `notion` in the provider registry**

In `landing/server/dump/providers/index.ts` (created in P2, extended with `github` in P4), import and wire the notion provider into `getProvider`:
```typescript
import { notionProvider } from "./notion.ts";
// inside getProvider(type):
//   case "notion": return notionProvider;
```
The final `getProvider` switch returns `rawProvider` for `"raw"`, `githubProvider` for `"github"`, and `notionProvider` for `"notion"`. (If P4 has not landed, add only the `notion` case; do not remove or assume the `github` case.)

- [ ] **Step 5: Run tests to verify they pass** — `cd landing && npx vitest run server/dump/providers/notion.test.ts` → PASS (all five).

- [ ] **Step 6: Typecheck + commit**

```bash
cd landing && npm run typecheck:server
git add server/dump/providers/notion.ts server/dump/providers/index.ts server/dump/providers/notion.test.ts
git commit -m "feat(dump): notion SourceProvider (pagination, child pages, tables, throttle) + registry"
```

---

## Task 6: Page-list endpoint (`GET /api/dump/notion/pages`)

**Files:** Modify `landing/server/dump/routes.ts` (add the route); Test `landing/server/dump/notionPages.test.ts`.

Selection UX for the modal: search the user's **granted** pages/databases via the stored token and return `[{ id, title, type }]`. Cookie-session only (reuse the `cookieUser` guard already in `routes.ts`). `503` when `notionConfigured`/keyvault is off; `409` when the user has no `notion` connector token. Mirrors GitHub's `/api/dump/github/repos` from P4.

- [ ] **Step 1: Write the failing gating test**

Create `landing/server/dump/notionPages.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { startTestServer, signup, mintToken } from "../test-helpers.ts";

describe("GET /api/dump/notion/pages", () => {
  it("503s when the connector is unconfigured", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `np-${crypto.randomUUID()}@t.local`);
      const res = await client.req("GET", "/api/dump/notion/pages");
      expect(res.status).toBe(503);
    } finally {
      srv.close();
    }
  });

  it("rejects PAT auth (cookie-only)", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `np2-${crypto.randomUUID()}@t.local`);
      const token = await mintToken(client, ["read", "write"]);
      const { makePatClient } = await import("../test-helpers.ts");
      const pat = makePatClient(srv.baseURL, token);
      const res = await pat.req("GET", "/api/dump/notion/pages");
      expect(res.status).toBe(403);
    } finally {
      srv.close();
    }
  });
});
```
> Under test `notionConfigured` is false, so the route short-circuits to `503` before ever needing a token — this exercises the gate deterministically with no network. The PAT case asserts the cookie-only invariant (the `req.apiUser` 403 guard runs first, before the 503). A `409 not-connected` path requires a configured connector + a live token, which is not reachable in the offline harness; it is covered by the manual verification note below and by the provider/client unit tests.

- [ ] **Step 2: Run to verify failure** — `cd landing && npx vitest run server/dump/notionPages.test.ts` → FAIL (route 404).

- [ ] **Step 3: Add the route to `server/dump/routes.ts`**

Add imports at the top of `routes.ts`:
```typescript
import { env } from "../env.ts";
import { keyvaultConfigured, decryptKey } from "../ai/keyvault.ts";
import { getConnectorToken } from "../db.ts";
import { makeNotionClient } from "../connectors/notion.ts";
```
(Some of these may already be imported by P4's GitHub repos route — keep one copy.)

Add the handler (place it with the other `dumpRouter.get(...)` routes):
```typescript
// Notion page/database picker — searches the user's GRANTED content only.
dumpRouter.get("/notion/pages", async (req: Request, res: Response) => {
  const uid = cookieUser(req, res); if (!uid) return;
  if (!env.notionConfigured || !keyvaultConfigured()) {
    res.status(503).json({ error: "Notion connector is not configured" });
    return;
  }
  const row = getConnectorToken(uid, "notion");
  if (!row || !row.access_token_cipher) {
    res.status(409).json({ error: "Notion is not connected" });
    return;
  }

  let pages: { id: string; title: string; type: "page" | "database" }[] = [];
  try {
    const client = makeNotionClient(decryptKey(row.access_token_cipher));
    let cursor: string | undefined;
    for (let page = 0; page < 5 && pages.length < 200; page++) {
      const result = await client.search({ cursor, pageSize: 100 });
      for (const item of result.results) {
        const type = item.object === "database" ? "database" : "page";
        pages.push({ id: item.id, title: notionTitle(item), type });
      }
      if (!result.has_more || !result.next_cursor) break;
      cursor = result.next_cursor;
    }
  } catch {
    res.status(502).json({ error: "Could not reach Notion" });
    return;
  }
  res.json({ pages: pages.slice(0, 200) });
});
```

Add the title helper near the bottom of `routes.ts` (Notion page titles live in a `title`-typed property; databases carry a top-level `title` rich-text array):
```typescript
function notionTitle(item: { properties?: Record<string, unknown>; title?: Array<{ plain_text?: string }> }): string {
  // Database: top-level `title` rich-text array.
  if (Array.isArray(item.title)) {
    const t = item.title.map((r) => r?.plain_text ?? "").join("").trim();
    if (t) return t;
  }
  // Page: find the property whose type is "title".
  const props = item.properties ?? {};
  for (const value of Object.values(props)) {
    const v = value as { type?: string; title?: Array<{ plain_text?: string }> };
    if (v?.type === "title" && Array.isArray(v.title)) {
      const t = v.title.map((r) => r?.plain_text ?? "").join("").trim();
      if (t) return t;
    }
  }
  return "Untitled";
}
```
> The endpoint returns at most 200 results (5 pages × 100, hard-capped) — enough for a picker without unbounded fan-out. A Notion outage surfaces as `502` so the client can retry, distinct from the `409 not-connected` and `503 unconfigured` states.

- [ ] **Step 4: Run the gating test** — `cd landing && npx vitest run server/dump/notionPages.test.ts` → PASS (both).

- [ ] **Step 5: Typecheck + commit**

```bash
cd landing && npm run typecheck:server
git add server/dump/routes.ts server/dump/notionPages.test.ts
git commit -m "feat(dump): GET /api/dump/notion/pages picker (503/409/502 gated, cookie-only)"
```

---

## Final phase verification

- [ ] **Run the whole P5 suite + typecheck:**
```bash
cd landing && npx vitest run \
  server/connectors/notion.test.ts \
  server/auth/notion.test.ts \
  server/dump/blocksToMarkdown.test.ts \
  server/dump/providers/notion.test.ts \
  server/dump/notionPages.test.ts \
  && npm run typecheck:server
```
Expected: all green, no type errors.

- [ ] **Confirm no new lint errors on the files this phase added:**
```bash
cd landing && npx eslint server/auth/notion.ts server/connectors/notion.ts server/dump/blocksToMarkdown.ts server/dump/providers/notion.ts
```
Expected: clean (the pre-existing `server/auth/google.ts` lint debt is not yours).

- [ ] **Full build (proves the type-only cross-package edges still resolve):**
```bash
cd landing && npm run build
```
Expected: exits 0.

- [ ] **Manual verification of the live OAuth + 409 path (requires real Notion creds — not run in CI):**
  1. Set `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` / `NOTION_REDIRECT_URI` in `landing/.env` from a Notion **public** integration; restart the dev server.
  2. While signed in, `GET /api/dump/notion/pages` → expect **409 "Notion is not connected"** (configured but no token yet).
  3. Hit `GET /api/auth/notion/install` → Notion consent screen → grant a page or two → callback redirects to `/app.html?connector=notion&status=connected`.
  4. `GET /api/dump/notion/pages` → expect `200 { pages: [...] }` listing exactly the granted pages/databases.
  5. `POST /api/dump` with `{ source: { type: "notion", pageIds: [<one granted id>] } }`, drive the worker, poll → `awaiting_review`; confirm the manifest item's body is the page rendered as markdown with the provenance marker appended after commit.

---

**P5 done when:** `notionConfigured` gates the connector (503 when unset); `server/auth/notion.ts` runs the OAuth round-trip (signed state, constant-time compare, Basic-auth token exchange, encrypted token in `connector_tokens` with `external_account = workspace_name`) and is mounted at `/api/auth/notion/{install,callback}`; the minimal `makeNotionClient` talks to `api.notion.com` through a host-checked fetch with `Notion-Version: 2022-06-28` and never leaks the token; `blocksToMarkdown` purely maps every covered block type (and labels the rest); the `notion` `SourceProvider` paginates block children, inlines tables, recurses child pages with bounded depth, throttles ~3 req/s (0 in tests), emits `notion:<pageId>@<last_edited_time>` source keys, and is registered in `getProvider`; `GET /api/dump/notion/pages` returns the granted page/database picker (503/409/502 gated, cookie-only, PAT-rejected); `https://api.notion.com` is in the CSP `connectSrc`; and `npx vitest run` (the five P5 files) + `npm run typecheck:server` + `npm run build` all pass with no new lint errors. **All external HTTP is injectable — no test touches the network.**
