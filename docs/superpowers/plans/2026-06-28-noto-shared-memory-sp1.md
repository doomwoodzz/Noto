# Noto Shared Memory — SP1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundational shared-memory slice — Claude Code reads the user's notes and reads/writes an atomic, provenance-stamped memory store over a stdio MCP server (`noto-mcp`), authenticated by a Personal Access Token, with ownership isolation.

**Architecture:** A thin stdio `noto-mcp` npm package bridges new + existing PAT-authed Express endpoints. SP1 adds a `memories` table (+ FTS5), `/api/memory/*`, FTS5 note search (`GET /api/search`), a refs-only `GET /api/notes`, a least-privilege `memory` PAT scope, the 6-tool `noto-mcp` server, and a Settings "Connect AI tools" panel. It **reuses** the already-built PAT auth, `/api/tokens`, `audit_log`, single-note GET, and section GET.

**Tech Stack:** Node 22+ / Express 5, `node:sqlite` (FTS5), zod 4, vitest 3, TypeScript 6 (`.ts` import extensions, run via `tsx`); `@modelcontextprotocol/sdk` (new dep, `noto-mcp` only); React 19 for the Settings panel.

---

## Context primer (for a cold session)

**Noto** is a hosted web app (`landing/`: React 19 + Express 5 + SQLite via `node:sqlite`, WAL) for Markdown notes with a wiki-link graph, client-side semantic search, an OpenAI AI window, and link citations. The server is source of truth; auth is a session cookie **or** a PAT bearer token. Tables: `users, sessions, vaults, files, pat_tokens, audit_log`.

**The wedge:** *Noto is the app that remembers — the notes vault that doubles as the shared, auditable memory your Claude Code / Cursor / ChatGPT read from and write back to.* SP1 is the first, lowest-risk slice of that wedge: an AI tool reads your notes and shares **atomic memory** across sessions, on Claude Code, with provenance recorded.

**Why SP1 looks the way it does:** decided in `docs/superpowers/specs/2026-06-28-noto-shared-memory-sp1-design.md` (read it — esp. §0b Addendum, which is authoritative). Key locks: read tools + atomic `remember`/`recall` only (**no note-body writes**); minimal hygiene (exact-dedup + supersede corrections; bm25+recency recall; no decay/fuzzy-dedup yet); provenance recorded from day one; scope auto-detected by the MCP from git remote/cwd; reads union `global`, writes exact scope.

## Scope

**In:** `memory` PAT scope · `memories` table + FTS5 + `db.ts` helpers · `/api/memory` (remember/recall) + `/api/memory/list` · `files_fts` + `GET /api/search` · `GET /api/notes` (refs) · `noto-mcp` package (6 tools: search_notes, list_notes, get_note, get_section, remember, recall) · client `api.pat.*` + `api.memory.list` · Settings "Connect AI tools (MCP)" panel.

**Out (do NOT build — later sub-projects):** note-body write tools (`create_note`/`append_note`/`update_section`) → SP2 · narrative `Memory/*.md` pages → SP2 · Cursor/Codex wiring + steering → SP2 · provenance UI / revert → SP3 · remote `/mcp` HTTP → SP4 · embeddings/semantic/decay/consolidation → SP5 · multi-vault selection · pagination · any `delete` tool.

## Dependency note — what already exists (verified in code 2026-06-28)

**REUSE, do not rebuild:** PAT auth (`landing/server/auth/pat.ts`), `/api/tokens` mint/list/revoke (`landing/server/tokens/routes.ts`), `pat_tokens` table + `createPat/usePat/listPatsForUser/revokePat`, **`audit_log` table + `writeAudit({userId,tokenId,tool,target,beforeHash})` + `listAuditForUser`**, `GET /api/files/:fileId`, `GET /api/files/:fileId/section` (returns `{fileId, headingPath, content}`; 404 `{error, headings}` on miss), `landing/server/notes/sections.ts` (`getSection`, `listHeadings`), `resolveUserId` (PAT-or-cookie), `sha256Hex`, `toPublicFile`, and the test harness `landing/server/test-helpers.ts` (`startTestServer`, `makePatClient`, `mintToken`, `signup`). **The `noto-mcp` package does NOT exist; `@modelcontextprotocol/sdk` is NOT a dependency.**

## Global constraints (copied verbatim from the spec — honor in every task)

- **Scope rule:** Reads (`search_notes`, `recall`) return results from `scope ∪ 'global'`; an explicit `scope:'global'` returns just global. Writes (`remember`) land in exactly `scope` (current project by default, `global` only on override). A write never silently fans out.
- **Limits:** search_notes 5 (max 20), snippet ≤160 chars; list_notes 20 (max 50); recall 6 (max 20); `memories.text` ≤2 KB; get_note bounded by the 256 KB note cap.
- **Auth:** every endpoint accepts PAT **or** session cookie; reuse ownership scoping (`getOwnedFile`-style); **404-on-miss, never 403, for ownership**; insufficient PAT scope → 403; missing/invalid/revoked PAT → 401.
- **Provenance:** every `remember`/supersede stamps `memories.source_client` (from `X-Noto-Client`, default `claude-code` from the MCP, `web` otherwise) and writes an `audit_log` row.
- **Conventions:** imports use explicit `.ts` extensions; all SQL lives in `db.ts` as module-top prepared statements; validation error = `400 {error: parsed.error.issues[0]?.message ?? "<fallback>"}`; booleans stored as 0/1; new env vars go in `env.ts` zod schema (+ `vitest.config.ts` `test.env` if a route depends on them).

## Start here

Begin with **Task 1** (add the `memory` PAT scope) — every memory route depends on it. Work top to bottom: Part A (server, Tasks 1–6) → Part B (`noto-mcp`, Tasks 7–9) → Part C (client + UI, Tasks 10–12). Run `npm test` from `landing/` after each server task; `npm test` from `noto-mcp/` for Part B.

---

## File structure

**Server — `landing/server/` (modify + create):**
- `auth/pat.ts` — MODIFY: add `"memory"` to the `Scope` union.
- `tokens/routes.ts` — MODIFY: add `"memory"` to the mint enum.
- `db.ts` — MODIFY: `memories` table + `memories_fts` + `files_fts` + triggers + indexes; helpers `rememberMemory`, `recallMemories`, `listMemories`, `searchFiles`; types `MemoryRow`, `PublicMemory`.
- `memory/routes.ts` + `memory/routes.test.ts` — CREATE: `/api/memory` (POST remember, GET recall), `/api/memory/list`.
- `search/routes.ts` + `search/routes.test.ts` — CREATE: `GET /api/search`, `GET /api/notes`.
- `search/snippet.ts` + `search/snippet.test.ts` — CREATE: heading-path + snippet helper (server-native, reuses `sections.ts`).
- `app.ts` — MODIFY: mount `memoryRouter` and `searchRouter`.

**Package — `noto-mcp/` (repo root, all CREATE):**
- `package.json`, `tsconfig.json`
- `src/scope.ts` + `src/scope.test.ts` — git-remote/cwd scope detection.
- `src/notoClient.ts` + `src/notoClient.test.ts` — HTTP client.
- `src/tools.ts` — the 6 tool handler factories + `registerTools`.
- `src/index.ts` — env + stdio server bootstrap.

**Client/UI — `landing/src/` (modify + create):**
- `app/api.ts` — MODIFY: add `pat.*` + `memory.list`.
- `workspace/mcpClient.ts` — CREATE: `McpClient` interface + types.
- `app/mcpClient.ts` — CREATE: `realMcpClient` wrapping `api`.
- `workspace/McpSettings.tsx` — CREATE: the panel.
- `workspace/Sidebar.tsx` — MODIFY: `AccountFooter` adds a "Connect AI tools" menu item.
- `workspace/NotoWindow.tsx` — MODIFY: accept `mcpClient?`, render the panel overlay.
- `app/NotoWorkspace.tsx` — MODIFY: inject `realMcpClient`.

---

# Part A — Server

### Task 1: Add the `memory` PAT scope

**Files:**
- Modify: `landing/server/auth/pat.ts`
- Modify: `landing/server/tokens/routes.ts`
- Test: `landing/server/tokens/scope.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `landing/server/tokens/scope.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, signup, type TestServer } from "../test-helpers.ts";

let s: TestServer;
beforeAll(async () => { s = await startTestServer(); });
afterAll(() => s.close());

describe("PAT 'memory' scope", () => {
  it("mints a token carrying read + memory scopes", async () => {
    const cookie = await signup(s.baseURL, "scope-memory@example.com");
    const res = await cookie.req("POST", "/api/tokens", { name: "claude", scopes: ["read", "memory"] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { scopes: string[] };
    expect(body.scopes).toEqual(["read", "memory"]);
  });

  it("rejects an unknown scope", async () => {
    const cookie = await signup(s.baseURL, "scope-bad@example.com");
    const res = await cookie.req("POST", "/api/tokens", { name: "x", scopes: ["telepathy"] });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run (from `landing/`): `npx vitest run server/tokens/scope.test.ts`
Expected: FAIL — the first test 400s because `"memory"` is not in the mint enum.

- [ ] **Step 3: Add `"memory"` to the `Scope` union**

In `landing/server/auth/pat.ts`, change:
```ts
export type Scope = "read" | "write" | "destructive";
```
to:
```ts
export type Scope = "read" | "write" | "destructive" | "memory";
```

- [ ] **Step 4: Add `"memory"` to the mint enum**

In `landing/server/tokens/routes.ts`, change:
```ts
  scopes: z.array(z.enum(["read", "write", "destructive"])).min(1).max(3),
```
to:
```ts
  scopes: z.array(z.enum(["read", "write", "destructive", "memory"])).min(1).max(4),
```

- [ ] **Step 5: Run the tests — verify they pass**

Run: `npx vitest run server/tokens/scope.test.ts`
Expected: PASS (both).

- [ ] **Step 6: Commit**

```bash
git add landing/server/auth/pat.ts landing/server/tokens/routes.ts landing/server/tokens/scope.test.ts
git commit -m "feat(server): add least-privilege 'memory' PAT scope"
```

---

### Task 2: `memories` table + FTS + db.ts helpers

**Files:**
- Modify: `landing/server/db.ts`
- Test: `landing/server/memory/store.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `landing/server/memory/store.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createUser, rememberMemory, recallMemories, listMemories } from "../db.ts";

function freshUser(email: string) {
  return createUser({ email, passwordHash: "x" }).id;
}

describe("memory store", () => {
  it("inserts a memory and recalls it by query within scope ∪ global", () => {
    const uid = freshUser("mem-a@example.com");
    rememberMemory({ userId: uid, text: "We use Vitest for tests", type: "decision", scope: "proj/x", sourceClient: "claude-code" });
    const hits = recallMemories(uid, ["proj/x"], "vitest", undefined, 6);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe("We use Vitest for tests");
    expect(hits[0].sourceClient).toBe("claude-code");
  });

  it("dedups exact-normalized text in the same scope (bumps use_count, no duplicate)", () => {
    const uid = freshUser("mem-b@example.com");
    const a = rememberMemory({ userId: uid, text: "Prefer tabs", type: "preference", scope: "proj/y", sourceClient: "claude-code" });
    const b = rememberMemory({ userId: uid, text: "  prefer   TABS  ", type: "preference", scope: "proj/y", sourceClient: "claude-code" });
    expect(b.deduped).toBe(true);
    expect(b.memory.id).toBe(a.memory.id);
    expect(listMemories(uid, "proj/y", undefined, 50)).toHaveLength(1);
  });

  it("supersede retires the old fact and excludes it from recall", () => {
    const uid = freshUser("mem-c@example.com");
    const old = rememberMemory({ userId: uid, text: "DB is Postgres", type: "fact", scope: "proj/z", sourceClient: "claude-code" });
    rememberMemory({ userId: uid, text: "DB is SQLite", type: "fact", scope: "proj/z", sourceClient: "claude-code", supersedesId: old.memory.id });
    const hits = recallMemories(uid, ["proj/z"], "DB", undefined, 6);
    expect(hits.map((h) => h.text)).toEqual(["DB is SQLite"]);
  });

  it("reads union global; a project query also surfaces global prefs", () => {
    const uid = freshUser("mem-d@example.com");
    rememberMemory({ userId: uid, text: "Always write conventional commits", type: "preference", scope: "global", sourceClient: "claude-code" });
    rememberMemory({ userId: uid, text: "This service owns billing", type: "fact", scope: "proj/q", sourceClient: "claude-code" });
    const hits = recallMemories(uid, ["proj/q"], "commits", undefined, 6);
    expect(hits.map((h) => h.text)).toContain("Always write conventional commits");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run server/memory/store.test.ts`
Expected: FAIL — `rememberMemory`/`recallMemories`/`listMemories` are not exported from `db.ts`.

- [ ] **Step 3: Add the tables + indexes to the `db.exec(...)` schema block**

In `landing/server/db.ts`, inside the existing big `db.exec(\` ... \`)` that declares the tables, append before the closing backtick:
```sql
  CREATE TABLE IF NOT EXISTS memories (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text           TEXT NOT NULL,
    type           TEXT NOT NULL DEFAULT 'fact',
    scope          TEXT NOT NULL,
    source_client  TEXT NOT NULL DEFAULT 'web',
    norm_text      TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    last_used_at   INTEGER NOT NULL,
    use_count      INTEGER NOT NULL DEFAULT 1,
    status         TEXT NOT NULL DEFAULT 'active',
    supersedes_id  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(user_id, scope, status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_dedup ON memories(user_id, scope, norm_text) WHERE status = 'active';

  CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(memory_id UNINDEXED, text);

  CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(memory_id, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    DELETE FROM memories_fts WHERE memory_id = old.id;
  END;
  CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF text ON memories BEGIN
    DELETE FROM memories_fts WHERE memory_id = old.id;
    INSERT INTO memories_fts(memory_id, text) VALUES (new.id, new.text);
  END;
```

- [ ] **Step 4: Add types, prepared statements, and helpers**

In `landing/server/db.ts`, near the other types/statements (module top-level), add:
```ts
export interface MemoryRow {
  id: string; user_id: string; text: string; type: string; scope: string;
  source_client: string; norm_text: string; created_at: number; last_used_at: number;
  use_count: number; status: string; supersedes_id: string | null;
}
export interface PublicMemory {
  id: string; text: string; type: string; scope: string;
  sourceClient: string; lastUsed: number; useCount: number;
}

function normalizeMemoryText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
function toPublicMemory(r: MemoryRow): PublicMemory {
  return { id: r.id, text: r.text, type: r.type, scope: r.scope,
    sourceClient: r.source_client, lastUsed: r.last_used_at, useCount: r.use_count };
}

const stmtActiveByNorm = db.prepare(
  "SELECT * FROM memories WHERE user_id = ? AND scope = ? AND norm_text = ? AND status = 'active'",
);
const stmtBumpMemory = db.prepare(
  "UPDATE memories SET use_count = use_count + 1, last_used_at = ? WHERE id = ?",
);
const stmtInsertMemory = db.prepare(
  `INSERT INTO memories (id, user_id, text, type, scope, source_client, norm_text,
     created_at, last_used_at, use_count, status, supersedes_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?)`,
);
const stmtSupersede = db.prepare("UPDATE memories SET status = 'superseded' WHERE id = ? AND user_id = ?");
const stmtMemoryById = db.prepare("SELECT * FROM memories WHERE id = ?");

export function rememberMemory(input: {
  userId: string; text: string; type?: string; scope?: string;
  sourceClient?: string; supersedesId?: string;
}): { memory: PublicMemory; deduped: boolean } {
  const scope = input.scope && input.scope.trim() ? input.scope.trim() : "global";
  const type = input.type ?? "fact";
  const sourceClient = input.sourceClient ?? "web";
  const norm = normalizeMemoryText(input.text);
  const ts = now();

  // Correction: retire the superseded fact (kept for audit, hidden from recall).
  if (input.supersedesId) {
    stmtSupersede.run(input.supersedesId, input.userId);
  }
  // Exact-normalized dedup within scope → bump instead of inserting a duplicate.
  if (!input.supersedesId) {
    const existing = stmtActiveByNorm.get(input.userId, scope, norm) as MemoryRow | undefined;
    if (existing) {
      stmtBumpMemory.run(ts, existing.id);
      return { memory: toPublicMemory({ ...existing, use_count: existing.use_count + 1, last_used_at: ts }), deduped: true };
    }
  }
  const id = newId();
  stmtInsertMemory.run(id, input.userId, input.text, type, scope, sourceClient, norm, ts, ts, input.supersedesId ?? null);
  return { memory: toPublicMemory(stmtMemoryById.get(id) as MemoryRow), deduped: false };
}

const stmtBumpUse = db.prepare("UPDATE memories SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?");

/** Recall by FTS (bm25) + recency, filtered to status='active' and the given scopes. */
export function recallMemories(
  userId: string, scopes: string[], query: string, type: string | undefined, limit: number,
): (PublicMemory & { score: number })[] {
  const scopeList = [...new Set([...scopes, "global"])];
  const scopePlaceholders = scopeList.map(() => "?").join(",");
  const typeClause = type ? "AND m.type = ?" : "";
  const q = query.trim();
  let rows: (MemoryRow & { score: number })[];
  if (q) {
    const sql =
      `SELECT m.*, bm25(memories_fts) AS score
       FROM memories_fts JOIN memories m ON m.id = memories_fts.memory_id
       WHERE memories_fts MATCH ? AND m.user_id = ? AND m.status = 'active'
         AND m.scope IN (${scopePlaceholders}) ${typeClause}
       ORDER BY score ASC, m.last_used_at DESC LIMIT ?`;
    const args = [ftsQuery(q), userId, ...scopeList, ...(type ? [type] : []), limit];
    rows = db.prepare(sql).all(...args) as (MemoryRow & { score: number })[];
  } else {
    const sql =
      `SELECT m.*, 0 AS score FROM memories m
       WHERE m.user_id = ? AND m.status = 'active' AND m.scope IN (${scopePlaceholders}) ${typeClause}
       ORDER BY m.last_used_at DESC LIMIT ?`;
    const args = [userId, ...scopeList, ...(type ? [type] : []), limit];
    rows = db.prepare(sql).all(...args) as (MemoryRow & { score: number })[];
  }
  const ts = now();
  for (const r of rows) stmtBumpUse.run(ts, r.id);
  return rows.map((r) => ({ ...toPublicMemory(r), score: r.score }));
}

/** Recency-ordered browse for the Settings UI (no query). */
export function listMemories(
  userId: string, scope: string | undefined, type: string | undefined, limit: number,
): PublicMemory[] {
  const clauses = ["user_id = ?", "status = 'active'"];
  const args: (string | number)[] = [userId];
  if (scope) { clauses.push("scope IN (?, 'global')"); args.push(scope); }
  if (type) { clauses.push("type = ?"); args.push(type); }
  args.push(limit);
  const rows = db.prepare(
    `SELECT * FROM memories WHERE ${clauses.join(" AND ")} ORDER BY last_used_at DESC LIMIT ?`,
  ).all(...args) as MemoryRow[];
  return rows.map(toPublicMemory);
}
```

Also add this FTS-query sanitizer near the top of `db.ts` (used by recall and search — escapes user input into a safe FTS5 prefix query):
```ts
/** Turn arbitrary user text into a safe FTS5 MATCH query: quote each token, OR them, prefix-match. */
export function ftsQuery(raw: string): string {
  const tokens = raw.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"*`).join(" OR ");
}
```

- [ ] **Step 5: Run the tests — verify they pass**

Run: `npx vitest run server/memory/store.test.ts`
Expected: PASS (all four). If the first test errors with "no such module: fts5", STOP — Node's bundled SQLite lacks FTS5; surface this immediately (it is enabled in Node ≥ 22 default builds).

- [ ] **Step 6: Commit**

```bash
git add landing/server/db.ts landing/server/memory/store.test.ts
git commit -m "feat(server): memories table + FTS5 + rememberMemory/recallMemories/listMemories"
```

---

### Task 3: `/api/memory` routes (remember + recall)

**Files:**
- Create: `landing/server/memory/routes.ts`
- Modify: `landing/server/app.ts`
- Test: `landing/server/memory/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `landing/server/memory/routes.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";

let s: TestServer;
beforeAll(async () => { s = await startTestServer(); });
afterAll(() => s.close());

async function memToken(email: string) {
  const cookie = await signup(s.baseURL, email);
  const token = await mintToken(cookie, ["read", "memory"], "claude");
  return { cookie, pat: makePatClient(s.baseURL, token) };
}

describe("/api/memory", () => {
  it("remembers (memory scope) then recalls (read scope) with the X-Noto-Client provenance", async () => {
    const { pat } = await memToken("route-mem@example.com");
    const wrote = await pat.req("POST", "/api/memory", { text: "Auth uses scrypt", type: "decision", scope: "proj/api" }, { "X-Noto-Client": "claude-code" });
    expect(wrote.status).toBe(201);
    const { memoryId, deduped } = (await wrote.json()) as { memoryId: string; deduped: boolean };
    expect(deduped).toBe(false);
    expect(memoryId).toBeTruthy();

    const got = await pat.req("GET", "/api/memory?q=scrypt&scope=proj/api&limit=6");
    expect(got.status).toBe(200);
    const { memories } = (await got.json()) as { memories: { text: string; sourceClient: string }[] };
    expect(memories[0].text).toBe("Auth uses scrypt");
    expect(memories[0].sourceClient).toBe("claude-code");
  });

  it("rejects remember from a read-only token (403) and accepts recall (read)", async () => {
    const cookie = await signup(s.baseURL, "route-ro@example.com");
    const ro = makePatClient(s.baseURL, await mintToken(cookie, ["read"], "ro"));
    expect((await ro.req("POST", "/api/memory", { text: "x", scope: "p" })).status).toBe(403);
    expect((await ro.req("GET", "/api/memory?q=x")).status).toBe(200);
  });

  it("isolates memory between users", async () => {
    const a = await memToken("route-iso-a@example.com");
    await a.pat.req("POST", "/api/memory", { text: "A secret", scope: "p" }, { "X-Noto-Client": "claude-code" });
    const b = await memToken("route-iso-b@example.com");
    const { memories } = (await (await b.pat.req("GET", "/api/memory?q=secret")).json()) as { memories: unknown[] };
    expect(memories).toHaveLength(0);
  });
});
```

> Note: this test passes a 4th `headers` arg to `pat.req`. The existing `makePatClient` in `test-helpers.ts` may not forward extra headers — Step 3 patches it.

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run server/memory/routes.test.ts`
Expected: FAIL — no `/api/memory` route (404), and/or `pat.req` ignores the headers arg.

- [ ] **Step 3: Let `makePatClient` forward extra headers**

In `landing/server/test-helpers.ts`, find the `makePatClient` `req` function and extend its signature to merge an optional headers object. Replace its `req` with:
```ts
  async function req(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...extra };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(baseURL + path, {
      method, headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    return res;
  }
```
(Keep the rest of `makePatClient` unchanged; this only adds the optional `extra` headers param.)

- [ ] **Step 4: Create the router**

Create `landing/server/memory/routes.ts`:
```ts
/**
 * Atomic memory API — the remember/recall store behind the MCP layer.
 * Reuses PAT auth + audit_log. Reads require 'read' scope; remember requires 'memory'.
 * Ownership is enforced by user_id; 404/empty never leaks another user's data.
 */
import express, { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { getCurrentUser } from "../auth/session.ts";
import { requireScope } from "../auth/pat.ts";
import { rememberMemory, recallMemories, listMemories, writeAudit } from "../db.ts";

export const memoryRouter = Router();
const jsonBody = express.json({ limit: "16kb" });

const memoryLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 120,
  standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many memory requests. Please slow down." },
});

function resolveUserId(req: Request, res: Response): string | null {
  if (req.apiUser) return req.apiUser.userId;
  const u = getCurrentUser(req);
  if (!u) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return u.id;
}

const rememberSchema = z.object({
  text: z.string().trim().min(1).max(2048),
  type: z.enum(["decision", "preference", "fact", "glossary"]).default("fact"),
  scope: z.string().trim().max(200).optional(),
  supersedes: z.string().trim().max(64).optional(),
});

// POST /api/memory — remember (requires 'memory' scope for PATs).
memoryRouter.post("/", memoryLimiter, jsonBody, (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "memory")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const parsed = rememberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid memory" });
    return;
  }
  const sourceClient = (req.get("x-noto-client") || (req.apiUser ? "claude-code" : "web")).slice(0, 40);
  const { memory, deduped } = rememberMemory({
    userId: uid, text: parsed.data.text, type: parsed.data.type,
    scope: parsed.data.scope, sourceClient, supersedesId: parsed.data.supersedes,
  });
  writeAudit({
    userId: uid, tokenId: req.apiUser?.tokenId ?? null,
    tool: parsed.data.supersedes ? "supersede" : "remember",
    target: memory.id, beforeHash: null,
  });
  res.status(201).json({ memoryId: memory.id, deduped });
});

// GET /api/memory — recall (requires 'read' scope for PATs).
memoryRouter.get("/", memoryLimiter, (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "read")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const scope = typeof req.query.scope === "string" && req.query.scope ? req.query.scope : undefined;
  const type = typeof req.query.type === "string" && req.query.type ? req.query.type : undefined;
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 6));
  const scopes = scope ? (scope === "global" ? ["global"] : [scope]) : [];
  res.json({ memories: recallMemories(uid, scopes, q, type, limit) });
});

// GET /api/memory/list — recency browse for the Settings UI (cookie session).
memoryRouter.get("/list", memoryLimiter, (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "read")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const scope = typeof req.query.scope === "string" && req.query.scope ? req.query.scope : undefined;
  const type = typeof req.query.type === "string" && req.query.type ? req.query.type : undefined;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  res.json({ memories: listMemories(uid, scope, type, limit) });
});
```

- [ ] **Step 5: Mount the router**

In `landing/server/app.ts`, add the import near the other router imports:
```ts
import { memoryRouter } from "./memory/routes.ts";
```
and mount it alongside the others (after `app.use("/api/tokens", tokensRouter);`):
```ts
app.use("/api/memory", memoryRouter);
```

- [ ] **Step 6: Run the tests — verify they pass**

Run: `npx vitest run server/memory/routes.test.ts`
Expected: PASS (all three).

- [ ] **Step 7: Commit**

```bash
git add landing/server/memory/routes.ts landing/server/app.ts landing/server/test-helpers.ts landing/server/memory/routes.test.ts
git commit -m "feat(server): /api/memory remember + recall + list with scope enforcement and audit"
```

---

### Task 4: search snippet + heading-path helper (server-native)

**Files:**
- Create: `landing/server/search/snippet.ts`
- Test: `landing/server/search/snippet.test.ts`

- [ ] **Step 1: Write the failing test**

Create `landing/server/search/snippet.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { bestSnippet } from "./snippet.ts";

const NOTE = "# Cells\n\nIntro about biology.\n\n## Mitochondria\n\nThe mitochondria makes ATP for the cell.\n\n## Nucleus\n\nThe nucleus holds DNA.";

describe("bestSnippet", () => {
  it("returns the heading path and a snippet for the best-matching section", () => {
    const r = bestSnippet(NOTE, "ATP");
    expect(r.headingPath).toEqual(["Cells", "Mitochondria"]);
    expect(r.snippet).toContain("ATP");
    expect(r.snippet.length).toBeLessThanOrEqual(160);
  });

  it("falls back to the intro / empty heading path when no section matches", () => {
    const r = bestSnippet(NOTE, "biology");
    expect(r.snippet).toContain("biology");
  });

  it("never returns more than 160 chars", () => {
    const long = "# T\n\n## H\n\n" + "word ".repeat(200);
    expect(bestSnippet(long, "word").snippet.length).toBeLessThanOrEqual(160);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run server/search/snippet.test.ts`
Expected: FAIL — `./snippet.ts` does not exist.

- [ ] **Step 3: Implement the helper (reuses `sections.ts`)**

Create `landing/server/search/snippet.ts`:
```ts
import { getSection, listHeadings } from "../notes/sections.ts";

const MAX = 160;

function strip(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\(<?[^)]*>?\)/g, "$1")
    .replace(/\[\[([^[\]]+)\]\]/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(q: string): string[] {
  return (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);
}

function clip(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = lower.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return text.slice(0, MAX).trim();
  const start = Math.max(0, at - 40);
  let s = text.slice(start, start + MAX).trim();
  if (start > 0) s = "…" + s.slice(0, MAX - 1);
  return s.slice(0, MAX);
}

/** Pick the heading section that best matches `query`; return its path + a ≤160-char snippet. */
export function bestSnippet(content: string, query: string): { headingPath: string[]; snippet: string } {
  const terms = tokens(query);
  const score = (text: string) => {
    const l = text.toLowerCase();
    return terms.reduce((n, t) => n + (l.includes(t) ? 1 : 0), 0);
  };
  let best: { path: string[]; text: string; n: number } | null = null;
  for (const h of listHeadings(content)) {
    const sec = getSection(content, h.path);
    if (sec === null) continue;
    const text = strip(sec);
    const n = score(text);
    if (!best || n > best.n) best = { path: h.path.split("/"), text, n };
  }
  const introText = strip(content.replace(/^\s{0,3}#.*$/m, ""));
  const introN = score(introText);
  if (!best || introN > best.n) best = { path: [], text: introText, n: introN };
  return { headingPath: best.path, snippet: clip(best.text, terms) };
}
```

> If `listHeadings` returns objects whose property is not exactly `.path` (verify against `landing/server/notes/sections.ts`), adjust `h.path` to the real field name and the `.split("/")` accordingly.

- [ ] **Step 4: Run the tests — verify they pass**

Run: `npx vitest run server/search/snippet.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add landing/server/search/snippet.ts landing/server/search/snippet.test.ts
git commit -m "feat(server): heading-aware search snippet helper"
```

---

### Task 5: `files_fts` + `searchFiles` + `GET /api/search` + `GET /api/notes`

**Files:**
- Modify: `landing/server/db.ts`
- Create: `landing/server/search/routes.ts`
- Modify: `landing/server/app.ts`
- Test: `landing/server/search/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `landing/server/search/routes.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";

let s: TestServer;
beforeAll(async () => { s = await startTestServer(); });
afterAll(() => s.close());

async function seed(email: string) {
  const cookie = await signup(s.baseURL, email);
  const { vaults } = await (await cookie.req("GET", "/api/vaults")).json();
  const vaultId = vaults[0].id;
  await cookie.req("POST", `/api/vaults/${vaultId}/files`, {
    path: "Bio/Cells.md", title: "Cells",
    content: "# Cells\n\n## Mitochondria\n\nThe mitochondria makes ATP.\n\n## Nucleus\n\nHolds DNA.",
  });
  const token = await mintToken(cookie, ["read"], "r");
  return makePatClient(s.baseURL, token);
}

describe("GET /api/search", () => {
  it("finds a note by content and returns heading-addressable refs", async () => {
    const pat = await seed("search-a@example.com");
    const res = await pat.req("GET", "/api/search?q=ATP&limit=5");
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: { title: string; headingPath: string[]; snippet: string }[] };
    expect(results[0].title).toBe("Cells");
    expect(results[0].headingPath).toEqual(["Cells", "Mitochondria"]);
    expect(results[0].snippet).toContain("ATP");
  });

  it("does not return another user's notes", async () => {
    await seed("search-owner@example.com");
    const other = await signup(s.baseURL, "search-other@example.com");
    const pat = makePatClient(s.baseURL, await mintToken(other, ["read"], "r"));
    const { results } = (await (await pat.req("GET", "/api/search?q=ATP")).json()) as { results: unknown[] };
    expect(results).toHaveLength(0);
  });
});

describe("GET /api/notes", () => {
  it("lists recent notes as refs (no bodies)", async () => {
    const pat = await seed("notes-list@example.com");
    const res = await pat.req("GET", "/api/notes?by=recent&limit=20");
    expect(res.status).toBe(200);
    const { notes } = (await res.json()) as { notes: { title: string; path: string; content?: string }[] };
    expect(notes.some((n) => n.title === "Cells")).toBe(true);
    expect(notes[0]).not.toHaveProperty("content");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run server/search/routes.test.ts`
Expected: FAIL — `/api/search` and `/api/notes` don't exist.

- [ ] **Step 3: Add `files_fts` + triggers + `searchFiles` + a refs lister to `db.ts`**

In the `db.exec(\` ... \`)` schema block in `landing/server/db.ts`, append:
```sql
  CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(file_id UNINDEXED, vault_id UNINDEXED, title, content);

  CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
    INSERT INTO files_fts(file_id, vault_id, title, content) VALUES (new.id, new.vault_id, new.title, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
    DELETE FROM files_fts WHERE file_id = old.id;
  END;
  CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE OF title, content ON files BEGIN
    DELETE FROM files_fts WHERE file_id = old.id;
    INSERT INTO files_fts(file_id, vault_id, title, content) VALUES (new.id, new.vault_id, new.title, new.content);
  END;
```
Then, right after that `db.exec(...)` block, backfill any rows that predate the FTS table (idempotent):
```ts
// Backfill files_fts for any notes created before the FTS table existed.
{
  const missing = db.prepare(
    "SELECT f.id, f.vault_id, f.title, f.content FROM files f WHERE f.id NOT IN (SELECT file_id FROM files_fts)",
  ).all() as Array<{ id: string; vault_id: string; title: string; content: string }>;
  const ins = db.prepare("INSERT INTO files_fts(file_id, vault_id, title, content) VALUES (?, ?, ?, ?)");
  for (const f of missing) ins.run(f.id, f.vault_id, f.title, f.content);
}
```
Add these helpers (module-level), reusing `ftsQuery` from Task 2:
```ts
export interface SearchHit { fileId: string; title: string; path: string; content: string; score: number }

const stmtSearch = db.prepare(
  `SELECT f.id AS fileId, f.title AS title, f.path AS path, f.content AS content, bm25(files_fts) AS score
   FROM files_fts
   JOIN files f ON f.id = files_fts.file_id
   JOIN vaults v ON v.id = f.vault_id
   WHERE files_fts MATCH ? AND v.user_id = ?
   ORDER BY score ASC LIMIT ?`,
);
export function searchFiles(userId: string, query: string, limit: number): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  return stmtSearch.all(ftsQuery(q), userId, limit) as SearchHit[];
}

export interface NoteRef { fileId: string; title: string; path: string; updatedAt: number }
const stmtRecentNotes = db.prepare(
  `SELECT f.id AS fileId, f.title AS title, f.path AS path, f.updated_at AS updatedAt
   FROM files f JOIN vaults v ON v.id = f.vault_id
   WHERE v.user_id = ? ORDER BY f.updated_at DESC LIMIT ?`,
);
export function listNoteRefs(userId: string, limit: number): NoteRef[] {
  return stmtRecentNotes.all(userId, limit) as NoteRef[];
}
```

- [ ] **Step 4: Create the search router**

Create `landing/server/search/routes.ts`:
```ts
/** Read-only discovery endpoints for the MCP layer: FTS note search + a refs-only note list. */
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { getCurrentUser } from "../auth/session.ts";
import { requireScope } from "../auth/pat.ts";
import { searchFiles, listNoteRefs } from "../db.ts";
import { bestSnippet } from "./snippet.ts";

export const searchRouter = Router();
const limiter = rateLimit({
  windowMs: 60 * 1000, limit: 120,
  standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many search requests. Please slow down." },
});

function resolveUserId(req: Request, res: Response): string | null {
  if (req.apiUser) return req.apiUser.userId;
  const u = getCurrentUser(req);
  if (!u) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return u.id;
}

// GET /api/search?q=&limit= — FTS5 note search → heading-addressable refs + snippets.
searchRouter.get("/search", limiter, (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "read")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
  const results = searchFiles(uid, q, limit).map((h) => {
    const { headingPath, snippet } = bestSnippet(h.content, q);
    return { fileId: h.fileId, title: h.title, path: h.path, headingPath, snippet, score: h.score };
  });
  res.json({ results });
});

// GET /api/notes?by=recent&limit= — refs only (no bodies). SP1 supports by=recent.
searchRouter.get("/notes", limiter, (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "read")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  res.json({ notes: listNoteRefs(uid, limit) });
});
```

- [ ] **Step 5: Mount it**

In `landing/server/app.ts`, add:
```ts
import { searchRouter } from "./search/routes.ts";
```
and mount (after the notes router mount):
```ts
app.use("/api", searchRouter);
```

- [ ] **Step 6: Run the tests — verify they pass**

Run: `npx vitest run server/search/routes.test.ts`
Expected: PASS (all three).

- [ ] **Step 7: Commit**

```bash
git add landing/server/db.ts landing/server/search/routes.ts landing/server/app.ts landing/server/search/routes.test.ts
git commit -m "feat(server): files_fts + GET /api/search and GET /api/notes"
```

---

### Task 6: Full server regression

- [ ] **Step 1: Run the whole suite**

Run (from `landing/`): `npm test`
Expected: PASS — all new tests plus the existing suite (the FTS triggers must not break existing notes CRUD tests). If a pre-existing test fails because the FTS triggers fire on its fixture writes, fix the trigger/backfill, not the test.

- [ ] **Step 2: Typecheck the server**

Run: `npm run typecheck:server`
Expected: no errors.

- [ ] **Step 3: Commit (only if fixes were needed)**

```bash
git add -A landing/server
git commit -m "test(server): green full suite after memory + search additions"
```

---

# Part B — `noto-mcp` package

### Task 7: Package scaffold + scope detection

**Files:**
- Create: `noto-mcp/package.json`, `noto-mcp/tsconfig.json`
- Create: `noto-mcp/src/scope.ts`, `noto-mcp/src/scope.test.ts`

- [ ] **Step 1: Scaffold the package**

Create `noto-mcp/package.json`:
```json
{
  "name": "noto-mcp",
  "version": "0.1.0",
  "description": "MCP server exposing your Noto notes + shared memory to AI tools.",
  "type": "module",
  "bin": { "noto-mcp": "dist/index.js" },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "tsx": "^4.22.4",
    "typescript": "^5.6.0",
    "vitest": "^3.2.4"
  }
}
```
Create `noto-mcp/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": false,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Install deps**

Run (from `noto-mcp/`): `npm install`
Expected: installs `@modelcontextprotocol/sdk`, `zod`, `tsx`, `typescript`, `vitest`. If `@modelcontextprotocol/sdk@^1.12.0` is unavailable, run `npm view @modelcontextprotocol/sdk version`, pin the latest `1.x`, and update `package.json`.

- [ ] **Step 3: Write the failing scope test**

Create `noto-mcp/src/scope.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { normalizeRemote, detectScope } from "./scope.ts";

describe("normalizeRemote", () => {
  it("normalizes ssh and https GitHub remotes to a stable key", () => {
    expect(normalizeRemote("git@github.com:Acme/Widgets.git")).toBe("github.com/acme/widgets");
    expect(normalizeRemote("https://github.com/Acme/Widgets.git")).toBe("github.com/acme/widgets");
    expect(normalizeRemote("https://user:tok@gitlab.com/g/p")).toBe("gitlab.com/g/p");
  });
  it("returns null for empty input", () => {
    expect(normalizeRemote("")).toBeNull();
  });
});

describe("detectScope", () => {
  it("uses the git remote when available", () => {
    const scope = detectScope("/repo", () => "git@github.com:Acme/Widgets.git\n");
    expect(scope).toBe("github.com/acme/widgets");
  });
  it("falls back to a stable cwd key when there is no remote", () => {
    const a = detectScope("/Users/me/proj", () => { throw new Error("no remote"); });
    const b = detectScope("/Users/me/proj", () => { throw new Error("no remote"); });
    expect(a).toBe(b);
    expect(a.startsWith("cwd:")).toBe(true);
  });
});
```

- [ ] **Step 4: Run it — verify it fails**

Run (from `noto-mcp/`): `npx vitest run src/scope.test.ts`
Expected: FAIL — `./scope.ts` does not exist.

- [ ] **Step 5: Implement scope detection**

Create `noto-mcp/src/scope.ts`:
```ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/** Normalize a git remote URL to a stable, lowercased "host/path" key, or null. */
export function normalizeRemote(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  let host = "", path = "";
  const ssh = u.match(/^[^@]+@([^:]+):(.+)$/); // git@github.com:Acme/Widgets.git
  if (ssh) { host = ssh[1]; path = ssh[2]; }
  else {
    const m = u.match(/^[a-z]+:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i); // https://user:tok@host/g/p
    if (!m) return null;
    host = m[1]; path = m[2];
  }
  path = path.replace(/\.git$/, "").replace(/\/+$/, "");
  return `${host}/${path}`.toLowerCase();
}

type Exec = (cwd: string) => string;
const gitRemote: Exec = (cwd) =>
  execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd, encoding: "utf8" });

/** Derive the memory scope for `cwd`: git remote if present, else a stable cwd hash. */
export function detectScope(cwd: string, exec: Exec = gitRemote): string {
  try {
    const key = normalizeRemote(exec(cwd));
    if (key) return key;
  } catch { /* no git / no remote → fall through */ }
  return "cwd:" + createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}
```

- [ ] **Step 6: Run the tests — verify they pass**

Run: `npx vitest run src/scope.test.ts`
Expected: PASS (all four).

- [ ] **Step 7: Commit**

```bash
git add noto-mcp/package.json noto-mcp/tsconfig.json noto-mcp/package-lock.json noto-mcp/src/scope.ts noto-mcp/src/scope.test.ts
git commit -m "feat(noto-mcp): package scaffold + git-remote/cwd scope detection"
```

---

### Task 8: HTTP client (`notoClient`)

**Files:**
- Create: `noto-mcp/src/notoClient.ts`, `noto-mcp/src/notoClient.test.ts`

- [ ] **Step 1: Write the failing test**

Create `noto-mcp/src/notoClient.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { createNotoClient } from "./notoClient.ts";

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
}

const opts = { baseUrl: "https://noto.test", token: "noto_pat_abc", client: "claude-code" };

describe("notoClient", () => {
  it("sends Bearer auth + X-Noto-Client and parses search results", async () => {
    const fetchImpl = fakeFetch((url, init) => {
      expect(url).toBe("https://noto.test/api/search?q=auth&limit=5");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer noto_pat_abc");
      expect((init.headers as Record<string, string>)["X-Noto-Client"]).toBe("claude-code");
      return { status: 200, body: { results: [{ fileId: "1", title: "Auth", headingPath: [], snippet: "x", score: -1 }] } };
    });
    const c = createNotoClient({ ...opts, fetchImpl });
    const r = await c.searchNotes({ query: "auth", limit: 5 });
    expect(r.results[0].title).toBe("Auth");
  });

  it("remembers with scope in the body + X-Noto-Client", async () => {
    const fetchImpl = fakeFetch((url, init) => {
      expect(url).toBe("https://noto.test/api/memory");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toMatchObject({ text: "hi", scope: "proj/x" });
      return { status: 201, body: { memoryId: "m1", deduped: false } };
    });
    const c = createNotoClient({ ...opts, fetchImpl });
    expect((await c.remember({ text: "hi", scope: "proj/x" })).memoryId).toBe("m1");
  });

  it("throws the server error message on non-2xx", async () => {
    const fetchImpl = fakeFetch(() => ({ status: 403, body: { error: "Token missing 'memory' scope" } }));
    const c = createNotoClient({ ...opts, fetchImpl });
    await expect(c.remember({ text: "x" })).rejects.toThrow("Token missing 'memory' scope");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run src/notoClient.test.ts`
Expected: FAIL — `./notoClient.ts` does not exist.

- [ ] **Step 3: Implement the client**

Create `noto-mcp/src/notoClient.ts`:
```ts
type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export interface NotoClientOptions {
  baseUrl: string; token: string; client: string;
  fetchImpl?: FetchImpl;
}
export interface SearchResult { fileId: string; title: string; headingPath: string[]; snippet: string; score: number }
export interface NoteRef { fileId: string; title: string; path: string; updatedAt: number }
export interface Memory { id: string; text: string; type: string; scope: string; sourceClient: string; lastUsed: number; score?: number }

export function createNotoClient(opts: NotoClientOptions) {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as FetchImpl);

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.token}`,
      "X-Noto-Client": opts.client,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await doFetch(base + path, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data: unknown = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      const msg = (data as { error?: string } | null)?.error ?? `Noto request failed (${res.status})`;
      throw new Error(msg);
    }
    return data as T;
  }
  const qs = (o: Record<string, string | number | undefined>) =>
    Object.entries(o).filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

  return {
    searchNotes: (a: { query: string; scope?: string; tag?: string; limit?: number }) =>
      call<{ results: SearchResult[] }>("GET", `/api/search?${qs({ q: a.query, scope: a.scope, tag: a.tag, limit: a.limit ?? 5 })}`),
    listNotes: (a: { by?: string; limit?: number }) =>
      call<{ notes: NoteRef[] }>("GET", `/api/notes?${qs({ by: a.by ?? "recent", limit: a.limit ?? 20 })}`),
    getNote: (a: { fileId: string }) =>
      call<{ file: { id: string; title: string; path: string; content: string; updatedAt: number } }>("GET", `/api/files/${encodeURIComponent(a.fileId)}`),
    getSection: (a: { fileId: string; heading: string }) =>
      call<{ fileId: string; headingPath: string[]; content: string }>("GET", `/api/files/${encodeURIComponent(a.fileId)}/section?heading=${encodeURIComponent(a.heading)}`),
    remember: (a: { text: string; type?: string; scope?: string; supersedes?: string }) =>
      call<{ memoryId: string; deduped: boolean }>("POST", "/api/memory", a),
    recall: (a: { query: string; scope?: string; type?: string; limit?: number }) =>
      call<{ memories: Memory[] }>("GET", `/api/memory?${qs({ q: a.query, scope: a.scope, type: a.type, limit: a.limit ?? 6 })}`),
  };
}
export type NotoClient = ReturnType<typeof createNotoClient>;
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `npx vitest run src/notoClient.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add noto-mcp/src/notoClient.ts noto-mcp/src/notoClient.test.ts
git commit -m "feat(noto-mcp): HTTP client with Bearer + X-Noto-Client and error mapping"
```

---

### Task 9: Tool handlers + stdio server

**Files:**
- Create: `noto-mcp/src/tools.ts`, `noto-mcp/src/tools.test.ts`, `noto-mcp/src/index.ts`

- [ ] **Step 1: Write the failing test (handlers call the client + return text content)**

Create `noto-mcp/src/tools.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { makeHandlers } from "./tools.ts";

function fakeClient() {
  return {
    searchNotes: vi.fn(async () => ({ results: [{ fileId: "1", title: "T", headingPath: [], snippet: "s", score: -1 }] })),
    listNotes: vi.fn(async () => ({ notes: [] })),
    getNote: vi.fn(async () => ({ file: { id: "1", title: "T", path: "p", content: "c", updatedAt: 0 } })),
    getSection: vi.fn(async () => ({ fileId: "1", headingPath: ["A"], content: "c" })),
    remember: vi.fn(async () => ({ memoryId: "m1", deduped: false })),
    recall: vi.fn(async () => ({ memories: [] })),
  };
}

describe("tool handlers", () => {
  it("search_notes injects the auto-detected scope and returns text content", async () => {
    const client = fakeClient();
    const h = makeHandlers(client as never, { scope: "proj/x" });
    const out = await h.search_notes({ query: "auth" });
    expect(client.searchNotes).toHaveBeenCalledWith({ query: "auth", scope: "proj/x", tag: undefined, limit: undefined });
    expect(out.content[0].type).toBe("text");
    expect(JSON.parse(out.content[0].text).results[0].title).toBe("T");
  });

  it("remember passes an explicit scope override through unchanged", async () => {
    const client = fakeClient();
    const h = makeHandlers(client as never, { scope: "proj/x" });
    await h.remember({ text: "hi", scope: "global" });
    expect(client.remember).toHaveBeenCalledWith({ text: "hi", type: undefined, scope: "global", supersedes: undefined });
  });

  it("surfaces a client error as an isError result, not a throw", async () => {
    const client = fakeClient();
    client.remember = vi.fn(async () => { throw new Error("Token missing 'memory' scope"); });
    const h = makeHandlers(client as never, { scope: "proj/x" });
    const out = await h.remember({ text: "x" });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("memory");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run src/tools.test.ts`
Expected: FAIL — `./tools.ts` does not exist.

- [ ] **Step 3: Implement the handlers**

Create `noto-mcp/src/tools.ts`:
```ts
import type { NotoClient } from "./notoClient.ts";

export interface ToolResult { content: { type: "text"; text: string }[]; isError?: boolean }
const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const fail = (e: unknown): ToolResult => ({ content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });

/**
 * Build the 6 tool handlers. `scope` is the auto-detected project key; the agent
 * can override per call. Reads union global server-side; writes default to `scope`.
 */
export function makeHandlers(client: NotoClient, ctx: { scope: string }) {
  return {
    async search_notes(a: { query: string; scope?: string; tag?: string; limit?: number }) {
      try { return ok(await client.searchNotes({ query: a.query, scope: a.scope ?? ctx.scope, tag: a.tag, limit: a.limit })); }
      catch (e) { return fail(e); }
    },
    async list_notes(a: { by?: string; limit?: number }) {
      try { return ok(await client.listNotes({ by: a.by, limit: a.limit })); } catch (e) { return fail(e); }
    },
    async get_note(a: { fileId: string }) {
      try { return ok(await client.getNote({ fileId: a.fileId })); } catch (e) { return fail(e); }
    },
    async get_section(a: { fileId: string; heading: string }) {
      try { return ok(await client.getSection({ fileId: a.fileId, heading: a.heading })); } catch (e) { return fail(e); }
    },
    async remember(a: { text: string; type?: string; scope?: string; supersedes?: string }) {
      try { return ok(await client.remember({ text: a.text, type: a.type, scope: a.scope ?? ctx.scope, supersedes: a.supersedes })); }
      catch (e) { return fail(e); }
    },
    async recall(a: { query: string; scope?: string; type?: string; limit?: number }) {
      try { return ok(await client.recall({ query: a.query, scope: a.scope ?? ctx.scope, type: a.type, limit: a.limit })); }
      catch (e) { return fail(e); }
    },
  };
}
export type Handlers = ReturnType<typeof makeHandlers>;
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `npx vitest run src/tools.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Write the stdio bootstrap (registers tools on the MCP server)**

Create `noto-mcp/src/index.ts`:
```ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createNotoClient } from "./notoClient.ts";
import { detectScope } from "./scope.ts";
import { makeHandlers } from "./tools.ts";

const NOTO_URL = process.env.NOTO_URL;
const NOTO_TOKEN = process.env.NOTO_TOKEN;
if (!NOTO_URL || !NOTO_TOKEN) {
  console.error("noto-mcp: NOTO_URL and NOTO_TOKEN env vars are required.");
  process.exit(1);
}
const client = createNotoClient({
  baseUrl: NOTO_URL,
  token: NOTO_TOKEN,
  client: process.env.NOTO_CLIENT || "claude-code",
});
const scope = detectScope(process.cwd());
const h = makeHandlers(client, { scope });

const server = new McpServer({ name: "noto-mcp", version: "0.1.0" });

server.tool("search_notes", "Search the user's Noto notes; returns heading-addressable refs + snippets. Prefer this over reading whole notes.",
  { query: z.string(), scope: z.string().optional(), tag: z.string().optional(), limit: z.number().int().optional() },
  async (a) => h.search_notes(a));

server.tool("list_notes", "List recent notes as references (no bodies).",
  { by: z.enum(["recent"]).optional(), limit: z.number().int().optional() },
  async (a) => h.list_notes(a));

server.tool("get_note", "Fetch one whole note by id. Prefer get_section when you only need part of it.",
  { fileId: z.string() },
  async (a) => h.get_note(a));

server.tool("get_section", "Fetch one section of a note by heading path (e.g. 'Parent/Child').",
  { fileId: z.string(), heading: z.string() },
  async (a) => h.get_section(a));

server.tool("remember", "Persist a durable decision/preference/fact to shared memory for this project. Store durable things only.",
  { text: z.string(), type: z.enum(["decision", "preference", "fact", "glossary"]).optional(), scope: z.string().optional(), supersedes: z.string().optional() },
  async (a) => h.remember(a));

server.tool("recall", "Recall prior decisions/preferences/facts relevant to a query before acting.",
  { query: z.string(), scope: z.string().optional(), type: z.string().optional(), limit: z.number().int().optional() },
  async (a) => h.recall(a));

await server.connect(new StdioServerTransport());
console.error(`noto-mcp ready (scope: ${scope})`);
```

> The `server.tool(name, description, zodShape, handler)` signature targets `@modelcontextprotocol/sdk` 1.x. If `npm install` pulled a version whose README shows `registerTool(name, { description, inputSchema }, handler)` instead, adapt these 6 calls to that signature — the `h.*` handlers are unchanged.

- [ ] **Step 6: Typecheck + build**

Run (from `noto-mcp/`): `npm run typecheck && npm run build`
Expected: no type errors; `dist/index.js` is produced.

- [ ] **Step 7: Commit**

```bash
git add noto-mcp/src/tools.ts noto-mcp/src/tools.test.ts noto-mcp/src/index.ts
git commit -m "feat(noto-mcp): 6 tool handlers + stdio server bootstrap"
```

---

### Task 10: End-to-end smoke (manual, documented)

**Files:** none (verification only).

- [ ] **Step 1: Start the Noto server**

Run (from `landing/`): `npm run dev:server` (serves `http://localhost:8787`). In the running app, sign in and mint a `read,memory` PAT (the Settings panel from Part C, or `npm run mint-pat`).

- [ ] **Step 2: Configure Claude Code**

Add to the project `.mcp.json`:
```json
{
  "mcpServers": {
    "noto": {
      "command": "npx",
      "args": ["-y", "tsx", "/ABSOLUTE/PATH/noto-mcp/src/index.ts"],
      "env": { "NOTO_URL": "http://localhost:8787", "NOTO_TOKEN": "noto_pat_…", "NOTO_CLIENT": "claude-code" }
    }
  }
}
```
(After `npm run build` you can instead point `command` at `node` + `dist/index.js`.)

- [ ] **Step 3: Verify the loop**

In Claude Code: call `recall {query:"anything"}` (expect `{memories:[]}` or hits), then `remember {text:"SP1 smoke test decision"}`, then in a **fresh** Claude Code session call `recall {query:"smoke test"}` and confirm the decision returns with `sourceClient:"claude-code"`. Confirm `search_notes {query:"<word in a note>"}` returns a heading-addressable ref.

- [ ] **Step 4: Record the result**

No commit. Note pass/fail in your working notes; a failure here means a wiring bug in Part A/B to fix before Part C.

---

# Part C — Client + Settings UI

### Task 11: Client API methods (`api.pat.*`, `api.memory.list`)

**Files:**
- Modify: `landing/src/app/api.ts`

- [ ] **Step 1: Add the methods**

In `landing/src/app/api.ts`, add these two namespaces inside the exported `api` object (mirroring the existing `links` namespace style):
```ts
  /* personal access tokens (for MCP / external AI tools) */
  pat: {
    list: () =>
      request<{ tokens: { id: string; name: string; scopes: string[]; createdAt: number; lastUsedAt: number | null }[] }>("GET", "/api/tokens"),
    mint: (input: { name: string; scopes: ("read" | "write" | "destructive" | "memory")[] }) =>
      request<{ id: string; token: string; name: string; scopes: string[] }>("POST", "/api/tokens", input),
    revoke: (id: string) => request<void>("DELETE", `/api/tokens/${id}`),
  },

  /* shared memory (read-only browse for the Settings panel) */
  memory: {
    list: (params?: { scope?: string; limit?: number }) =>
      request<{ memories: { id: string; text: string; type: string; scope: string; sourceClient: string; lastUsed: number }[] }>(
        "GET",
        `/api/memory/list?${new URLSearchParams({ ...(params?.scope ? { scope: params.scope } : {}), limit: String(params?.limit ?? 100) }).toString()}`,
      ),
  },
```

- [ ] **Step 2: Typecheck the client**

Run (from `landing/`): `npx tsc -b --noEmit` (or `npm run build` if a dedicated client typecheck script is absent).
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add landing/src/app/api.ts
git commit -m "feat(app): api.pat.* and api.memory.list client methods"
```

---

### Task 12: "Connect AI tools (MCP)" Settings panel + wiring

**Files:**
- Create: `landing/src/workspace/mcpClient.ts`
- Create: `landing/src/app/mcpClient.ts`
- Create: `landing/src/workspace/McpSettings.tsx`
- Modify: `landing/src/workspace/Sidebar.tsx`
- Modify: `landing/src/workspace/NotoWindow.tsx`
- Modify: `landing/src/app/NotoWorkspace.tsx`

- [ ] **Step 1: Define the injected client interface (mirrors `citationClient` DI)**

Create `landing/src/workspace/mcpClient.ts`:
```ts
export interface PatInfo { id: string; name: string; scopes: string[]; createdAt: number; lastUsedAt: number | null }
export interface MemoryInfo { id: string; text: string; type: string; scope: string; sourceClient: string; lastUsed: number }

/** Surface-agnostic contract the Settings panel needs; real impl wraps `api`. */
export interface McpClient {
  listTokens(): Promise<PatInfo[]>;
  mintToken(name: string, scopes: ("read" | "memory")[]): Promise<{ id: string; token: string }>;
  revokeToken(id: string): Promise<void>;
  listMemories(): Promise<MemoryInfo[]>;
  notoUrl: string;
}
```

- [ ] **Step 2: Implement the real client (app layer)**

Create `landing/src/app/mcpClient.ts`:
```ts
import { api } from "./api";
import type { McpClient } from "../workspace/mcpClient";

export const realMcpClient: McpClient = {
  notoUrl: window.location.origin,
  async listTokens() {
    return (await api.pat.list()).tokens;
  },
  async mintToken(name, scopes) {
    const r = await api.pat.mint({ name, scopes });
    return { id: r.id, token: r.token };
  },
  async revokeToken(id) {
    await api.pat.revoke(id);
  },
  async listMemories() {
    return (await api.memory.list()).memories;
  },
};
```

- [ ] **Step 3: Build the panel**

Create `landing/src/workspace/McpSettings.tsx`:
```tsx
import { useEffect, useState } from "react";
import type { McpClient, PatInfo, MemoryInfo } from "./mcpClient";

export function McpSettings({ client, onClose }: { client: McpClient; onClose: () => void }) {
  const [tokens, setTokens] = useState<PatInfo[]>([]);
  const [memories, setMemories] = useState<MemoryInfo[]>([]);
  const [name, setName] = useState("Claude Code");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => {
    client.listTokens().then(setTokens).catch(() => {});
    client.listMemories().then(setMemories).catch(() => {});
  };
  useEffect(refresh, [client]);

  const mint = async () => {
    setBusy(true); setErr(null);
    try {
      const { token } = await client.mintToken(name.trim() || "AI tool", ["read", "memory"]);
      setFresh(token);
      refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not mint token."); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => { await client.revokeToken(id).catch(() => {}); refresh(); };

  const config = `{
  "mcpServers": {
    "noto": {
      "command": "npx",
      "args": ["-y", "noto-mcp"],
      "env": { "NOTO_URL": "${client.notoUrl}", "NOTO_TOKEN": "${fresh ?? "noto_pat_…"}", "NOTO_CLIENT": "claude-code" }
    }
  }
}`;

  return (
    <>
      <div className="nw-menu-scrim" onClick={onClose} />
      <div className="nw-mcp-panel" role="dialog" aria-label="Connect AI tools">
        <header className="nw-mcp-head">
          <h2>Connect AI tools (MCP)</h2>
          <button className="nw-mcp-x" onClick={onClose} aria-label="Close">×</button>
        </header>

        <section className="nw-mcp-sec">
          <h3>1 · Create a token</h3>
          <div className="nw-mcp-row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name" />
            <button onClick={mint} disabled={busy}>Mint read + memory token</button>
          </div>
          {err && <p className="nw-mcp-err">{err}</p>}
          {fresh && <p className="nw-mcp-token">Copy now — shown once: <code>{fresh}</code></p>}
        </section>

        <section className="nw-mcp-sec">
          <h3>2 · Add to Claude Code (.mcp.json)</h3>
          <pre className="nw-mcp-config">{config}</pre>
        </section>

        <section className="nw-mcp-sec">
          <h3>Active tokens</h3>
          {tokens.length === 0 && <p className="nw-mcp-empty">No tokens yet.</p>}
          <ul className="nw-mcp-list">
            {tokens.map((t) => (
              <li key={t.id}>
                <span>{t.name} · {t.scopes.join(", ")}</span>
                <button onClick={() => revoke(t.id)}>Revoke</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="nw-mcp-sec">
          <h3>Memory ({memories.length})</h3>
          <ul className="nw-mcp-mem">
            {memories.map((m) => (
              <li key={m.id}>
                <span className="nw-mcp-mem-text">{m.text}</span>
                <span className="nw-mcp-mem-meta">{m.type} · {m.scope} · {m.sourceClient}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Add minimal styles**

Append to `landing/src/styles/workspace.css`:
```css
.nw-mcp-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: min(640px, 92vw); max-height: 84vh; overflow: auto; z-index: 60;
  background: var(--nw-bg, #fff); color: inherit; border-radius: 12px; padding: 20px;
  box-shadow: 0 20px 60px rgba(0,0,0,.35); }
.nw-mcp-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.nw-mcp-x { background: none; border: 0; font-size: 22px; cursor: pointer; }
.nw-mcp-sec { margin-top: 18px; }
.nw-mcp-sec h3 { font-size: 13px; opacity: .7; margin: 0 0 8px; }
.nw-mcp-row { display: flex; gap: 8px; }
.nw-mcp-row input { flex: 1; }
.nw-mcp-token code, .nw-mcp-config { user-select: all; word-break: break-all; }
.nw-mcp-config { background: rgba(127,127,127,.12); padding: 12px; border-radius: 8px; font-size: 12px; white-space: pre-wrap; }
.nw-mcp-list, .nw-mcp-mem { list-style: none; padding: 0; margin: 0; }
.nw-mcp-list li { display: flex; justify-content: space-between; padding: 6px 0; }
.nw-mcp-mem li { display: flex; flex-direction: column; padding: 6px 0; border-top: 1px solid rgba(127,127,127,.15); }
.nw-mcp-mem-meta { font-size: 11px; opacity: .6; }
.nw-mcp-err { color: #c0392b; font-size: 13px; }
.nw-mcp-empty { opacity: .6; font-size: 13px; }
```

- [ ] **Step 5: Add the menu item in `AccountFooter`**

In `landing/src/workspace/Sidebar.tsx`, extend `AccountFooter`'s props with `onOpenConnect?: () => void` and render a menu item before the disabled "Settings" stub (only when the callback is present):
```tsx
{onOpenConnect && (
  <button
    className="nw-menu-item"
    onClick={() => { setOpen(false); onOpenConnect(); }}
  >
    <Icon name="settings" size={14} stroke={1.7} />
    <span>Connect AI tools</span>
  </button>
)}
```
Thread `onOpenConnect` from `AccountFooter(props)` and ensure `Sidebar` forwards an `onOpenConnect` prop down to `AccountFooter`.

- [ ] **Step 6: Render the panel in `NotoWindow` and pass the trigger to `Sidebar`**

In `landing/src/workspace/NotoWindow.tsx`: accept an optional `mcpClient?: McpClient` prop (import the type from `./mcpClient`), add `const [mcpOpen, setMcpOpen] = useState(false);`, pass `onOpenConnect={mcpClient ? () => setMcpOpen(true) : undefined}` into `<Sidebar … />`, and render near the other overlay siblings:
```tsx
{mcpOpen && mcpClient && <McpSettings client={mcpClient} onClose={() => setMcpOpen(false)} />}
```
Add the import: `import { McpSettings } from "./McpSettings";`

- [ ] **Step 7: Inject the real client in the authenticated app**

In `landing/src/app/NotoWorkspace.tsx`, import and pass the real client:
```tsx
import { realMcpClient } from "./mcpClient";
```
and add `mcpClient={realMcpClient}` to the `<NotoWindow … />` props. (The marketing demo `src/noto/NotoApp.tsx` passes no `mcpClient`, so the menu item stays hidden there.)

- [ ] **Step 8: Verify the build + manual UI check**

Run (from `landing/`): `npm run build`
Expected: build succeeds. Then `npm run dev`, sign in, open the sidebar account menu → "Connect AI tools" → mint a token (it appears once), confirm the config block shows your token, and the Memory list renders (after the Part B smoke test wrote one).

- [ ] **Step 9: Commit**

```bash
git add landing/src/workspace/mcpClient.ts landing/src/app/mcpClient.ts landing/src/workspace/McpSettings.tsx landing/src/workspace/Sidebar.tsx landing/src/workspace/NotoWindow.tsx landing/src/app/NotoWorkspace.tsx landing/src/styles/workspace.css
git commit -m "feat(app): Connect AI tools (MCP) settings panel — mint PAT, config, memory list"
```

---

## Final verification (SP1 success criteria)

- [ ] **Server suite green:** from `landing/`, `npm test` passes; `npm run typecheck:server` clean.
- [ ] **`noto-mcp` green:** from `noto-mcp/`, `npm test` and `npm run build` pass.
- [ ] **Cross-session loop:** `remember` in one Claude Code session → `recall` returns it in a fresh session (Task 10).
- [ ] **Provenance:** recalled memory shows `sourceClient:"claude-code"`; it appears in the Settings Memory list; an `audit_log` row exists (`tool='remember'`).
- [ ] **Isolation:** the `memory/routes.test.ts` and `search/routes.test.ts` cross-user cases pass (user A cannot read user B's memory or notes).
- [ ] **No clobber:** `noto-mcp` exposes only the 6 read/memory tools — no note-body write tool (inspect `src/index.ts`).
- [ ] **Boundary:** a `read,memory` token gets 403 on `PATCH /api/files/:id/section` (it lacks `write`) — confirms SP1's atomic-only boundary holds.

---

## Self-review notes (run by the plan author)

- **Spec coverage:** every In-scope item maps to a task — `memory` scope (T1), memories+FTS+helpers (T2), `/api/memory` (T3), search snippet (T4), `files_fts`+search+notes (T5), regression (T6), package+scope (T7), client (T8), tools+server (T9), smoke (T10), client API (T11), Settings UI (T12). Out-of-scope items (note-body write tools, narrative pages, Cursor/Codex, provenance UI, remote HTTP, embeddings) are absent by construction.
- **Type consistency:** `PublicMemory`/`MemoryRow`/`rememberMemory`/`recallMemories`/`listMemories`/`searchFiles`/`listNoteRefs`/`ftsQuery`/`bestSnippet`/`createNotoClient`/`makeHandlers`/`McpClient` names are used identically across tasks. The endpoint shapes returned by the server (`{results}`, `{notes}`, `{memories}`, `{memoryId,deduped}`, `{file}`, `{fileId,headingPath,content}`) match what `notoClient` parses and what `tools` re-serialize.
- **Reuse honored:** no task recreates PAT auth, `/api/tokens`, `audit_log`, single-note GET, or section GET — they're imported/called. `writeAudit` is called with its real signature `{userId, tokenId, tool, target, beforeHash}`.
- **Known soft spots flagged inline:** FTS5 availability (T2 S5), `listHeadings` field name (T4 S3), and the MCP SDK `tool` vs `registerTool` signature (T9 S5) each carry a verify-and-adapt note rather than a silent assumption.
