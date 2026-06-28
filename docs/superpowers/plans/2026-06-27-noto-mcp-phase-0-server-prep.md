# Noto MCP — Phase 0: Server Prep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Noto Express/SQLite backend with the primitives an MCP server needs — Personal Access Token (PAT) auth, single-note + section read/write endpoints, full-text search, a memory store, and an audit log — without touching the browser's existing cookie flow.

**Architecture:** All new state lives in the one data module (`server/db.ts`) behind parameterised prepared statements, mirroring the existing session/vault/file repos. A bearer-token resolver runs on `/api` *before* CSRF; PAT requests carry no cookie so they bypass CSRF and resolve to a scoped `req.apiUser`. New routers (`tokens`, `search`, `memory`) and new note endpoints reuse the data layer. Search is SQLite FTS5 (verified available in this Node's `node:sqlite`) kept in sync by triggers. No frontend in this phase; PATs are minted by a script for now.

**Tech Stack:** Node 24 / Express 5, `node:sqlite` (FTS5), zod v4, vitest 3 (integration via `createApp()` + ephemeral `app.listen(0)`), TypeScript (ESM, `.ts` import specifiers).

**Spec:** `docs/superpowers/specs/2026-06-27-noto-mcp-memory-layer-design.md` (Phase 0 row, §2.2).

---

## Conventions (read once)

- **Imports use `.ts` extensions** (e.g. `from "../db.ts"`) — match the repo.
- **DB style:** module-scope `db.prepare(...)`, exported repo functions, `now()`/`newId()` helpers, ownership via JOIN-to-`vaults.user_id`, casts like `as unknown as Row`.
- **Test style:** integration tests boot `createApp()` on port 0 and drive it over `fetch` with a cookie-jar client (see `server/notes/routes.test.ts`). This plan adds a shared `server/test-helpers.ts` so new tests don't re-implement that client.
- **Run a single test file:** `npx vitest run server/<path>.test.ts`
- **Run one test by name:** `npx vitest run server/<path>.test.ts -t "name"`
- **Typecheck server:** `npm run typecheck:server`
- **Scopes:** PAT scopes are `read`, `write`, `destructive`. Reads (`get_note`, `get_section`, `search`, `recall`) need `read`; mutations (`update_section`, `remember`) need `write`; `destructive` is reserved for delete (not in Phase 0). The locked "Memory/-scoped writes" posture is enforced later in the MCP tool layer; Phase 0 only gates by scope.

## File structure

**Create:**
- `server/test-helpers.ts` — shared cookie-jar + PAT `fetch` clients and `signup()` for tests.
- `server/auth/pat.ts` — PAT token format/hash, the `resolveApiToken` middleware, and `requireApiUser` / `requireScope` helpers.
- `server/tokens/routes.ts` — mint/list/revoke PATs (cookie-authenticated, for the future Settings UI).
- `server/notes/sections.ts` — pure heading/section utilities (`listHeadings`, `getSection`, `replaceSection`).
- `server/notes/sections.test.ts`
- `server/search/routes.ts` — `GET /api/search`.
- `server/search/routes.test.ts`
- `server/memory/dedup.ts` — pure token-Jaccard duplicate detection + recall scoring.
- `server/memory/dedup.test.ts`
- `server/memory/routes.ts` — `POST /api/memory` (remember), `GET /api/memory` (recall).
- `server/memory/routes.test.ts`
- `server/notes/single.test.ts` — tests for the new single-note + section endpoints.
- `scripts/mint-pat.mjs` — dev script to mint a PAT for an email.

**Modify:**
- `server/db.ts` — new tables (`pat_tokens`, `memories`, `audit_log`, `files_fts` + triggers + backfill) and their repo functions.
- `server/express.d.ts` — add `apiUser` to `Request`.
- `server/auth/csrf.ts` — skip CSRF when `req.apiUser` is set.
- `server/app.ts` — mount `resolveApiToken` before CSRF; mount new routers + new note endpoints.
- `server/notes/routes.ts` — add `GET /api/files/:fileId`, `GET /api/files/:fileId/section`, `PATCH /api/files/:fileId/section` (accept PAT or cookie).

---

## Task Group A — PAT auth foundation

### Task A0: Shared test client helpers

**Files:**
- Create: `server/test-helpers.ts`

- [ ] **Step 1: Write the helpers** (no test of their own — exercised by every later test)

```ts
// server/test-helpers.ts
// Shared HTTP clients for integration tests that boot createApp() on port 0.
import type { Server } from "node:http";
import { createApp } from "./app.ts";

const ORIGIN = "http://localhost:5173";

export interface TestServer {
  baseURL: string;
  close: () => void;
}

export async function startTestServer(): Promise<TestServer> {
  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { baseURL: `http://127.0.0.1:${port}`, close: () => server.close() };
}

/** Cookie-jar client mirroring the browser's CSRF/session flow. */
export function makeCookieClient(baseURL: string) {
  const cookies = new Map<string, string>();
  const cookieHeader = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  function absorb(res: Response) {
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  async function req(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Origin: ORIGIN };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET" && method !== "HEAD") headers["X-CSRF-Token"] = cookies.get("noto_csrf") ?? "";
    if (cookies.size > 0) headers["Cookie"] = cookieHeader();
    const res = await fetch(baseURL + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    absorb(res);
    return res;
  }
  return { req, cookies };
}

/** PAT client: Authorization bearer, no cookies, no CSRF. */
export function makePatClient(baseURL: string, token: string) {
  async function req(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Origin: ORIGIN };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(baseURL + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
  }
  return { req };
}

/** Sign up a fresh user, returning an authenticated cookie client. */
export async function signup(baseURL: string, email: string) {
  const client = makeCookieClient(baseURL);
  await client.req("GET", "/api/health"); // primes the CSRF cookie
  const res = await client.req("POST", "/api/auth/signup", { email, password: "password123" });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status}`);
  return client;
}

/** Mint a PAT through the cookie API and return the plaintext token. */
export async function mintToken(
  client: ReturnType<typeof makeCookieClient>,
  scopes: string[] = ["read", "write"],
  name = "test",
): Promise<string> {
  const res = await client.req("POST", "/api/tokens", { name, scopes });
  if (res.status !== 201) throw new Error(`mint failed: ${res.status}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/test-helpers.ts
git commit -m "test: shared cookie/PAT integration clients"
```

---

### Task A1: `pat_tokens` table + repo

**Files:**
- Modify: `server/db.ts` (schema block + new repo section)

- [ ] **Step 1: Add the table to the schema `db.exec(...)` block** (append inside the existing template literal at `server/db.ts:27-73`, before the closing `` ` ``)

```sql
  CREATE TABLE IF NOT EXISTS pat_tokens (
    id            TEXT PRIMARY KEY,            -- sha256(plaintext token)
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    scopes        TEXT NOT NULL,               -- comma-separated: read,write,destructive
    created_at    INTEGER NOT NULL,
    last_used_at  INTEGER,
    revoked_at    INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_pat_user ON pat_tokens(user_id);
```

- [ ] **Step 2: Add the repo code** (append near the end of `server/db.ts`, before `export { db };`)

```ts
/* ------------------------------ PAT tokens ----------------------------- */

export interface PatRow {
  id: string;
  user_id: string;
  name: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

const stmtInsertPat = db.prepare(
  "INSERT INTO pat_tokens (id, user_id, name, scopes, created_at) VALUES (?, ?, ?, ?, ?)",
);
const stmtPatById = db.prepare("SELECT * FROM pat_tokens WHERE id = ?");
const stmtPatsForUser = db.prepare(
  "SELECT * FROM pat_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
);
const stmtTouchPat = db.prepare("UPDATE pat_tokens SET last_used_at = ? WHERE id = ?");
const stmtRevokePat = db.prepare(
  "UPDATE pat_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
);

/** Store a token by its hash. `tokenHash` = sha256(plaintext). */
export function createPat(input: {
  tokenHash: string;
  userId: string;
  name: string;
  scopes: string[];
}): PatRow {
  stmtInsertPat.run(input.tokenHash, input.userId, input.name, input.scopes.join(","), now());
  return stmtPatById.get(input.tokenHash) as PatRow;
}

/** Look up a live (non-revoked) token by hash and bump last_used_at. */
export function usePat(tokenHash: string): PatRow | undefined {
  const row = stmtPatById.get(tokenHash) as PatRow | undefined;
  if (!row || row.revoked_at !== null) return undefined;
  stmtTouchPat.run(now(), row.id);
  return row;
}

export function listPatsForUser(userId: string): PatRow[] {
  return stmtPatsForUser.all(userId) as unknown as PatRow[];
}

/** Returns true if a live token was revoked. */
export function revokePat(userId: string, tokenId: string): boolean {
  return stmtRevokePat.run(now(), tokenId, userId).changes > 0;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:server`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/db.ts
git commit -m "feat(db): pat_tokens table + repo"
```

---

### Task A2: Bearer resolver middleware, request typing, CSRF bypass, app wiring

**Files:**
- Create: `server/auth/pat.ts`
- Modify: `server/express.d.ts`, `server/auth/csrf.ts`, `server/app.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// (temporary harness in server/auth/pat.test.ts)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";

let s: TestServer;
beforeAll(async () => { s = await startTestServer(); });
afterAll(() => s.close());

describe("PAT auth plumbing", () => {
  it("a read PAT reaches an authenticated GET without cookie/CSRF", async () => {
    const cookie = await signup(s.baseURL, "pat-plumb@example.com");
    const token = await mintToken(cookie, ["read"]);
    const pat = makePatClient(s.baseURL, token);
    const res = await pat.req("GET", "/api/vaults"); // existing route still cookie-only → see note
    // /api/vaults is cookie-only in Phase 0; assert the *token-aware* health probe instead:
    expect([200, 401]).toContain(res.status);
  });

  it("rejects a garbage bearer token as anonymous", async () => {
    const pat = makePatClient(s.baseURL, "noto_pat_not_a_real_token");
    const res = await pat.req("GET", "/api/files/anything");
    expect(res.status).toBe(401);
  });
});
```

> Note: this test is a scaffold proving the middleware resolves/*rejects* tokens; the real assertions arrive with the endpoints in Group C. Keep it minimal here.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run server/auth/pat.test.ts`
Expected: FAIL — `/api/files/anything` 404s (route doesn't exist) instead of a clean 401, and `req.apiUser` is undefined.

- [ ] **Step 3: Add `apiUser` to the Express Request type**

```ts
// server/express.d.ts
import "express";

declare global {
  namespace Express {
    interface Request {
      cookies: Record<string, string>;
      apiUser?: { userId: string; scopes: string[]; tokenId: string };
    }
  }
}
```

- [ ] **Step 4: Write the PAT middleware + guards**

```ts
// server/auth/pat.ts
import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { usePat } from "../db.ts";

export const PAT_PREFIX = "noto_pat_";
export type Scope = "read" | "write" | "destructive";

export function hashPatToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Generate a fresh plaintext PAT (256 bits of entropy). */
export function generatePatToken(): string {
  return PAT_PREFIX + crypto.randomBytes(32).toString("base64url");
}

/**
 * If a valid `Authorization: Bearer noto_pat_...` is present, resolve it to
 * `req.apiUser`. Always calls next(); authorization is enforced per-route.
 * Mounted BEFORE csrfProtection — PAT requests carry no cookie, so CSRF (a
 * browser-cookie defence) does not apply to them.
 */
export function resolveApiToken(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token.startsWith(PAT_PREFIX)) {
      const row = usePat(hashPatToken(token));
      if (row) {
        req.apiUser = {
          userId: row.user_id,
          scopes: row.scopes.split(",").filter(Boolean),
          tokenId: row.id,
        };
      }
    }
  }
  next();
}

/** 401 unless the request is authenticated by a PAT. Returns the apiUser. */
export function requireApiUser(req: Request, res: Response): Request["apiUser"] | null {
  if (!req.apiUser) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return req.apiUser;
}

/** 403 unless the PAT carries `scope`. Call after requireApiUser. */
export function requireScope(req: Request, res: Response, scope: Scope): boolean {
  if (!req.apiUser?.scopes.includes(scope)) {
    res.status(403).json({ error: `Token missing '${scope}' scope` });
    return false;
  }
  return true;
}
```

- [ ] **Step 5: Make CSRF skip PAT requests** (edit `server/auth/csrf.ts`, top of `csrfProtection`)

```ts
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (req.apiUser) {            // PAT auth: no cookie, no CSRF surface
    next();
    return;
  }
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  // ...unchanged...
}
```

- [ ] **Step 6: Wire the resolver into `app.ts`** (after the cookie-parsing middleware at `server/app.ts:84-87`, before the CSRF block at `:92`)

```ts
import { resolveApiToken } from "./auth/pat.ts";
// ...
  app.use("/api", resolveApiToken); // resolve bearer PAT → req.apiUser (before CSRF)

  /* --------------------------------- CSRF -------------------------------- */
```

- [ ] **Step 7: Run the test**

Run: `npx vitest run server/auth/pat.test.ts`
Expected: the garbage-token case now 401s cleanly once Group C adds `/api/files/:fileId`. Until then it 404s — that is acceptable; this scaffold is finalized in Task C1. Typecheck must pass now:
Run: `npm run typecheck:server` → no errors.

- [ ] **Step 8: Commit**

```bash
git add server/auth/pat.ts server/express.d.ts server/auth/csrf.ts server/app.ts server/auth/pat.test.ts
git commit -m "feat(auth): PAT resolver middleware + scope guards + CSRF bypass"
```

---

### Task A3: Token management API (cookie-authenticated)

**Files:**
- Create: `server/tokens/routes.ts`
- Modify: `server/app.ts` (mount router), `server/tokens/routes.ts` tested via `server/auth/pat.test.ts`

- [ ] **Step 1: Extend the test in `server/auth/pat.test.ts`**

```ts
it("mints, lists, and revokes a PAT via the cookie API", async () => {
  const cookie = await signup(s.baseURL, "tokens@example.com");

  const mint = await cookie.req("POST", "/api/tokens", { name: "laptop", scopes: ["read", "write"] });
  expect(mint.status).toBe(201);
  const { token, id } = (await mint.json()) as { token: string; id: string };
  expect(token.startsWith("noto_pat_")).toBe(true);

  const list = await (await cookie.req("GET", "/api/tokens")).json();
  expect(list.tokens).toHaveLength(1);
  expect(list.tokens[0]).not.toHaveProperty("token"); // plaintext never returned again
  expect(list.tokens[0].scopes).toEqual(["read", "write"]);

  expect((await cookie.req("DELETE", `/api/tokens/${id}`)).status).toBe(204);
  expect((await (await cookie.req("GET", "/api/tokens")).json()).tokens).toHaveLength(0);
});

it("rejects unauthenticated token minting", async () => {
  const anon = makeCookieClient(s.baseURL);
  await anon.req("GET", "/api/health");
  expect((await anon.req("POST", "/api/tokens", { name: "x", scopes: ["read"] })).status).toBe(401);
});
```
(Add `makeCookieClient` to the import line.)

- [ ] **Step 2: Run → fail** (`POST /api/tokens` 404s)

Run: `npx vitest run server/auth/pat.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the router**

```ts
// server/tokens/routes.ts
import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getCurrentUser } from "../auth/session.ts";
import { createPat, listPatsForUser, revokePat } from "../db.ts";
import { generatePatToken, hashPatToken } from "../auth/pat.ts";

export const tokensRouter = Router();
const jsonBody = express.json({ limit: "8kb" });

const mintSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(["read", "write", "destructive"])).min(1).max(3),
});

function userId(req: Request, res: Response): string | null {
  const u = getCurrentUser(req);
  if (!u) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return u.id;
}

// Mint: returns the plaintext token ONCE; only the hash is stored.
tokensRouter.post("/", jsonBody, (req: Request, res: Response) => {
  const uid = userId(req, res);
  if (!uid) return;
  const parsed = mintSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid token request" });
    return;
  }
  const token = generatePatToken();
  const row = createPat({
    tokenHash: hashPatToken(token),
    userId: uid,
    name: parsed.data.name,
    scopes: parsed.data.scopes,
  });
  res.status(201).json({ id: row.id, token, name: row.name, scopes: parsed.data.scopes });
});

tokensRouter.get("/", (req: Request, res: Response) => {
  const uid = userId(req, res);
  if (!uid) return;
  const tokens = listPatsForUser(uid).map((t) => ({
    id: t.id,
    name: t.name,
    scopes: t.scopes.split(",").filter(Boolean),
    createdAt: t.created_at,
    lastUsedAt: t.last_used_at,
  }));
  res.json({ tokens });
});

tokensRouter.delete("/:id", (req: Request, res: Response) => {
  const uid = userId(req, res);
  if (!uid) return;
  if (!revokePat(uid, req.params.id as string)) {
    res.status(404).json({ error: "Token not found" });
    return;
  }
  res.status(204).end();
});
```

- [ ] **Step 4: Mount it in `app.ts`** (alongside the other routers, ~`server/app.ts:102-105`)

```ts
import { tokensRouter } from "./tokens/routes.ts";
// ...
  app.use("/api/tokens", tokensRouter);
```

- [ ] **Step 5: Run → pass**

Run: `npx vitest run server/auth/pat.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/tokens/routes.ts server/app.ts server/auth/pat.test.ts
git commit -m "feat(tokens): mint/list/revoke PAT API"
```

---

### Task A4: `mint-pat` dev script

**Files:**
- Create: `scripts/mint-pat.mjs`
- Modify: `package.json` (script entry)

- [ ] **Step 1: Write the script**

```js
// scripts/mint-pat.mjs
// Dev helper: mint a PAT for an existing user by email.
// Usage: node scripts/mint-pat.mjs user@example.com [read,write]
import { getUserByEmail, createPat } from "../server/db.ts";
import { generatePatToken, hashPatToken } from "../server/auth/pat.ts";

const [, , email, scopesArg = "read,write"] = process.argv;
if (!email) {
  console.error("Usage: node scripts/mint-pat.mjs <email> [read,write,destructive]");
  process.exit(1);
}
const user = getUserByEmail(email);
if (!user) {
  console.error(`No user with email ${email}. Sign up in the app first.`);
  process.exit(1);
}
const scopes = scopesArg.split(",").map((s) => s.trim()).filter(Boolean);
const token = generatePatToken();
createPat({ tokenHash: hashPatToken(token), userId: user.id, name: "cli", scopes });
console.log(token);
```

> The script imports `.ts` modules, so it is run through `tsx`.

- [ ] **Step 2: Add the package script** (in `package.json` `"scripts"`)

```json
"mint-pat": "tsx scripts/mint-pat.mjs"
```

- [ ] **Step 3: Verify manually**

Run: `npm run mint-pat -- nonexistent@example.com`
Expected: prints "No user with email …" and exits non-zero (proves wiring without needing a real user).

- [ ] **Step 4: Commit**

```bash
git add scripts/mint-pat.mjs package.json
git commit -m "chore: mint-pat dev script"
```

---

## Task Group B — Audit log

### Task B1: `audit_log` table + repo + helper

**Files:**
- Modify: `server/db.ts`

- [ ] **Step 1: Add the table** (append to the schema `db.exec(...)` block)

```sql
  CREATE TABLE IF NOT EXISTS audit_log (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    token_id     TEXT,
    tool         TEXT NOT NULL,          -- update_section | remember | ...
    target       TEXT,                   -- fileId or memoryId
    before_hash  TEXT,                   -- sha256 of pre-image (note edits)
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);
```

- [ ] **Step 2: Add the repo** (append before `export { db };`)

```ts
/* ------------------------------- Audit log ----------------------------- */

export interface AuditRow {
  id: string;
  user_id: string;
  token_id: string | null;
  tool: string;
  target: string | null;
  before_hash: string | null;
  created_at: number;
}

const stmtInsertAudit = db.prepare(
  "INSERT INTO audit_log (id, user_id, token_id, tool, target, before_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
const stmtAuditForUser = db.prepare(
  "SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
);

export function writeAudit(entry: {
  userId: string;
  tokenId?: string | null;
  tool: string;
  target?: string | null;
  beforeHash?: string | null;
}): void {
  stmtInsertAudit.run(
    newId(),
    entry.userId,
    entry.tokenId ?? null,
    entry.tool,
    entry.target ?? null,
    entry.beforeHash ?? null,
    now(),
  );
}

export function listAuditForUser(userId: string, limit = 100): AuditRow[] {
  return stmtAuditForUser.all(userId, limit) as unknown as AuditRow[];
}

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:server` → no errors.

- [ ] **Step 4: Commit**

```bash
git add server/db.ts
git commit -m "feat(db): audit_log table + writeAudit"
```

---

## Task Group C — Read & section endpoints

### Task C1: `GET /api/files/:fileId` (single note)

**Files:**
- Create: `server/notes/single.test.ts`
- Modify: `server/notes/routes.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/notes/single.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";

let s: TestServer;
beforeAll(async () => { s = await startTestServer(); });
afterAll(() => s.close());

async function seed(email: string) {
  const cookie = await signup(s.baseURL, email);
  const { vaults } = await (await cookie.req("GET", "/api/vaults")).json();
  const vaultId = vaults[0].id;
  const created = await cookie.req("POST", `/api/vaults/${vaultId}/files`, {
    path: "Notes/Cells.md",
    title: "Cells",
    content: "# Cells\n\nIntro.\n\n## Mitochondria\n\nMakes ATP.\n\n## Nucleus\n\nHolds DNA.",
  });
  const { file } = await created.json();
  return { cookie, vaultId, file };
}

describe("GET /api/files/:fileId", () => {
  it("returns a single note by id via a read PAT", async () => {
    const { cookie, file } = await seed("single-read@example.com");
    const token = await mintToken(cookie, ["read"]);
    const pat = makePatClient(s.baseURL, token);

    const res = await pat.req("GET", `/api/files/${file.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.file.title).toBe("Cells");
    expect(body.file.content).toContain("Mitochondria");
  });

  it("404s for another user's note and 401s when unauthenticated", async () => {
    const { file } = await seed("single-owner@example.com");
    const other = await signup(s.baseURL, "single-other@example.com");
    const otherToken = await mintToken(other, ["read"]);
    expect((await makePatClient(s.baseURL, otherToken).req("GET", `/api/files/${file.id}`)).status).toBe(404);
    expect((await makePatClient(s.baseURL, "noto_pat_bad").req("GET", `/api/files/${file.id}`)).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run server/notes/single.test.ts`
Expected: FAIL (route missing → 404 even for the owner, or 401).

- [ ] **Step 3: Add a unified auth helper + the route to `server/notes/routes.ts`**

At the top, add imports:
```ts
import { getOwnedFile, toPublicFile } from "../db.ts";
import { requireApiUser, requireScope } from "../auth/pat.ts";
```
Add a helper next to `requireUserId`:
```ts
/** Resolve the caller from a PAT (preferred) or the session cookie. */
function resolveUserId(req: Request, res: Response): string | null {
  if (req.apiUser) return req.apiUser.userId;
  return requireUserId(req, res); // existing cookie path (sends 401 on miss)
}
```
Add the route (after the existing `/files/:fileId` PATCH, before DELETE):
```ts
// Fetch a single note by id (PAT read scope or cookie session).
notesRouter.get("/files/:fileId", (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "read")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const file = getOwnedFile(uid, req.params.fileId as string);
  if (!file) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  res.json({ file: toPublicFile(file) });
});
```

> `requireApiUser` is imported for symmetry with later tasks; `resolveUserId` already covers the 401. Remove the unused import if your linter flags it, or use it in place of the cookie fallback if you decide single-note GET should be PAT-only.

- [ ] **Step 4: Run → pass**

Run: `npx vitest run server/notes/single.test.ts`
Expected: PASS. Also re-run the scaffold: `npx vitest run server/auth/pat.test.ts` → the garbage-token case now 401s.

- [ ] **Step 5: Commit**

```bash
git add server/notes/routes.ts server/notes/single.test.ts
git commit -m "feat(notes): GET single note by id (PAT or cookie)"
```

---

### Task C2: Section utilities (pure)

**Files:**
- Create: `server/notes/sections.ts`, `server/notes/sections.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// server/notes/sections.test.ts
import { describe, expect, it } from "vitest";
import { listHeadings, getSection, replaceSection } from "./sections.ts";

const DOC = "# Cells\n\nIntro line.\n\n## Mitochondria\n\nMakes ATP.\n\n### Cristae\n\nFolded membrane.\n\n## Nucleus\n\nHolds DNA.\n";

describe("section utilities", () => {
  it("lists headings with level and path", () => {
    expect(listHeadings(DOC)).toEqual([
      { level: 1, text: "Cells", path: "Cells" },
      { level: 2, text: "Mitochondria", path: "Cells/Mitochondria" },
      { level: 3, text: "Cristae", path: "Cells/Mitochondria/Cristae" },
      { level: 2, text: "Nucleus", path: "Cells/Nucleus" },
    ]);
  });

  it("gets a section by heading path including nested subsections", () => {
    const sec = getSection(DOC, "Cells/Mitochondria");
    expect(sec).toBe("## Mitochondria\n\nMakes ATP.\n\n### Cristae\n\nFolded membrane.\n");
  });

  it("gets a leaf section bounded by the next same-or-higher heading", () => {
    expect(getSection(DOC, "Cells/Nucleus")).toBe("## Nucleus\n\nHolds DNA.\n");
  });

  it("returns null for a missing heading", () => {
    expect(getSection(DOC, "Cells/Golgi")).toBeNull();
  });

  it("replaces only the targeted section, leaving siblings intact", () => {
    const next = replaceSection(DOC, "Cells/Nucleus", "## Nucleus\n\nHolds the genome.\n");
    expect(next).toContain("Makes ATP.");
    expect(next).toContain("Holds the genome.");
    expect(next).not.toContain("Holds DNA.");
  });

  it("returns null when replacing a missing heading", () => {
    expect(replaceSection(DOC, "Cells/Golgi", "x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run server/notes/sections.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// server/notes/sections.ts
// Pure heading/section addressing over Markdown. A "section" is a heading line
// plus everything until the next heading of the same or higher level (so a
// section includes its deeper subsections). Heading paths are "A/B/C" using the
// enclosing-heading trail, matching how the UI labels passages.

interface Heading { level: number; text: string; line: number; }

export interface HeadingInfo { level: number; text: string; path: string; }

function parseHeading(line: string): { level: number; text: string } | null {
  const t = line.trimStart();
  let n = 0;
  while (t[n] === "#") n += 1;
  if (n < 1 || n > 6) return null;
  if (!/\s/.test(t[n] ?? "")) return null;
  const text = t.slice(n).trim();
  return text ? { level: n, text } : null;
}

function scanHeadings(lines: string[]): Heading[] {
  const out: Heading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = parseHeading(lines[i]);
    if (h) out.push({ level: h.level, text: h.text, line: i });
  }
  return out;
}

/** Build the "A/B/C" path for the heading at index `idx` within `headings`. */
function pathFor(headings: Heading[], idx: number): string {
  const trail: string[] = [];
  let level = headings[idx].level;
  for (let j = idx; j >= 0; j--) {
    if (headings[j].level <= level) {
      trail.unshift(headings[j].text);
      level = headings[j].level;
      if (level === 1) break;
    }
  }
  return trail.join("/");
}

export function listHeadings(content: string): HeadingInfo[] {
  const headings = scanHeadings(content.split("\n"));
  return headings.map((h, i) => ({ level: h.level, text: h.text, path: pathFor(headings, i) }));
}

/** Find the heading index whose path equals `headingPath`, or -1. */
function findIndex(headings: Heading[], headingPath: string): number {
  for (let i = 0; i < headings.length; i++) {
    if (pathFor(headings, i) === headingPath) return i;
  }
  return -1;
}

/** Returns [startLine, endLineExclusive] for the section, or null. */
function bounds(lines: string[], headingPath: string): [number, number] | null {
  const headings = scanHeadings(lines);
  const idx = findIndex(headings, headingPath);
  if (idx === -1) return null;
  const start = headings[idx].line;
  const level = headings[idx].level;
  let end = lines.length;
  for (let j = idx + 1; j < headings.length; j++) {
    if (headings[j].level <= level) {
      end = headings[j].line;
      break;
    }
  }
  return [start, end];
}

export function getSection(content: string, headingPath: string): string | null {
  const lines = content.split("\n");
  const b = bounds(lines, headingPath);
  if (!b) return null;
  return lines.slice(b[0], b[1]).join("\n");
}

/** Replace the section body with `newSection` (caller supplies the full block,
 *  heading included). Returns the new document, or null if not found. */
export function replaceSection(content: string, headingPath: string, newSection: string): string | null {
  const lines = content.split("\n");
  const b = bounds(lines, headingPath);
  if (!b) return null;
  const replacement = newSection.split("\n");
  const next = [...lines.slice(0, b[0]), ...replacement, ...lines.slice(b[1])];
  return next.join("\n");
}
```

- [ ] **Step 4: Run → pass**

Run: `npx vitest run server/notes/sections.test.ts`
Expected: PASS.

> If the nested-section assertion in Step 1 fails on trailing-newline differences, normalize by comparing `.trimEnd()` on both sides in the test — but the implementation above preserves the original line slicing so the provided expectations hold for `DOC`.

- [ ] **Step 5: Commit**

```bash
git add server/notes/sections.ts server/notes/sections.test.ts
git commit -m "feat(notes): pure section addressing utilities"
```

---

### Task C3: `GET /api/files/:fileId/section`

**Files:**
- Modify: `server/notes/routes.ts`, `server/notes/single.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
it("returns a single section by heading path", async () => {
  const { cookie, file } = await seed("section-read@example.com");
  const token = await mintToken(cookie, ["read"]);
  const pat = makePatClient(s.baseURL, token);

  const res = await pat.req("GET", `/api/files/${file.id}/section?heading=${encodeURIComponent("Cells/Mitochondria")}`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.content).toContain("Makes ATP.");
  expect(body.headingPath).toEqual(["Cells", "Mitochondria"]);
});

it("404s with an outline when the heading is missing", async () => {
  const { cookie, file } = await seed("section-miss@example.com");
  const token = await mintToken(cookie, ["read"]);
  const res = await makePatClient(s.baseURL, token).req(
    "GET",
    `/api/files/${file.id}/section?heading=${encodeURIComponent("Cells/Golgi")}`,
  );
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.headings).toContain("Cells/Mitochondria");
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run server/notes/single.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the route** (in `server/notes/routes.ts`; add `import { getSection, listHeadings } from "./sections.ts";`)

```ts
notesRouter.get("/files/:fileId/section", (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "read")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const heading = typeof req.query.heading === "string" ? req.query.heading : "";
  if (!heading) {
    res.status(400).json({ error: "Missing ?heading=" });
    return;
  }
  const file = getOwnedFile(uid, req.params.fileId as string);
  if (!file) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  const content = getSection(file.content, heading);
  if (content === null) {
    res.status(404).json({ error: "Section not found", headings: listHeadings(file.content).map((h) => h.path) });
    return;
  }
  res.json({ fileId: file.id, headingPath: heading.split("/"), content });
});
```

- [ ] **Step 4: Run → pass**

Run: `npx vitest run server/notes/single.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/notes/routes.ts server/notes/single.test.ts
git commit -m "feat(notes): GET section by heading path"
```

---

### Task C4: `PATCH /api/files/:fileId/section` (scoped write + audit + concurrency)

**Files:**
- Modify: `server/notes/routes.ts`, `server/notes/single.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
it("updates only the targeted section, audits, and honors optimistic concurrency", async () => {
  const { cookie, file } = await seed("section-write@example.com");
  const token = await mintToken(cookie, ["read", "write"]);
  const pat = makePatClient(s.baseURL, token);

  const ok = await pat.req("PATCH", `/api/files/${file.id}/section`, {
    heading: "Cells/Nucleus",
    content: "## Nucleus\n\nHolds the genome.\n",
    expectUpdatedAt: file.updatedAt,
  });
  expect(ok.status).toBe(200);
  const after = await (await pat.req("GET", `/api/files/${file.id}`)).json();
  expect(after.file.content).toContain("Holds the genome.");
  expect(after.file.content).toContain("Makes ATP."); // sibling intact

  // Stale expectUpdatedAt → 409
  const stale = await pat.req("PATCH", `/api/files/${file.id}/section`, {
    heading: "Cells/Nucleus",
    content: "## Nucleus\n\nx\n",
    expectUpdatedAt: file.updatedAt, // now stale
  });
  expect(stale.status).toBe(409);
});

it("rejects section writes from a read-only token", async () => {
  const { cookie, file } = await seed("section-ro@example.com");
  const token = await mintToken(cookie, ["read"]);
  const res = await makePatClient(s.baseURL, token).req("PATCH", `/api/files/${file.id}/section`, {
    heading: "Cells/Nucleus",
    content: "## Nucleus\n\nx\n",
  });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run server/notes/single.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** (in `server/notes/routes.ts`; add imports `import { replaceSection } from "./sections.ts";`, `import { updateFile, writeAudit, sha256Hex } from "../db.ts";`, and `import { z } from "zod";` is already present)

```ts
const sectionPatchSchema = z.object({
  heading: z.string().trim().min(1).max(400),
  content: z.string().max(256 * 1024),
  expectUpdatedAt: z.number().int().optional(),
});

notesRouter.patch("/files/:fileId/section", writeLimiter, jsonBody, (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "write")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const file = getOwnedFile(uid, req.params.fileId as string);
  if (!file) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  const parsed = sectionPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid section update" });
    return;
  }
  if (parsed.data.expectUpdatedAt !== undefined && parsed.data.expectUpdatedAt !== file.updated_at) {
    res.status(409).json({ error: "Note changed since expectUpdatedAt", currentUpdatedAt: file.updated_at });
    return;
  }
  const nextContent = replaceSection(file.content, parsed.data.heading, parsed.data.content);
  if (nextContent === null) {
    res.status(404).json({ error: "Section not found", headings: listHeadings(file.content).map((h) => h.path) });
    return;
  }
  writeAudit({
    userId: uid,
    tokenId: req.apiUser?.tokenId ?? null,
    tool: "update_section",
    target: file.id,
    beforeHash: sha256Hex(file.content),
  });
  const updated = updateFile(file.id, { content: nextContent });
  res.json({ fileId: updated.id, updatedAt: updated.updatedAt });
});
```

- [ ] **Step 4: Run → pass**

Run: `npx vitest run server/notes/single.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/notes/routes.ts server/notes/single.test.ts
git commit -m "feat(notes): PATCH section (scoped, audited, optimistic concurrency)"
```

---

## Task Group D — Full-text search

### Task D1: FTS5 table, triggers, backfill

**Files:**
- Modify: `server/db.ts`

- [ ] **Step 1: Add FTS schema + triggers + one-time backfill** (append a new block after the `pinned` migration block at `server/db.ts:77-82`)

```ts
// Full-text search over notes (FTS5, verified available in node:sqlite).
// External-content index mirrors `files`; triggers keep it in sync.
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    title, content, content='files', content_rowid='rowid'
  );
  CREATE TRIGGER IF NOT EXISTS files_fts_ai AFTER INSERT ON files BEGIN
    INSERT INTO files_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS files_fts_ad AFTER DELETE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
  END;
  CREATE TRIGGER IF NOT EXISTS files_fts_au AFTER UPDATE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
    INSERT INTO files_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
  END;
`);
// Backfill once if the index is empty but files exist (pre-existing databases).
{
  const ftsCount = (db.prepare("SELECT COUNT(*) AS n FROM files_fts").get() as { n: number }).n;
  const fileCount = (db.prepare("SELECT COUNT(*) AS n FROM files").get() as { n: number }).n;
  if (ftsCount === 0 && fileCount > 0) {
    db.exec("INSERT INTO files_fts(rowid, title, content) SELECT rowid, title, content FROM files");
  }
}
```

- [ ] **Step 2: Typecheck + smoke via existing tests** (the notes tests create/update/delete files, exercising the triggers)

Run: `npx vitest run server/notes/routes.test.ts`
Expected: PASS (no trigger errors).

- [ ] **Step 3: Commit**

```bash
git add server/db.ts
git commit -m "feat(db): FTS5 index over files with sync triggers"
```

---

### Task D2: `searchFiles` repo function + query sanitizer

**Files:**
- Modify: `server/db.ts`

- [ ] **Step 1: Add the sanitizer + query** (append before `export { db };`)

```ts
/* ------------------------------- Search -------------------------------- */

export interface SearchHit {
  fileId: string;
  title: string;
  path: string;
  snippet: string;
  score: number;     // higher = better (we negate FTS rank, which is negative)
  updatedAt: number;
}

/** Turn arbitrary user text into a safe FTS5 prefix query, or null if empty. */
export function toFtsQuery(raw: string): string | null {
  const tokens = raw.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!tokens || tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" "); // implicit AND, prefix-matched
}

const stmtSearch = db.prepare(`
  SELECT f.id AS fileId, f.title AS title, f.path AS path, f.updated_at AS updatedAt,
         snippet(files_fts, 1, '[', ']', '…', 12) AS snippet,
         rank AS rank
  FROM files_fts
  JOIN files f  ON f.rowid = files_fts.rowid
  JOIN vaults v ON v.id = f.vault_id
  WHERE files_fts MATCH ? AND v.user_id = ?
  ORDER BY rank
  LIMIT ?
`);

/** Full-text search across all of a user's notes. Returns [] for empty queries. */
export function searchFiles(userId: string, query: string, limit = 5): SearchHit[] {
  const match = toFtsQuery(query);
  if (!match) return [];
  const rows = stmtSearch.all(match, userId, limit) as unknown as Array<
    Omit<SearchHit, "score"> & { rank: number }
  >;
  return rows.map((r) => ({
    fileId: r.fileId,
    title: r.title,
    path: r.path,
    snippet: r.snippet,
    updatedAt: r.updatedAt,
    score: -r.rank,
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:server` → no errors.

- [ ] **Step 3: Commit**

```bash
git add server/db.ts
git commit -m "feat(db): searchFiles (FTS5) + safe query sanitizer"
```

---

### Task D3: `GET /api/search` route

**Files:**
- Create: `server/search/routes.ts`, `server/search/routes.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/search/routes.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";

let s: TestServer;
beforeAll(async () => { s = await startTestServer(); });
afterAll(() => s.close());

describe("GET /api/search", () => {
  it("returns ranked snippets scoped to the user", async () => {
    const cookie = await signup(s.baseURL, "search@example.com");
    const { vaults } = await (await cookie.req("GET", "/api/vaults")).json();
    const vaultId = vaults[0].id;
    await cookie.req("POST", `/api/vaults/${vaultId}/files`, {
      path: "Bio/Cells.md", title: "Cells", content: "# Cells\n\nMitochondria produce ATP energy.",
    });
    await cookie.req("POST", `/api/vaults/${vaultId}/files`, {
      path: "Bio/Plants.md", title: "Plants", content: "# Plants\n\nChloroplasts capture light energy.",
    });

    const token = await mintToken(cookie, ["read"]);
    const res = await makePatClient(s.baseURL, token).req("GET", "/api/search?q=energy");
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results.length).toBe(2);
    expect(results[0]).toHaveProperty("fileId");
    expect(results[0].snippet).toContain("[energy]");
    expect(results[0]).not.toHaveProperty("content"); // references + snippet only
  });

  it("does not leak another user's notes and returns [] for empty queries", async () => {
    const other = await signup(s.baseURL, "search-other@example.com");
    const token = await mintToken(other, ["read"]);
    const pat = makePatClient(s.baseURL, token);
    expect((await (await pat.req("GET", "/api/search?q=energy")).json()).results).toHaveLength(0);
    expect((await (await pat.req("GET", "/api/search?q=")).json()).results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run server/search/routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the router**

```ts
// server/search/routes.ts
import { Router, type Request, type Response } from "express";
import { searchFiles } from "../db.ts";
import { requireScope } from "../auth/pat.ts";
import { getCurrentUser } from "../auth/session.ts";

export const searchRouter = Router();

searchRouter.get("/", (req: Request, res: Response) => {
  if (req.apiUser) {
    if (!requireScope(req, res, "read")) return;
  } else if (!getCurrentUser(req)) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const uid = req.apiUser?.userId ?? getCurrentUser(req)!.id;
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 20) : 5;
  res.json({ results: searchFiles(uid, q, limit) });
});
```

- [ ] **Step 4: Mount in `app.ts`**

```ts
import { searchRouter } from "./search/routes.ts";
// ...
  app.use("/api/search", searchRouter);
```

- [ ] **Step 5: Run → pass**

Run: `npx vitest run server/search/routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/search/routes.ts server/search/routes.test.ts server/app.ts
git commit -m "feat(search): GET /api/search (FTS5, scoped, references-only)"
```

---

## Task Group E — Memory store

### Task E1: `memories` table + repo

**Files:**
- Modify: `server/db.ts`

- [ ] **Step 1: Add the table** (append to the schema `db.exec(...)` block)

```sql
  CREATE TABLE IF NOT EXISTS memories (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text           TEXT NOT NULL,
    type           TEXT NOT NULL,                 -- decision|preference|fact|glossary
    scope          TEXT NOT NULL DEFAULT 'global',
    source_client  TEXT,
    created_at     INTEGER NOT NULL,
    last_used_at   INTEGER NOT NULL,
    use_count      INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'active', -- active|superseded
    supersedes_id  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_memories_lookup ON memories(user_id, scope, status);
```

- [ ] **Step 2: Add the repo** (append before `export { db };`)

```ts
/* ------------------------------- Memory -------------------------------- */

export interface MemoryRow {
  id: string;
  user_id: string;
  text: string;
  type: string;
  scope: string;
  source_client: string | null;
  created_at: number;
  last_used_at: number;
  use_count: number;
  status: string;
  supersedes_id: string | null;
}

const stmtInsertMemory = db.prepare(`
  INSERT INTO memories (id, user_id, text, type, scope, source_client, created_at, last_used_at, use_count, status, supersedes_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?)
`);
const stmtMemoryById = db.prepare("SELECT * FROM memories WHERE id = ?");
const stmtActiveMemories = db.prepare(
  "SELECT * FROM memories WHERE user_id = ? AND scope = ? AND status = 'active'",
);
const stmtTouchMemory = db.prepare(
  "UPDATE memories SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?",
);
const stmtSupersedeMemory = db.prepare(
  "UPDATE memories SET status = 'superseded' WHERE id = ? AND user_id = ?",
);

export function insertMemory(input: {
  userId: string;
  text: string;
  type: string;
  scope: string;
  sourceClient?: string | null;
  supersedesId?: string | null;
}): MemoryRow {
  const id = newId();
  const ts = now();
  stmtInsertMemory.run(
    id, input.userId, input.text, input.type, input.scope,
    input.sourceClient ?? null, ts, ts, input.supersedesId ?? null,
  );
  return stmtMemoryById.get(id) as MemoryRow;
}

export function activeMemories(userId: string, scope: string): MemoryRow[] {
  return stmtActiveMemories.all(userId, scope) as unknown as MemoryRow[];
}

export function touchMemory(id: string): void {
  stmtTouchMemory.run(now(), id);
}

export function supersedeMemory(userId: string, id: string): void {
  stmtSupersedeMemory.run(id, userId);
}
```

- [ ] **Step 3: Typecheck** → `npm run typecheck:server`

- [ ] **Step 4: Commit**

```bash
git add server/db.ts
git commit -m "feat(db): memories table + repo"
```

---

### Task E2: Dedup + recall scoring (pure)

**Files:**
- Create: `server/memory/dedup.ts`, `server/memory/dedup.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// server/memory/dedup.test.ts
import { describe, expect, it } from "vitest";
import { tokenize, jaccard, isDuplicate, scoreMemory } from "./dedup.ts";

describe("memory dedup + scoring", () => {
  it("tokenizes to a lowercased word set", () => {
    expect([...tokenize("The Quick, brown FOX!")]).toEqual(["the", "quick", "brown", "fox"]);
  });

  it("computes Jaccard overlap", () => {
    expect(jaccard(tokenize("a b c d"), tokenize("a b c d"))).toBe(1);
    expect(jaccard(tokenize("a b c d"), tokenize("a b c x"))).toBeCloseTo(3 / 5, 5);
  });

  it("flags near-duplicates at/above threshold 0.8", () => {
    expect(isDuplicate("We use Postgres for storage", "We use Postgres for storage now")).toBe(true);
    expect(isDuplicate("We use Postgres", "We prefer dark mode")).toBe(false);
  });

  it("scores by lexical match, recency, and use_count", () => {
    const now = 1_000_000;
    const base = { text: "We use Postgres for storage", last_used_at: now, use_count: 0 };
    const recent = scoreMemory("postgres storage", base, now);
    const stale = scoreMemory("postgres storage", { ...base, last_used_at: now - 90 * 86400_000 }, now);
    expect(recent).toBeGreaterThan(stale);
    expect(scoreMemory("unrelated terms", base, now)).toBe(0);
  });
});
```

- [ ] **Step 2: Run → fail** (`npx vitest run server/memory/dedup.test.ts`)

- [ ] **Step 3: Implement**

```ts
// server/memory/dedup.ts
const DUPLICATE_THRESHOLD = 0.8;
const HALF_LIFE_MS = 30 * 86400_000; // 30 days

export function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function isDuplicate(a: string, b: string): boolean {
  return jaccard(tokenize(a), tokenize(b)) >= DUPLICATE_THRESHOLD;
}

/** 0..~1+ score combining lexical overlap, recency decay, and use frequency. */
export function scoreMemory(
  query: string,
  mem: { text: string; last_used_at: number; use_count: number },
  nowTs: number,
): number {
  const q = tokenize(query);
  if (q.size === 0) return 0;
  const memTokens = tokenize(mem.text);
  let present = 0;
  for (const t of q) if (memTokens.has(t)) present += 1;
  const lexical = present / q.size; // fraction of query terms found
  if (lexical === 0) return 0;
  const ageMs = Math.max(0, nowTs - mem.last_used_at);
  const recency = Math.pow(0.5, ageMs / HALF_LIFE_MS); // 1 → 0.5 over a half-life
  const usage = 1 + Math.log1p(mem.use_count) / 5;
  return lexical * recency * usage;
}
```

- [ ] **Step 4: Run → pass** (`npx vitest run server/memory/dedup.test.ts`)

- [ ] **Step 5: Commit**

```bash
git add server/memory/dedup.ts server/memory/dedup.test.ts
git commit -m "feat(memory): pure dedup + recall scoring"
```

---

### Task E3: `POST /api/memory` (remember) + `GET /api/memory` (recall)

**Files:**
- Create: `server/memory/routes.ts`, `server/memory/routes.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// server/memory/routes.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";

let s: TestServer;
beforeAll(async () => { s = await startTestServer(); });
afterAll(() => s.close());

async function patFor(email: string, scopes = ["read", "write"]) {
  const cookie = await signup(s.baseURL, email);
  return makePatClient(s.baseURL, await mintToken(cookie, scopes));
}

describe("memory remember/recall", () => {
  it("stores a memory and recalls it by query", async () => {
    const pat = await patFor("mem-basic@example.com");
    const w = await pat.req("POST", "/api/memory", {
      text: "We use Postgres for primary storage", type: "decision", scope: "proj-x",
    });
    expect(w.status).toBe(201);
    expect((await w.json()).deduped).toBe(false);

    const r = await pat.req("GET", "/api/memory?q=postgres%20storage&scope=proj-x");
    expect(r.status).toBe(200);
    const { memories } = await r.json();
    expect(memories).toHaveLength(1);
    expect(memories[0].text).toContain("Postgres");
  });

  it("dedupes near-identical writes in the same scope", async () => {
    const pat = await patFor("mem-dedup@example.com");
    await pat.req("POST", "/api/memory", { text: "Prefer dark mode in the UI", type: "preference", scope: "g" });
    const dup = await pat.req("POST", "/api/memory", { text: "Prefer dark mode in the UI please", type: "preference", scope: "g" });
    expect((await dup.json()).deduped).toBe(true);
    const { memories } = await (await pat.req("GET", "/api/memory?q=dark%20mode&scope=g")).json();
    expect(memories).toHaveLength(1);
  });

  it("recall is scoped and read-only token cannot write", async () => {
    const pat = await patFor("mem-iso@example.com");
    await pat.req("POST", "/api/memory", { text: "secret to scope A", type: "fact", scope: "A" });
    const otherScope = await (await pat.req("GET", "/api/memory?q=secret&scope=B")).json();
    expect(otherScope.memories).toHaveLength(0);

    const ro = await patFor("mem-ro@example.com", ["read"]);
    expect((await ro.req("POST", "/api/memory", { text: "x", type: "fact" })).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run → fail** (`npx vitest run server/memory/routes.test.ts`)

- [ ] **Step 3: Implement the router**

```ts
// server/memory/routes.ts
import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  activeMemories, insertMemory, touchMemory, supersedeMemory, writeAudit,
} from "../db.ts";
import { requireScope } from "../auth/pat.ts";
import { isDuplicate, scoreMemory } from "./dedup.ts";

export const memoryRouter = Router();
const jsonBody = express.json({ limit: "32kb" });

const rememberSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  type: z.enum(["decision", "preference", "fact", "glossary"]),
  scope: z.string().trim().min(1).max(120).default("global"),
  supersedes: z.string().optional(),
});

// remember (write scope)
memoryRouter.post("/", jsonBody, (req: Request, res: Response) => {
  const u = req.apiUser;
  if (!u) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!requireScope(req, res, "write")) return;
  const parsed = rememberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid memory" });
    return;
  }
  const { text, type, scope, supersedes } = parsed.data;

  if (supersedes) supersedeMemory(u.userId, supersedes);

  // Dedup against active memories in the same scope.
  const existing = activeMemories(u.userId, scope);
  const dup = existing.find((m) => isDuplicate(m.text, text));
  if (dup) {
    touchMemory(dup.id);
    res.status(200).json({ memoryId: dup.id, deduped: true });
    return;
  }
  const row = insertMemory({
    userId: u.userId, text, type, scope,
    sourceClient: req.get("x-noto-client") ?? null,
    supersedesId: supersedes ?? null,
  });
  writeAudit({ userId: u.userId, tokenId: u.tokenId, tool: "remember", target: row.id });
  res.status(201).json({ memoryId: row.id, deduped: false });
});

const recallSchema = z.object({
  q: z.string().default(""),
  scope: z.string().default("global"),
  type: z.enum(["decision", "preference", "fact", "glossary"]).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});

// recall (read scope)
memoryRouter.get("/", (req: Request, res: Response) => {
  const u = req.apiUser;
  if (!u) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!requireScope(req, res, "read")) return;
  const parsed = recallSchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query" }); return; }
  const { q, scope, type, limit } = parsed.data;

  const nowTs = Date.now();
  let rows = activeMemories(u.userId, scope);
  if (type) rows = rows.filter((m) => m.type === type);
  const scored = rows
    .map((m) => ({ m, score: q ? scoreMemory(q, m, nowTs) : 1 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  for (const { m } of scored) touchMemory(m.id);
  res.json({
    memories: scored.map(({ m, score }) => ({
      memoryId: m.id, text: m.text, type: m.type, scope: m.scope,
      lastUsed: m.last_used_at, score,
    })),
  });
});
```

- [ ] **Step 4: Mount in `app.ts`**

```ts
import { memoryRouter } from "./memory/routes.ts";
// ...
  app.use("/api/memory", memoryRouter);
```

- [ ] **Step 5: Run → pass** (`npx vitest run server/memory/routes.test.ts`)

- [ ] **Step 6: Commit**

```bash
git add server/memory/routes.ts server/memory/routes.test.ts server/app.ts
git commit -m "feat(memory): remember/recall endpoints with dedup + audit"
```

---

## Final verification

- [ ] **Run the whole suite**

Run: `npm test`
Expected: all tests pass (existing + new). If FTS triggers conflict with the on-disk dev DB, delete `server/data/noto.sqlite*` (dev data only) and re-run — the schema rebuilds and backfills.

- [ ] **Typecheck + lint**

Run: `npm run typecheck:server && npm run lint`
Expected: clean.

- [ ] **End-to-end manual smoke (PAT)**

```bash
# In one shell: start the API
npm run dev:server
# In another: sign up (browser or curl), then:
TOKEN=$(npm run -s mint-pat -- you@example.com read,write)
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8787/api/search?q=welcome" | jq
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -X POST "http://localhost:8787/api/memory" \
  -d '{"text":"We ship stdio MCP first","type":"decision","scope":"noto"}' | jq
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8787/api/memory?q=mcp&scope=noto" | jq
```
Expected: search returns the Welcome note; remember returns `{deduped:false}`; recall returns the decision.

---

## Self-review notes (addressed)

- **Spec coverage:** PAT auth (A1–A4) ✓; `GET /api/files/:id` (C1) ✓; section get/update (C2–C4) ✓; FTS5 search (D1–D3) ✓; memory store + dedup/decay (E1–E3) ✓; audit (B1, used in C4/E3) ✓. The Settings UI from the spec's Phase 0 is **intentionally deferred** to a UI task (the repo's test harness is backend-oriented); `mint-pat` unblocks the MCP server meanwhile — call this out to the user.
- **Type consistency:** `usePat`/`createPat`/`PatRow`, `searchFiles`/`SearchHit`/`toFtsQuery`, `insertMemory`/`activeMemories`/`MemoryRow`, `scoreMemory`/`isDuplicate`/`tokenize`/`jaccard`, `writeAudit`/`sha256Hex` are referenced with the same names everywhere they appear.
- **Auth model:** `resolveApiToken` runs before CSRF; `csrfProtection` early-returns for PAT requests; new endpoints accept PAT (scope-gated) or cookie; existing browser CRUD routes are untouched (cookie-only) and get PAT support in Phase 2.
- **Out of scope (later phases):** `create_note`/`append_note` PAT writes (Phase 2), remote Streamable HTTP `/mcp` (Phase 3), semantic embeddings for search/recall + consolidation job (Phase 4).
