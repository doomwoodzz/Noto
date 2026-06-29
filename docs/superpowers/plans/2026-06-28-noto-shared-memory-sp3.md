# SP3 — Provenance / Trust UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a dedicated "AI Activity" view that lets a human browse every AI write (note creates/edits + memory) and revert it, backed by pre-image snapshots and uniform provenance.

**Architecture:** Server endpoints over data that already accrues — `audit_log` gains `source_client` + `after_hash`; a new `audit_snapshots` table stores pre-edit note content for true revert; `GET/POST /api/activity*` browse + revert (cookie-only, each revert itself audited). The client gets an `ActivityClient`-injected `ActivityView` plus a per-note entry point, gated like the existing MCP panel so the marketing demo never shows it.

**Tech Stack:** Express 5 + `node:sqlite` (WAL, FTS5) server; React 19 client; vitest (`node` env, integration via `startTestServer`, `:memory:` DB). No new deps. `noto-mcp` is unchanged (still 9 tools).

**Spec:** `docs/superpowers/specs/2026-06-28-noto-shared-memory-sp3-design.md`.

**Commit posture (per the handoff):** per-task local commits on `feat/noto-web-app`; pushing / PR is a final checkpoint to confirm with the user (do **not** push as part of these tasks).

**Conventions:**
- Imports in `landing/` use explicit `.ts` extensions (NodeNext).
- Server tests boot `createApp()` on port 0; fresh `:memory:` DB per test file; **use a unique email per test**.
- Run server tests: `npm test` (from `landing/`); server typecheck: `npm run typecheck:server`; full client check: `npm run build`; lint: `npm run lint`.

---

## File Structure

**Server (`landing/server/`):**
- `db.ts` — MODIFY: `audit_log` schema + additive migration (`source_client`, `after_hash`); new `audit_snapshots` table; `writeAudit` returns the row id + accepts `afterHash`/`sourceClient`; `writeSnapshot`/`getSnapshot`; `getOwnedAuditRow`; `listActivity` (+ `ActivityRaw`); memory-revert helpers `getOwnedMemory`/`retireMemory`/`reactivateMemory`.
- `audit/activity.ts` — CREATE: `ActivityEntry`/`ActivityTarget` types, `toActivityEntry` (enrichment + `revertible`), `previewRevert`, `performRevert` (the inverse-action dispatcher).
- `audit/routes.ts` — CREATE: `GET /`, `GET /:auditId/preview`, `POST /:auditId/revert` (cookie-only).
- `audit/routes.test.ts` — CREATE: integration tests.
- `app.ts` — MODIFY: mount `activityRouter` at `/api/activity`.
- `notes/routes.ts` — MODIFY: populate `sourceClient`/`afterHash`/snapshot at the 3 write sites.
- `memory/routes.ts` — MODIFY: pass `sourceClient` to `writeAudit`.

**Client (`landing/src/`):**
- `workspace/activityClient.ts` — CREATE: `ActivityClient` DI interface + `ActivityEntry`/`ActivityTarget`/`ActivityFilter`/`RevertOutcome` types.
- `workspace/activityFormat.ts` (+ `.test.ts`) — CREATE: pure `describeActivity(entry)` helper (the one client unit under TDD).
- `app/api.ts` — MODIFY: `activity: { list, preview, revert }`.
- `app/activityClient.ts` — CREATE: `realActivityClient`.
- `workspace/ActivityView.tsx` — CREATE: the view + revert dialog.
- `styles/workspace.css` — MODIFY: `nw-act-*` styles.
- `workspace/NotoWindow.tsx`, `workspace/Sidebar.tsx`, `workspace/ContextPanel.tsx`, `app/NotoWorkspace.tsx` — MODIFY: wiring + gating.

---

## Task 1: Activity timeline — schema, db helpers, enriched list endpoint

**Files:**
- Modify: `landing/server/db.ts`
- Create: `landing/server/audit/activity.ts`
- Create: `landing/server/audit/routes.ts`
- Modify: `landing/server/app.ts`
- Test: `landing/server/audit/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `landing/server/audit/routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";

let srv: TestServer;
beforeAll(async () => { srv = await startTestServer(); });
afterAll(() => srv.close());

async function setup(email: string, tokenName = "Claude Code") {
  const cookie = await signup(srv.baseURL, email);
  const token = await mintToken(cookie, ["read", "write", "memory"], tokenName);
  const pat = makePatClient(srv.baseURL, token);
  return { cookie, pat };
}

describe("GET /api/activity (browse)", () => {
  it("lists AI writes enriched with tool/target/device and revertible flags", async () => {
    const { cookie, pat } = await setup("act-list@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/log.md", title: "Log", content: "# Log\n" });
    expect(create.status).toBe(201);
    const { fileId } = (await create.json()) as { fileId: string };
    await pat.req("POST", `/api/files/${fileId}/append`, { text: "first line" });
    await pat.req("POST", "/api/memory", { text: "We use Postgres", scope: "proj" });

    const res = await cookie.req("GET", "/api/activity");
    expect(res.status).toBe(200);
    const { activity } = (await res.json()) as { activity: any[] };
    expect(activity.length).toBe(3);

    const create_ = activity.find((a) => a.tool === "create_note");
    expect(create_.device).toBe("Claude Code");
    expect(create_.target.kind).toBe("note");
    expect(create_.target.title).toBe("Log");
    expect(create_.target.exists).toBe(true);
    expect(create_.revertible).toBe(true);

    const append_ = activity.find((a) => a.tool === "append_note");
    // No snapshot populated yet (Task 2 adds it) → not revertible until then.
    expect(append_.revertible).toBe(false);

    const remember_ = activity.find((a) => a.tool === "remember");
    expect(remember_.target.kind).toBe("memory");
    expect(remember_.target.text).toContain("Postgres");
    expect(remember_.revertible).toBe(true);
  });

  it("filters by tool", async () => {
    const { cookie, pat } = await setup("act-filter@example.com");
    await pat.req("POST", "/api/notes", { path: "Memory/a.md", title: "A", content: "x" });
    await pat.req("POST", "/api/memory", { text: "fact one", scope: "proj" });
    const res = await cookie.req("GET", "/api/activity?tool=create_note");
    const { activity } = (await res.json()) as { activity: any[] };
    expect(activity.length).toBe(1);
    expect(activity[0].tool).toBe("create_note");
  });

  it("excludes human (cookie) edits — they write no audit row", async () => {
    const { cookie } = await setup("act-human@example.com");
    // Seed the default vault + Welcome note, then edit it via the human PATCH route.
    const vaults = (await (await cookie.req("GET", "/api/vaults")).json()) as { vaults: { id: string }[] };
    const files = (await (await cookie.req("GET", `/api/vaults/${vaults.vaults[0].id}/files`)).json()) as { files: { id: string }[] };
    await cookie.req("PATCH", `/api/files/${files.files[0].id}`, { content: "human edit" });
    const res = await cookie.req("GET", "/api/activity");
    const { activity } = (await res.json()) as { activity: any[] };
    expect(activity.length).toBe(0);
  });

  it("isolates users (A cannot see B's activity)", async () => {
    const a = await setup("act-iso-a@example.com");
    const b = await setup("act-iso-b@example.com");
    await a.pat.req("POST", "/api/notes", { path: "Memory/a.md", title: "A", content: "x" });
    const res = await b.cookie.req("GET", "/api/activity");
    expect(((await res.json()) as { activity: any[] }).activity.length).toBe(0);
  });

  it("rejects PAT callers — the trust surface is human-only", async () => {
    const { pat } = await setup("act-pat@example.com");
    const res = await pat.req("GET", "/api/activity");
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd landing && npx vitest run server/audit/routes.test.ts`
Expected: FAIL — 404/route missing (`activityRouter` not mounted).

- [ ] **Step 3: Extend the schema in `db.ts`**

In the main `db.exec(\`...\`)` schema block, update the `audit_log` CREATE TABLE (currently ends `before_hash TEXT, ... created_at INTEGER NOT NULL`) to add two columns, and add the snapshots table right after the `idx_audit_user` index:

```sql
  CREATE TABLE IF NOT EXISTS audit_log (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id     TEXT,
    tool         TEXT NOT NULL,
    target       TEXT,
    before_hash  TEXT,
    after_hash   TEXT,                  -- sha256 of post-write content (note edits)
    source_client TEXT,                 -- claude-code | cursor | codex | web
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);

  CREATE TABLE IF NOT EXISTS audit_snapshots (
    audit_id TEXT PRIMARY KEY REFERENCES audit_log(id) ON DELETE CASCADE,
    content  TEXT NOT NULL              -- full pre-edit file content (append/update_section)
  );
```

Then, right after the existing `pinned` additive-migration block (the `PRAGMA table_info(files)` block), add the additive migration for older DBs:

```ts
// Additive migration: SP3 provenance. Older databases predate these columns.
{
  const cols = db.prepare("PRAGMA table_info(audit_log)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "after_hash")) {
    db.exec("ALTER TABLE audit_log ADD COLUMN after_hash TEXT");
  }
  if (!cols.some((c) => c.name === "source_client")) {
    db.exec("ALTER TABLE audit_log ADD COLUMN source_client TEXT");
  }
}
```

- [ ] **Step 4: Extend `writeAudit` + add snapshot/audit/activity helpers in `db.ts`**

Replace the existing audit section (`stmtInsertAudit`, `AuditRow`, `writeAudit`) and add the new helpers. The `AuditRow` interface gains two fields:

```ts
export interface AuditRow {
  id: string;
  user_id: string;
  token_id: string | null;
  tool: string;
  target: string | null;
  before_hash: string | null;
  after_hash: string | null;
  source_client: string | null;
  created_at: number;
}

const stmtInsertAudit = db.prepare(
  "INSERT INTO audit_log (id, user_id, token_id, tool, target, before_hash, after_hash, source_client, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
);

/** Append an audit row. Returns the new row id (so callers can attach a snapshot). */
export function writeAudit(entry: {
  userId: string;
  tokenId?: string | null;
  tool: string;
  target?: string | null;
  beforeHash?: string | null;
  afterHash?: string | null;
  sourceClient?: string | null;
}): string {
  const id = newId();
  stmtInsertAudit.run(
    id,
    entry.userId,
    entry.tokenId ?? null,
    entry.tool,
    entry.target ?? null,
    entry.beforeHash ?? null,
    entry.afterHash ?? null,
    entry.sourceClient ?? null,
    now(),
  );
  return id;
}

export function listAuditForUser(userId: string, limit = 100): AuditRow[] {
  return stmtAuditForUser.all(userId, limit) as unknown as AuditRow[];
}

const stmtAuditByIdOwned = db.prepare("SELECT * FROM audit_log WHERE id = ? AND user_id = ?");
export function getOwnedAuditRow(userId: string, auditId: string): AuditRow | undefined {
  return stmtAuditByIdOwned.get(auditId, userId) as AuditRow | undefined;
}

/* ----------------------------- audit snapshots ----------------------------- */
const stmtInsertSnapshot = db.prepare("INSERT OR REPLACE INTO audit_snapshots (audit_id, content) VALUES (?, ?)");
const stmtSnapshot = db.prepare("SELECT content FROM audit_snapshots WHERE audit_id = ?");
export function writeSnapshot(auditId: string, content: string): void {
  stmtInsertSnapshot.run(auditId, content);
}
export function getSnapshot(auditId: string): string | null {
  const row = stmtSnapshot.get(auditId) as { content: string } | undefined;
  return row ? row.content : null;
}

/* ------------------------------- activity feed ----------------------------- */
export interface ActivityRaw {
  id: string;
  tool: string;
  created_at: number;
  source_client: string | null;
  token_id: string | null;
  target: string | null;
  after_hash: string | null;
  device: string | null;
  file_title: string | null;
  file_path: string | null;
  memory_text: string | null;
  memory_status: string | null;
  has_snapshot: number;
}

/** AI-write timeline: PAT writes plus human `revert` rows, enriched + filtered. */
export function listActivity(
  userId: string,
  filters: { tool?: string; source?: string; fileId?: string; before?: number; limit: number },
): ActivityRaw[] {
  const clauses = ["a.user_id = ?", "(a.token_id IS NOT NULL OR a.tool = 'revert')"];
  const args: (string | number)[] = [userId];
  if (filters.tool) { clauses.push("a.tool = ?"); args.push(filters.tool); }
  if (filters.source) { clauses.push("a.source_client = ?"); args.push(filters.source); }
  if (filters.fileId) { clauses.push("a.target = ?"); args.push(filters.fileId); }
  if (filters.before) { clauses.push("a.created_at < ?"); args.push(filters.before); }
  args.push(filters.limit);
  return prepareCached(
    `SELECT a.id, a.tool, a.created_at, a.source_client, a.token_id, a.target, a.after_hash,
            p.name AS device,
            f.title AS file_title, f.path AS file_path,
            m.text AS memory_text, m.status AS memory_status,
            (s.audit_id IS NOT NULL) AS has_snapshot
       FROM audit_log a
       LEFT JOIN pat_tokens p ON p.id = a.token_id
       LEFT JOIN files f ON f.id = a.target
       LEFT JOIN memories m ON m.id = a.target AND m.user_id = a.user_id
       LEFT JOIN audit_snapshots s ON s.audit_id = a.id
      WHERE ${clauses.join(" AND ")}
      ORDER BY a.created_at DESC
      LIMIT ?`,
  ).all(...args) as unknown as ActivityRaw[];
}
```

(`prepareCached`, `newId`, `now`, and `stmtAuditForUser` already exist in `db.ts`. Keep `stmtAuditForUser`/`sha256Hex` as-is.)

- [ ] **Step 5: Create the enrichment mapper `audit/activity.ts`**

```ts
import type { ActivityRaw } from "../db.ts";

export interface ActivityTarget {
  kind: "note" | "memory";
  id: string | null;
  title: string | null;
  path: string | null;
  text: string | null;
  status: string | null;
  exists: boolean;
}
export interface ActivityEntry {
  id: string;
  tool: string;
  createdAt: number;
  client: string | null;
  device: string | null;
  target: ActivityTarget;
  revertible: boolean;
  hasSnapshot: boolean;
}

const NOTE_TOOLS = new Set(["create_note", "append_note", "update_section"]);
const MEMORY_TOOLS = new Set(["remember", "supersede"]);

export function toActivityEntry(r: ActivityRaw): ActivityEntry {
  const hasSnapshot = r.has_snapshot === 1;
  const kind: "note" | "memory" = NOTE_TOOLS.has(r.tool)
    ? "note"
    : MEMORY_TOOLS.has(r.tool)
      ? "memory"
      : r.memory_text !== null ? "memory" : "note"; // 'revert' rows: infer from the surviving target
  const exists = kind === "note" ? r.file_title !== null : r.memory_status !== null;
  const target: ActivityTarget = {
    kind,
    id: r.target,
    title: r.file_title,
    path: r.file_path,
    text: r.memory_text,
    status: r.memory_status,
    exists,
  };
  let revertible = false;
  switch (r.tool) {
    case "create_note": revertible = exists; break;
    case "append_note":
    case "update_section": revertible = exists && hasSnapshot; break;
    case "remember":
    case "supersede": revertible = exists && r.memory_status === "active"; break;
    default: revertible = false; // 'revert' rows are display-only
  }
  return {
    id: r.id,
    tool: r.tool,
    createdAt: r.created_at,
    client: r.source_client,
    device: r.device,
    target,
    revertible,
    hasSnapshot,
  };
}
```

- [ ] **Step 6: Create `audit/routes.ts` (GET list only for now)**

```ts
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { getCurrentUser } from "../auth/session.ts";
import { listActivity } from "../db.ts";
import { toActivityEntry } from "./activity.ts";

export const activityRouter = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests." },
});

/** The activity/trust surface is human-only: a PAT must never browse or revert. */
function requireCookieUser(req: Request, res: Response): string | null {
  if (req.apiUser) {
    res.status(403).json({ error: "Use the Noto app to view AI activity" });
    return null;
  }
  const user = getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return user.id;
}

activityRouter.get("/", limiter, (req: Request, res: Response) => {
  const uid = requireCookieUser(req, res);
  if (!uid) return;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const beforeNum = Number(req.query.before);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const rows = listActivity(uid, {
    tool: str(req.query.tool),
    source: str(req.query.source),
    fileId: str(req.query.fileId),
    before: Number.isFinite(beforeNum) && beforeNum > 0 ? beforeNum : undefined,
    limit,
  });
  res.json({ activity: rows.map(toActivityEntry) });
});
```

(The two trailing `void` lines keep `noUnusedLocals` happy until Tasks 3–4 use them; delete them when those tasks add the handlers.)

- [ ] **Step 7: Mount the router in `app.ts`**

Add the import alongside the others (after `import { searchRouter } ...`):

```ts
import { activityRouter } from "./audit/routes.ts";
```

And mount it in the routes section (after `app.use("/api", searchRouter);`):

```ts
  app.use("/api/activity", activityRouter);
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd landing && npx vitest run server/audit/routes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Typecheck + commit**

Run: `cd landing && npm run typecheck:server && npm run lint`
Expected: clean.

```bash
git add landing/server/db.ts landing/server/audit/ landing/server/app.ts
git commit -m "feat(sp3): audit_log provenance schema + enriched activity timeline endpoint"
```

---

## Task 2: Populate provenance + snapshots at the write sites

**Files:**
- Modify: `landing/server/notes/routes.ts`
- Modify: `landing/server/memory/routes.ts`
- Test: `landing/server/audit/routes.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing test**

Append to `landing/server/audit/routes.test.ts`:

```ts
describe("provenance population", () => {
  async function setup2(email: string, tokenName = "Claude Code") {
    const cookie = await signup(srv.baseURL, email);
    const token = await mintToken(cookie, ["read", "write", "memory"], tokenName);
    return { cookie, pat: makePatClient(srv.baseURL, token) };
  }

  it("stamps source_client and makes appends revertible via a snapshot", async () => {
    const { cookie, pat } = await setup2("act-prov@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/log.md", title: "Log", content: "# Log\n" });
    const { fileId } = (await create.json()) as { fileId: string };
    await pat.req("POST", `/api/files/${fileId}/append`, { text: "line" });
    await pat.req("POST", "/api/memory", { text: "uses redis", scope: "p" });

    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: any[] };
    for (const a of activity) expect(a.client).toBe("claude-code");
    const append_ = activity.find((a) => a.tool === "append_note");
    expect(append_.hasSnapshot).toBe(true);
    expect(append_.revertible).toBe(true);
  });

  it("honours the X-Noto-Client header for the source filter", async () => {
    const { cookie, pat } = await setup2("act-cursor@example.com");
    await pat.req("POST", "/api/notes", { path: "Memory/c.md", title: "C", content: "x" }, { "X-Noto-Client": "cursor" });
    const { activity } = (await (await cookie.req("GET", "/api/activity?source=cursor")).json()) as { activity: any[] };
    expect(activity.length).toBe(1);
    expect(activity[0].client).toBe("cursor");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd landing && npx vitest run server/audit/routes.test.ts -t "provenance"`
Expected: FAIL — `client` is `null`, `hasSnapshot` is `false`.

- [ ] **Step 3: Populate provenance in `notes/routes.ts`**

Add `writeSnapshot` to the `db.ts` import block (alongside `writeAudit`, `sha256Hex`). Add a small helper near `resolveUserId`:

```ts
/** The AI client that authored a write (for provenance), from the header. */
function clientOf(req: Request): string {
  return (req.get("x-noto-client") || (req.apiUser ? "claude-code" : "web")).slice(0, 40);
}
```

Replace the `create_note` audit call (currently `writeAudit({ ... tool: "create_note", target: file.id, beforeHash: null });`):

```ts
  writeAudit({
    userId: uid,
    tokenId: req.apiUser?.tokenId ?? null,
    tool: "create_note",
    target: file.id,
    beforeHash: null,
    afterHash: sha256Hex(file.content),
    sourceClient: clientOf(req),
  });
```

Replace the `update_section` audit call + `updateFile` (the `writeAudit({ ... tool: "update_section" ... }); const updated = updateFile(...)` block) so it captures the id and writes a snapshot:

```ts
  const auditId = writeAudit({
    userId: uid,
    tokenId: req.apiUser?.tokenId ?? null,
    tool: "update_section",
    target: file.id,
    beforeHash: sha256Hex(file.content),
    afterHash: sha256Hex(nextContent),
    sourceClient: clientOf(req),
  });
  writeSnapshot(auditId, file.content);
  const updated = updateFile(file.id, { content: nextContent });
```

Replace the `append_note` audit call + `updateFile` similarly:

```ts
  const auditId = writeAudit({
    userId: uid,
    tokenId: req.apiUser?.tokenId ?? null,
    tool: "append_note",
    target: file.id,
    beforeHash: sha256Hex(file.content),
    afterHash: sha256Hex(nextContent),
    sourceClient: clientOf(req),
  });
  writeSnapshot(auditId, file.content);
  const updated = updateFile(file.id, { content: nextContent });
```

(`file.content` is still the pre-edit content at this point — `updateFile` runs after — so the snapshot and `beforeHash` capture the true pre-image; `afterHash` hashes `nextContent`.)

- [ ] **Step 4: Pass `sourceClient` in `memory/routes.ts`**

The handler already computes `const sourceClient = ...`. Update the `writeAudit` call (after `rememberMemory(...)`) to forward it:

```ts
  writeAudit({
    userId: uid,
    tokenId: req.apiUser?.tokenId ?? null,
    tool: parsed.data.supersedes ? "supersede" : "remember",
    target: memory.id,
    beforeHash: null,
    sourceClient,
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd landing && npx vitest run server/audit/routes.test.ts`
Expected: PASS (all, incl. provenance).

- [ ] **Step 6: Typecheck + commit**

Run: `cd landing && npm run typecheck:server && npm run lint`

```bash
git add landing/server/notes/routes.ts landing/server/memory/routes.ts landing/server/audit/routes.test.ts
git commit -m "feat(sp3): stamp source_client + pre-image snapshots on AI note/memory writes"
```

---

## Task 3: Preview endpoint

**Files:**
- Modify: `landing/server/audit/activity.ts`
- Modify: `landing/server/audit/routes.ts`
- Test: `landing/server/audit/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
describe("GET /api/activity/:id/preview", () => {
  async function setup3(email: string) {
    const cookie = await signup(srv.baseURL, email);
    const token = await mintToken(cookie, ["read", "write", "memory"], "Claude Code");
    return { cookie, pat: makePatClient(srv.baseURL, token) };
  }

  it("returns before (snapshot) + current for an append", async () => {
    const { cookie, pat } = await setup3("prev-append@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/p.md", title: "P", content: "start\n" });
    const { fileId } = (await create.json()) as { fileId: string };
    await pat.req("POST", `/api/files/${fileId}/append`, { text: "more" });
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: any[] };
    const append_ = activity.find((a) => a.tool === "append_note");
    const res = await cookie.req("GET", `/api/activity/${append_.id}/preview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { before: string; current: string };
    expect(body.before).toBe("start\n");
    expect(body.current).toContain("more");
  });

  it("404s a foreign audit id", async () => {
    const a = await setup3("prev-iso-a@example.com");
    const b = await setup3("prev-iso-b@example.com");
    const create = await a.pat.req("POST", "/api/notes", { path: "Memory/x.md", title: "X", content: "x" });
    const { activity } = (await (await a.cookie.req("GET", "/api/activity")).json()) as { activity: any[] };
    void create;
    const res = await b.cookie.req("GET", `/api/activity/${activity[0].id}/preview`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd landing && npx vitest run server/audit/routes.test.ts -t "preview"`
Expected: FAIL (404 route missing).

- [ ] **Step 3: Add `previewRevert` to `audit/activity.ts`**

Add imports + function:

```ts
import { getOwnedFile, getSnapshot, getOwnedMemory, type AuditRow, type ActivityRaw } from "../db.ts";
```

(replace the existing `import type { ActivityRaw } from "../db.ts";` line with the line above; `getOwnedMemory` is added in Task 6 — add it to the import now and create the stub in Task 6, or temporarily import only what exists. To avoid a broken import, add `getOwnedMemory` to `db.ts` now as part of this step:)

In `db.ts`, near the memory helpers, add:

```ts
const stmtOwnedMemory = db.prepare("SELECT * FROM memories WHERE id = ? AND user_id = ?");
export function getOwnedMemory(userId: string, id: string): MemoryRow | undefined {
  return stmtOwnedMemory.get(id, userId) as MemoryRow | undefined;
}
```

Then in `audit/activity.ts`:

```ts
export function previewRevert(userId: string, audit: AuditRow): { before: string | null; current: string | null } {
  if (NOTE_TOOLS.has(audit.tool) && audit.target) {
    const file = getOwnedFile(userId, audit.target);
    const current = file ? file.content : null;
    const before = audit.tool === "create_note" ? null : getSnapshot(audit.id);
    return { before, current };
  }
  if (MEMORY_TOOLS.has(audit.tool) && audit.target) {
    const mem = getOwnedMemory(userId, audit.target);
    const current = mem ? mem.text : null;
    let before: string | null = null;
    if (audit.tool === "supersede" && mem?.supersedes_id) {
      const old = getOwnedMemory(userId, mem.supersedes_id);
      before = old ? old.text : null;
    }
    return { before, current };
  }
  return { before: null, current: null };
}
```

- [ ] **Step 4: Add the preview route in `audit/routes.ts`**

Update the two imports to add `getOwnedAuditRow` and `previewRevert`:

```ts
import { listActivity, getOwnedAuditRow } from "../db.ts";
import { toActivityEntry, previewRevert } from "./activity.ts";
```

Then add the route:

```ts
activityRouter.get("/:auditId/preview", limiter, (req: Request, res: Response) => {
  const uid = requireCookieUser(req, res);
  if (!uid) return;
  const audit = getOwnedAuditRow(uid, req.params.auditId as string);
  if (!audit) {
    res.status(404).json({ error: "Activity not found" });
    return;
  }
  res.json(previewRevert(uid, audit));
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd landing && npx vitest run server/audit/routes.test.ts -t "preview"`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `cd landing && npm run typecheck:server`

```bash
git add landing/server/db.ts landing/server/audit/
git commit -m "feat(sp3): activity preview endpoint (before/current diff data)"
```

---

## Task 4: Revert — create_note (delete) + auth + audited + conflict guard

**Files:**
- Modify: `landing/server/audit/activity.ts`
- Modify: `landing/server/audit/routes.ts`
- Test: `landing/server/audit/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
describe("POST /api/activity/:id/revert — create_note", () => {
  async function setup4(email: string) {
    const cookie = await signup(srv.baseURL, email);
    const token = await mintToken(cookie, ["read", "write", "memory"], "Claude Code");
    return { cookie, pat: makePatClient(srv.baseURL, token), token };
  }

  it("deletes the AI-created note and records a revert row", async () => {
    const { cookie, pat } = await setup4("rev-create@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/del.md", title: "Del", content: "hi" });
    const { fileId } = (await create.json()) as { fileId: string };
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: any[] };
    const row = activity.find((a) => a.tool === "create_note");

    const res = await cookie.req("POST", `/api/activity/${row.id}/revert`, {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).status).toBe("reverted");

    // Note is gone:
    expect((await pat.req("GET", `/api/files/${fileId}`)).status).toBe(404);
    // A 'revert' row now appears; the original create is no longer revertible:
    const after = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: any[] };
    expect(after.activity.some((a) => a.tool === "revert")).toBe(true);
    expect(after.activity.find((a) => a.tool === "create_note").revertible).toBe(false);
  });

  it("rejects a PAT caller with 403", async () => {
    const { cookie, pat } = await setup4("rev-pat@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/x.md", title: "X", content: "x" });
    void create;
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: any[] };
    const res = await pat.req("POST", `/api/activity/${activity[0].id}/revert`, {});
    expect(res.status).toBe(403);
  });

  it("404s a foreign audit id", async () => {
    const a = await setup4("rev-iso-a@example.com");
    const b = await setup4("rev-iso-b@example.com");
    await a.pat.req("POST", "/api/notes", { path: "Memory/x.md", title: "X", content: "x" });
    const { activity } = (await (await a.cookie.req("GET", "/api/activity")).json()) as { activity: any[] };
    const res = await b.cookie.req("POST", `/api/activity/${activity[0].id}/revert`, {});
    expect(res.status).toBe(404);
  });

  it("409 conflict when the note changed since the AI created it; force deletes", async () => {
    const { cookie, pat } = await setup4("rev-conflict@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/c.md", title: "C", content: "orig" });
    const { fileId } = (await create.json()) as { fileId: string };
    await cookie.req("PATCH", `/api/files/${fileId}`, { content: "human changed it" });
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: any[] };
    const row = activity.find((a) => a.tool === "create_note");

    const conflict = await cookie.req("POST", `/api/activity/${row.id}/revert`, {});
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as any).status).toBe("conflict");

    const forced = await cookie.req("POST", `/api/activity/${row.id}/revert`, { force: true });
    expect(forced.status).toBe(200);
    expect((await pat.req("GET", `/api/files/${fileId}`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd landing && npx vitest run server/audit/routes.test.ts -t "create_note"`
Expected: FAIL (revert route missing).

- [ ] **Step 3: Add the dispatcher (create_note case) to `audit/activity.ts`**

Extend imports and add `RevertResult` + `performRevert`:

```ts
import {
  getOwnedFile, getSnapshot, getOwnedMemory, updateFile, deleteFile, sha256Hex, writeAudit,
  type AuditRow, type ActivityRaw,
} from "../db.ts";
```

```ts
export type RevertResult =
  | { status: "reverted" }
  | { status: "conflict"; before: string | null; current: string | null }
  | { status: "not_revertible"; reason: string };

export function performRevert(userId: string, audit: AuditRow, force: boolean): RevertResult {
  switch (audit.tool) {
    case "create_note": {
      if (!audit.target) return { status: "not_revertible", reason: "no target" };
      const file = getOwnedFile(userId, audit.target);
      if (!file) return { status: "not_revertible", reason: "note already removed" };
      if (!force && audit.after_hash && sha256Hex(file.content) !== audit.after_hash) {
        return { status: "conflict", before: null, current: file.content };
      }
      deleteFile(file.id);
      writeAudit({ userId, tokenId: null, tool: "revert", target: audit.target, sourceClient: "web" });
      return { status: "reverted" };
    }
    default:
      return { status: "not_revertible", reason: "not a revertible action" };
  }
}
```

- [ ] **Step 4: Add the revert route to `audit/routes.ts`**

Add the `express` default import (for the JSON body parser) and `zod`, extend the `activity.ts` import, and define `jsonBody` + the schema:

```ts
import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
// ...existing imports (getCurrentUser, listActivity + getOwnedAuditRow, rateLimit)...
import { toActivityEntry, previewRevert, performRevert } from "./activity.ts";

const jsonBody = express.json({ limit: "16kb" });
const revertSchema = z.object({ force: z.boolean().optional() });

activityRouter.post("/:auditId/revert", limiter, jsonBody, (req: Request, res: Response) => {
  const uid = requireCookieUser(req, res);
  if (!uid) return;
  const audit = getOwnedAuditRow(uid, req.params.auditId as string);
  if (!audit) {
    res.status(404).json({ error: "Activity not found" });
    return;
  }
  const parsed = revertSchema.safeParse(req.body ?? {});
  const force = parsed.success ? parsed.data.force ?? false : false;
  const result = performRevert(uid, audit, force);
  if (result.status === "conflict") { res.status(409).json(result); return; }
  if (result.status === "not_revertible") { res.status(422).json(result); return; }
  res.json(result);
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd landing && npx vitest run server/audit/routes.test.ts -t "create_note"`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `cd landing && npm run typecheck:server && npm run lint`

```bash
git add landing/server/audit/
git commit -m "feat(sp3): revert create_note (delete) — cookie-only, audited, conflict-guarded"
```

---

## Task 5: Revert — note edits (append / update_section) restore from snapshot

**Files:**
- Modify: `landing/server/audit/activity.ts`
- Test: `landing/server/audit/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
describe("revert note edits (snapshot restore)", () => {
  async function setup5(email: string) {
    const cookie = await signup(srv.baseURL, email);
    const token = await mintToken(cookie, ["read", "write", "memory"], "Claude Code");
    return { cookie, pat: makePatClient(srv.baseURL, token) };
  }

  it("restores the pre-image of an append", async () => {
    const { cookie, pat } = await setup5("rev-append@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/a.md", title: "A", content: "original\n" });
    const { fileId } = (await create.json()) as { fileId: string };
    await pat.req("POST", `/api/files/${fileId}/append`, { text: "appended" });
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: any[] };
    const row = activity.find((a) => a.tool === "append_note");

    const res = await cookie.req("POST", `/api/activity/${row.id}/revert`, {});
    expect(res.status).toBe(200);
    const file = (await (await pat.req("GET", `/api/files/${fileId}`)).json()) as { file: { content: string } };
    expect(file.file.content).toBe("original\n");
  });

  it("restores the pre-image of an update_section", async () => {
    const { cookie, pat } = await setup5("rev-section@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/s.md", title: "S", content: "# A\nold body\n" });
    const { fileId } = (await create.json()) as { fileId: string };
    await pat.req("PATCH", `/api/files/${fileId}/section`, { heading: "A", content: "# A\nnew body\n" });
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: any[] };
    const row = activity.find((a) => a.tool === "update_section");

    await cookie.req("POST", `/api/activity/${row.id}/revert`, {});
    const file = (await (await pat.req("GET", `/api/files/${fileId}`)).json()) as { file: { content: string } };
    expect(file.file.content).toBe("# A\nold body\n");
  });

  it("409 conflict when the note changed since the AI edit; force overwrites", async () => {
    const { cookie, pat } = await setup5("rev-append-conflict@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/ac.md", title: "AC", content: "base\n" });
    const { fileId } = (await create.json()) as { fileId: string };
    await pat.req("POST", `/api/files/${fileId}/append`, { text: "ai" });
    await cookie.req("PATCH", `/api/files/${fileId}`, { content: "human took over" });
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: any[] };
    const row = activity.find((a) => a.tool === "append_note");

    expect((await cookie.req("POST", `/api/activity/${row.id}/revert`, {})).status).toBe(409);
    expect((await cookie.req("POST", `/api/activity/${row.id}/revert`, { force: true })).status).toBe(200);
    const file = (await (await pat.req("GET", `/api/files/${fileId}`)).json()) as { file: { content: string } };
    expect(file.file.content).toBe("base\n");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd landing && npx vitest run server/audit/routes.test.ts -t "snapshot restore"`
Expected: FAIL — these tools fall to `not_revertible` (422), not restored.

- [ ] **Step 3: Add the append/update_section cases to `performRevert`**

Insert before the `default:` case in the `switch`:

```ts
    case "append_note":
    case "update_section": {
      if (!audit.target) return { status: "not_revertible", reason: "no target" };
      const file = getOwnedFile(userId, audit.target);
      if (!file) return { status: "not_revertible", reason: "note already removed" };
      const before = getSnapshot(audit.id);
      if (before === null) return { status: "not_revertible", reason: "no snapshot (edit predates SP3)" };
      if (!force && audit.after_hash && sha256Hex(file.content) !== audit.after_hash) {
        return { status: "conflict", before, current: file.content };
      }
      updateFile(file.id, { content: before });
      writeAudit({ userId, tokenId: null, tool: "revert", target: audit.target, sourceClient: "web", beforeHash: sha256Hex(file.content) });
      return { status: "reverted" };
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd landing && npx vitest run server/audit/routes.test.ts -t "snapshot restore"`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `cd landing && npm run typecheck:server`

```bash
git add landing/server/audit/
git commit -m "feat(sp3): revert append_note/update_section via pre-image snapshot"
```

---

## Task 6: Revert — memory (remember undo + supersede undo)

**Files:**
- Modify: `landing/server/db.ts` (add `retireMemory` / `reactivateMemory`)
- Modify: `landing/server/audit/activity.ts`
- Test: `landing/server/audit/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
describe("revert memory", () => {
  async function setup6(email: string) {
    const cookie = await signup(srv.baseURL, email);
    const token = await mintToken(cookie, ["read", "write", "memory"], "Claude Code");
    return { cookie, pat: makePatClient(srv.baseURL, token) };
  }

  it("undo of remember retires the memory (gone from recall + browse)", async () => {
    const { cookie, pat } = await setup6("rev-remember@example.com");
    await pat.req("POST", "/api/memory", { text: "ephemeral fact", scope: "p" });
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: any[] };
    const row = activity.find((a) => a.tool === "remember");

    expect((await cookie.req("POST", `/api/activity/${row.id}/revert`, {})).status).toBe(200);
    const recall = (await (await pat.req("GET", "/api/memory?q=ephemeral&scope=p")).json()) as { memories: any[] };
    expect(recall.memories.length).toBe(0);
  });

  it("undo of a supersede reactivates the old memory and retires the new", async () => {
    const { cookie, pat } = await setup6("rev-supersede@example.com");
    const first = await pat.req("POST", "/api/memory", { text: "we use mysql", scope: "p" });
    const { memoryId: oldId } = (await first.json()) as { memoryId: string };
    await pat.req("POST", "/api/memory", { text: "we use postgres now", scope: "p", supersedes: oldId });
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: any[] };
    const row = activity.find((a) => a.tool === "supersede");

    expect((await cookie.req("POST", `/api/activity/${row.id}/revert`, {})).status).toBe(200);
    const recall = (await (await pat.req("GET", "/api/memory?q=mysql&scope=p")).json()) as { memories: any[] };
    expect(recall.memories.some((m) => m.text === "we use mysql")).toBe(true);
    const recall2 = (await (await pat.req("GET", "/api/memory?q=postgres&scope=p")).json()) as { memories: any[] };
    expect(recall2.memories.some((m) => m.text === "we use postgres now")).toBe(false);
  });

  it("422 when the memory write was already undone", async () => {
    const { cookie, pat } = await setup6("rev-twice@example.com");
    await pat.req("POST", "/api/memory", { text: "one time", scope: "p" });
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: any[] };
    const row = activity.find((a) => a.tool === "remember");
    await cookie.req("POST", `/api/activity/${row.id}/revert`, {});
    expect((await cookie.req("POST", `/api/activity/${row.id}/revert`, {})).status).toBe(422);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd landing && npx vitest run server/audit/routes.test.ts -t "revert memory"`
Expected: FAIL (memory tools → `not_revertible`).

- [ ] **Step 3: Add memory status helpers to `db.ts`**

Near the memory helpers (the `stmtSupersede` line), add:

```ts
const stmtReactivate = db.prepare("UPDATE memories SET status = 'active' WHERE id = ? AND user_id = ?");
export function retireMemory(userId: string, id: string): void {
  stmtSupersede.run(id, userId); // → status='superseded'
}
export function reactivateMemory(userId: string, id: string): void {
  stmtReactivate.run(id, userId); // → status='active'
}
```

- [ ] **Step 4: Add the memory cases to `performRevert`**

Update the `audit/activity.ts` import to include the two helpers:

```ts
import {
  getOwnedFile, getSnapshot, getOwnedMemory, retireMemory, reactivateMemory,
  updateFile, deleteFile, sha256Hex, writeAudit,
  type AuditRow, type ActivityRaw,
} from "../db.ts";
```

Insert before the `default:` case:

```ts
    case "remember": {
      if (!audit.target) return { status: "not_revertible", reason: "no target" };
      const mem = getOwnedMemory(userId, audit.target);
      if (!mem || mem.status !== "active") return { status: "not_revertible", reason: "memory already inactive" };
      retireMemory(userId, audit.target);
      writeAudit({ userId, tokenId: null, tool: "revert", target: audit.target, sourceClient: "web" });
      return { status: "reverted" };
    }
    case "supersede": {
      if (!audit.target) return { status: "not_revertible", reason: "no target" };
      const newer = getOwnedMemory(userId, audit.target);
      if (!newer || newer.status !== "active") return { status: "not_revertible", reason: "correction already undone" };
      // Retire the newer FIRST, then reactivate the old, so the partial unique
      // index never sees two active rows with the same norm_text.
      retireMemory(userId, newer.id);
      if (newer.supersedes_id) reactivateMemory(userId, newer.supersedes_id);
      writeAudit({ userId, tokenId: null, tool: "revert", target: audit.target, sourceClient: "web" });
      return { status: "reverted" };
    }
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd landing && npx vitest run server/audit/routes.test.ts`
Expected: PASS (entire file).

- [ ] **Step 6: Commit**

Run: `cd landing && npm run typecheck:server && npm run lint`

```bash
git add landing/server/db.ts landing/server/audit/
git commit -m "feat(sp3): revert memory writes (remember undo + supersede undo)"
```

---

## Task 7: Client API + ActivityClient DI + format helper (TDD)

**Files:**
- Create: `landing/src/workspace/activityClient.ts`
- Create: `landing/src/workspace/activityFormat.ts`
- Test: `landing/src/workspace/activityFormat.test.ts`
- Modify: `landing/src/app/api.ts`
- Create: `landing/src/app/activityClient.ts`

- [ ] **Step 1: Write the failing test**

Create `landing/src/workspace/activityFormat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { describeActivity } from "./activityFormat";
import type { ActivityEntry } from "./activityClient";

function entry(over: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: "a", tool: "create_note", createdAt: 0, client: "claude-code", device: "Laptop",
    target: { kind: "note", id: "f", title: "Memory/decisions.md", path: "Memory/decisions.md", text: null, status: null, exists: true },
    revertible: true, hasSnapshot: false, ...over,
  };
}

describe("describeActivity", () => {
  it("describes a note create with client + title", () => {
    expect(describeActivity(entry({}))).toBe("claude-code created Memory/decisions.md");
  });
  it("describes a memory remember with truncated text", () => {
    expect(describeActivity(entry({
      tool: "remember", client: "cursor",
      target: { kind: "memory", id: "m", title: null, path: null, text: "we use postgres", status: "active", exists: true },
    }))).toBe("cursor remembered “we use postgres”");
  });
  it("falls back to device, then a generic actor", () => {
    expect(describeActivity(entry({ client: null, device: "Work laptop" }))).toContain("Work laptop");
    expect(describeActivity(entry({ client: null, device: null }))).toContain("An AI tool");
  });
  it("labels a deleted note target", () => {
    expect(describeActivity(entry({
      tool: "append_note",
      target: { kind: "note", id: "f", title: null, path: null, text: null, status: null, exists: false },
    }))).toContain("a deleted note");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd landing && npx vitest run src/workspace/activityFormat.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `workspace/activityClient.ts`**

```ts
export interface ActivityTarget {
  kind: "note" | "memory";
  id: string | null;
  title: string | null;
  path: string | null;
  text: string | null;
  status: string | null;
  exists: boolean;
}
export interface ActivityEntry {
  id: string;
  tool: string;
  createdAt: number;
  client: string | null;
  device: string | null;
  target: ActivityTarget;
  revertible: boolean;
  hasSnapshot: boolean;
}
export interface ActivityFilter {
  tool?: string;
  source?: string;
  fileId?: string;
  before?: number;
  limit?: number;
}
export interface RevertOutcome {
  status: string;
  before?: string | null;
  current?: string | null;
}

/** Surface-agnostic contract the Activity view needs; real impl wraps `api`. */
export interface ActivityClient {
  list(filter?: ActivityFilter): Promise<ActivityEntry[]>;
  preview(auditId: string): Promise<{ before: string | null; current: string | null }>;
  revert(auditId: string, force?: boolean): Promise<RevertOutcome>;
}
```

- [ ] **Step 4: Create `workspace/activityFormat.ts`**

```ts
import type { ActivityEntry } from "./activityClient";

const VERB: Record<string, string> = {
  create_note: "created",
  append_note: "appended to",
  update_section: "edited a section of",
  remember: "remembered",
  supersede: "corrected a memory",
  revert: "reverted",
};

/** One-line human description, e.g. "cursor appended to Memory/decisions.md". */
export function describeActivity(e: ActivityEntry): string {
  const who = e.client ?? e.device ?? "An AI tool";
  const verb = VERB[e.tool] ?? e.tool;
  if (e.target.kind === "memory") {
    const txt = e.target.text ? `“${e.target.text.slice(0, 60)}”` : "a memory";
    return `${who} ${verb} ${txt}`;
  }
  const where = e.target.title ?? e.target.path ?? (e.target.exists ? "a note" : "a deleted note");
  return `${who} ${verb} ${where}`;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd landing && npx vitest run src/workspace/activityFormat.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Add the `activity` namespace to `app/api.ts`**

Add the type import near the top (with the other `import type` lines):

```ts
import type { ActivityEntry } from "../workspace/activityClient";
```

Add this namespace inside the `api` object, after the `memory` block:

```ts
  /* AI activity (provenance/trust surface — cookie only) */
  activity: {
    list: (params?: { tool?: string; source?: string; fileId?: string; before?: number; limit?: number }) =>
      request<{ activity: ActivityEntry[] }>(
        "GET",
        `/api/activity?${new URLSearchParams({
          ...(params?.tool ? { tool: params.tool } : {}),
          ...(params?.source ? { source: params.source } : {}),
          ...(params?.fileId ? { fileId: params.fileId } : {}),
          ...(params?.before ? { before: String(params.before) } : {}),
          limit: String(params?.limit ?? 50),
        }).toString()}`,
      ),
    preview: (auditId: string) =>
      request<{ before: string | null; current: string | null }>("GET", `/api/activity/${auditId}/preview`),
    // Revert resolves the 409 "conflict" outcome as data (not an error) so the
    // UI can show the diff + offer force; other non-2xx still throw.
    revert: async (auditId: string, force = false) => {
      const res = await fetch(`/api/activity/${auditId}/revert`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": await ensureCsrfToken() },
        body: JSON.stringify({ force }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; error?: string; before?: string | null; current?: string | null };
      if (!res.ok && res.status !== 409) {
        throw new ApiError(data.error ?? "Revert failed.", res.status);
      }
      return data as { status: string; before?: string | null; current?: string | null };
    },
  },
```

- [ ] **Step 7: Create `app/activityClient.ts`**

```ts
import { api } from "./api";
import type { ActivityClient } from "../workspace/activityClient";

export const realActivityClient: ActivityClient = {
  async list(filter) {
    return (await api.activity.list(filter)).activity;
  },
  async preview(auditId) {
    return api.activity.preview(auditId);
  },
  async revert(auditId, force) {
    return api.activity.revert(auditId, force ?? false);
  },
};
```

- [ ] **Step 8: Typecheck + commit**

Run: `cd landing && npx tsc -b --noEmit`
Expected: clean.

```bash
git add landing/src/workspace/activityClient.ts landing/src/workspace/activityFormat.ts landing/src/workspace/activityFormat.test.ts landing/src/app/api.ts landing/src/app/activityClient.ts
git commit -m "feat(sp3): activity API client + ActivityClient DI + describeActivity helper"
```

---

## Task 8: ActivityView component + styles

**Files:**
- Create: `landing/src/workspace/ActivityView.tsx`
- Modify: `landing/src/styles/workspace.css`

- [ ] **Step 1: Create `workspace/ActivityView.tsx`**

```tsx
import { useEffect, useState, useCallback } from "react";
import type { ActivityClient, ActivityEntry } from "./activityClient";
import { describeActivity } from "./activityFormat";

const TOOL_FILTERS = [
  { value: "", label: "All actions" },
  { value: "create_note", label: "Created" },
  { value: "append_note", label: "Appended" },
  { value: "update_section", label: "Edited" },
  { value: "remember", label: "Remembered" },
  { value: "supersede", label: "Corrected" },
];
const CLIENT_FILTERS = [
  { value: "", label: "All tools" },
  { value: "claude-code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "codex", label: "Codex" },
];

function when(ts: number): string {
  const s = Math.max(0, Date.now() - ts) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface Props {
  client: ActivityClient;
  initialFileId?: string;
  onClose: () => void;
  onOpenNote?: (fileId: string) => void;
}

export function ActivityView({ client, initialFileId, onClose, onOpenNote }: Props) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [tool, setTool] = useState("");
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ entry: ActivityEntry; before: string | null; current: string | null; conflict: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    client
      .list({ tool: tool || undefined, source: source || undefined, fileId: initialFileId })
      .then((rows) => { setEntries(rows); setErr(null); })
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load activity."))
      .finally(() => setLoading(false));
  }, [client, tool, source, initialFileId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") (confirm ? setConfirm(null) : onClose()); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirm]);

  const openConfirm = async (entry: ActivityEntry) => {
    setErr(null);
    try {
      const { before, current } = await client.preview(entry.id);
      setConfirm({ entry, before, current, conflict: false });
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load preview."); }
  };

  const doRevert = async (force: boolean) => {
    if (!confirm) return;
    setBusy(true); setErr(null);
    try {
      const r = await client.revert(confirm.entry.id, force);
      if (r.status === "conflict") { setConfirm({ ...confirm, before: r.before ?? confirm.before, current: r.current ?? confirm.current, conflict: true }); return; }
      setConfirm(null);
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Revert failed."); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="nw-menu-scrim" onClick={onClose} />
      <div className="nw-act-panel" role="dialog" aria-labelledby="act-title">
        <header className="nw-act-head">
          <h2 id="act-title">AI Activity</h2>
          <button className="nw-mcp-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <p className="nw-act-sub">Everything your AI tools wrote{initialFileId ? " to this note" : ""}. Revert anything.</p>

        <div className="nw-act-filters">
          <select value={tool} onChange={(e) => setTool(e.target.value)} aria-label="Filter by action">
            {TOOL_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filter by tool">
            {CLIENT_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>

        {err && <p className="nw-mcp-err">{err}</p>}
        {loading && <p className="nw-mcp-empty">Loading…</p>}
        {!loading && entries.length === 0 && <p className="nw-mcp-empty">No AI writes yet.</p>}

        <ul className="nw-act-list">
          {entries.map((e) => (
            <li key={e.id} className="nw-act-row">
              <div className="nw-act-main">
                <span className="nw-act-desc">{describeActivity(e)}</span>
                <span className="nw-act-meta">
                  {e.device ? `${e.device} · ` : ""}{when(e.createdAt)}
                </span>
              </div>
              <div className="nw-act-actions">
                {e.target.kind === "note" && e.target.exists && e.target.id && onOpenNote && (
                  <button className="nw-act-link" onClick={() => { onOpenNote(e.target.id as string); onClose(); }}>Open</button>
                )}
                {e.revertible ? (
                  <button className="nw-act-revert" onClick={() => openConfirm(e)}>Revert</button>
                ) : e.tool === "revert" ? (
                  <span className="nw-act-badge">undo</span>
                ) : (
                  <span className="nw-act-badge" title="No snapshot — this edit predates the trust layer, or it was already reverted.">view only</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {confirm && (
        <>
          <div className="nw-menu-scrim" onClick={() => setConfirm(null)} />
          <div className="nw-act-confirm" role="dialog" aria-labelledby="act-confirm-title">
            <h3 id="act-confirm-title">{confirm.conflict ? "This changed since the AI wrote it" : "Revert this change?"}</h3>
            <p className="nw-act-desc">{describeActivity(confirm.entry)}</p>
            {confirm.conflict && <p className="nw-mcp-err">Reverting will discard edits made after the AI write.</p>}
            <div className="nw-act-diff">
              <div><div className="nw-act-difflabel">Before</div><pre>{confirm.before ?? "(did not exist)"}</pre></div>
              <div><div className="nw-act-difflabel">Current</div><pre>{confirm.current ?? "(deleted)"}</pre></div>
            </div>
            <div className="nw-act-confirm-actions">
              <button onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
              <button className="nw-act-revert" onClick={() => doRevert(confirm.conflict)} disabled={busy}>
                {confirm.conflict ? "Revert anyway" : "Revert"}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: Add styles to `landing/src/styles/workspace.css`**

Append (mirrors the existing `nw-mcp-*` panel conventions — reuse `--nw-*` design tokens already defined in this file):

```css
/* ----------------------------- AI Activity ----------------------------- */
.nw-act-panel {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: min(680px, 92vw); max-height: 84vh; overflow-y: auto; z-index: 60;
  background: var(--nw-surface); border: 1px solid var(--nw-border);
  border-radius: 14px; padding: 20px 22px; box-shadow: var(--nw-shadow-lg, 0 24px 60px rgba(0,0,0,.28));
}
.nw-act-head { display: flex; align-items: center; justify-content: space-between; }
.nw-act-head h2 { margin: 0; font-size: 1.05rem; }
.nw-act-sub { color: var(--nw-text-dim); font-size: .85rem; margin: 4px 0 14px; }
.nw-act-filters { display: flex; gap: 8px; margin-bottom: 12px; }
.nw-act-filters select {
  background: var(--nw-surface-2, var(--nw-surface)); color: var(--nw-text);
  border: 1px solid var(--nw-border); border-radius: 8px; padding: 6px 10px; font-size: .85rem;
}
.nw-act-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.nw-act-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 8px; border-bottom: 1px solid var(--nw-border); }
.nw-act-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.nw-act-desc { font-size: .9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nw-act-meta { font-size: .75rem; color: var(--nw-text-dim); }
.nw-act-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.nw-act-revert { background: var(--nw-danger, #c0392b); color: #fff; border: none; border-radius: 7px; padding: 5px 12px; font-size: .8rem; cursor: pointer; }
.nw-act-revert:disabled { opacity: .5; cursor: default; }
.nw-act-link { background: none; border: 1px solid var(--nw-border); color: var(--nw-text); border-radius: 7px; padding: 5px 10px; font-size: .8rem; cursor: pointer; }
.nw-act-badge { font-size: .72rem; color: var(--nw-text-dim); border: 1px solid var(--nw-border); border-radius: 6px; padding: 3px 7px; }
.nw-act-confirm {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 61;
  width: min(620px, 92vw); max-height: 84vh; overflow-y: auto;
  background: var(--nw-surface); border: 1px solid var(--nw-border); border-radius: 14px; padding: 20px 22px;
  box-shadow: var(--nw-shadow-lg, 0 24px 60px rgba(0,0,0,.28));
}
.nw-act-confirm h3 { margin: 0 0 6px; font-size: 1rem; }
.nw-act-diff { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; }
.nw-act-difflabel { font-size: .72rem; color: var(--nw-text-dim); margin-bottom: 4px; }
.nw-act-diff pre {
  background: var(--nw-surface-2, rgba(127,127,127,.08)); border: 1px solid var(--nw-border);
  border-radius: 8px; padding: 10px; max-height: 240px; overflow: auto;
  font-size: .8rem; white-space: pre-wrap; word-break: break-word; margin: 0;
}
.nw-act-confirm-actions { display: flex; justify-content: flex-end; gap: 10px; }
.nw-act-confirm-actions button { border-radius: 7px; padding: 6px 14px; font-size: .85rem; cursor: pointer; border: 1px solid var(--nw-border); background: none; color: var(--nw-text); }
```

(If a referenced token like `--nw-surface-2`/`--nw-danger`/`--nw-shadow-lg` isn't defined in this file, the `var(..., fallback)` second argument covers it; verify against the existing `:root` tokens and drop the fallback where the token exists.)

- [ ] **Step 3: Verify the client compiles**

Run: `cd landing && npx tsc -b --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add landing/src/workspace/ActivityView.tsx landing/src/styles/workspace.css
git commit -m "feat(sp3): ActivityView component (timeline + filters + revert dialog)"
```

---

## Task 9: Wire ActivityView into the app (gated like the MCP panel)

**Files:**
- Modify: `landing/src/workspace/NotoWindow.tsx`
- Modify: `landing/src/workspace/Sidebar.tsx`
- Modify: `landing/src/workspace/ContextPanel.tsx`
- Modify: `landing/src/app/NotoWorkspace.tsx`

- [ ] **Step 1: Add the `ActivityClient` prop + state + mount in `NotoWindow.tsx`**

Add imports near the `McpSettings`/`mcpClient` imports:

```tsx
import { ActivityView } from "./ActivityView";
import type { ActivityClient } from "./activityClient";
```

Add to the `Props` interface (next to `mcpClient?`):

```tsx
  /** Provenance/trust surface backend (omit in the demo). */
  activityClient?: ActivityClient;
```

Add `activityClient` to the destructured params (next to `mcpClient,`). Add state next to `const [mcpOpen, setMcpOpen] = useState(false);`:

```tsx
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityFileId, setActivityFileId] = useState<string | undefined>(undefined);
  const openActivity = (fileId?: string) => { setActivityFileId(fileId); setActivityOpen(true); };
```

Thread a Sidebar prop (next to `onOpenConnect=...`):

```tsx
            onOpenActivity={activityClient ? () => openActivity() : undefined}
```

Pass the per-note entry point to `ContextPanel` (replace the existing `{ws.contextOpen && <ContextPanel meta={currentMeta} onOpenTitle={ws.openTitle} />}`):

```tsx
          {ws.contextOpen && (
            <ContextPanel
              meta={currentMeta}
              onOpenTitle={ws.openTitle}
              onOpenAiChanges={
                activityClient && activeKind === "note" && ws.currentNoteId
                  ? () => openActivity(ws.currentNoteId)
                  : undefined
              }
            />
          )}
```

Mount the view next to the `McpSettings` mount:

```tsx
      {activityOpen && activityClient && (
        <ActivityView
          client={activityClient}
          initialFileId={activityFileId}
          onClose={() => setActivityOpen(false)}
          onOpenNote={ws.openNote}
        />
      )}
```

- [ ] **Step 2: Add the sidebar entry in `Sidebar.tsx`**

Add to the `Props` interface (next to `onOpenConnect?`):

```tsx
  onOpenActivity?: () => void;
```

Add `onOpenActivity` to the destructured `props`. Add a NavButton right after the "Knowledge Web" one (only when wired):

```tsx
        {onOpenActivity && (
          <NavButton icon="clock" label="AI Activity" active={false} onClick={onOpenActivity} />
        )}
```

- [ ] **Step 3: Add the per-note button in `ContextPanel.tsx`**

Extend `Props`:

```tsx
interface Props {
  meta: FileMetadata | undefined;
  onOpenTitle: (title: string) => void;
  onOpenAiChanges?: () => void;
}
```

Destructure `onOpenAiChanges` and render a button just under the path (after `<div className="nw-context-path">{meta.path}</div>`):

```tsx
      {onOpenAiChanges && (
        <button className="nw-act-link" style={{ marginTop: 8 }} onClick={onOpenAiChanges}>
          AI changes
        </button>
      )}
```

- [ ] **Step 4: Inject the real client in `NotoWorkspace.tsx`**

Add the import (next to `realMcpClient`):

```tsx
import { realActivityClient } from "./activityClient";
```

Add the prop to `<NotoWindow ...>` (next to `mcpClient={realMcpClient}`):

```tsx
      activityClient={realActivityClient}
```

(The demo mounts `NotoWindow` without `activityClient`, so the sidebar entry + per-note button stay hidden there — same gating as the MCP panel.)

- [ ] **Step 5: Verify the client compiles + full build**

Run: `cd landing && npm run build`
Expected: `tsc -b` + `vite build` succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add landing/src/workspace/NotoWindow.tsx landing/src/workspace/Sidebar.tsx landing/src/workspace/ContextPanel.tsx landing/src/app/NotoWorkspace.tsx
git commit -m "feat(sp3): wire AI Activity view into sidebar + per-note context (gated)"
```

---

## Task 10: Full verification + live smoke

**Files:** none (verification only)

- [ ] **Step 1: Full landing suite + checks**

Run: `cd landing && npm test`
Expected: all green (162 prior + the new `audit/routes.test.ts` + `activityFormat.test.ts`).

Run: `cd landing && npm run typecheck:server && npm run lint && npm run build`
Expected: all clean.

- [ ] **Step 2: Confirm `noto-mcp` is unaffected**

Run: `cd noto-mcp && npm test && npm run typecheck && npm run build`
Expected: 21 tests green; still exactly 9 tools (SP3 added none).

- [ ] **Step 3: Live end-to-end smoke (real chain)**

Start the API on a temp DB + port, then drive it. Run from repo root:

```bash
cd landing
DATABASE_PATH=/tmp/noto-sp3-smoke.sqlite PORT=8799 NODE_ENV=development \
  SESSION_SECRET=smoke-session-secret-at-least-32-chars-long APP_ORIGIN=http://localhost:5173 \
  npx tsx server/index.ts &
sleep 2
```

Then, with a small script (mirror the SP1/SP2 smoke in the prior session transcript): prime CSRF via `GET /api/health`, `POST /api/auth/signup`, mint a `read,write,memory` PAT via `POST /api/tokens`, then over the PAT:
1. `create_note` → `Memory/smoke.md`, `append_note`, `update_section`, `remember`.
2. As the cookie session, `GET /api/activity` → expect 4 enriched rows (client `claude-code`, correct devices/targets).
3. `POST /api/activity/:id/revert` on the `append_note` row → 200; re-`GET /api/files/:id` → content is the pre-append snapshot.
4. `POST /api/activity/:id/revert` on the `create_note` row → 200; `GET /api/files/:id` → 404.
5. `POST /api/activity/:id/revert` on the `remember` row → 200; `GET /api/memory?q=...` → gone.
6. A PAT `GET /api/activity` → 403 (human-only).

Kill the server: `kill %1` (or the captured PID).

Expected: each step matches. Capture the output as the smoke evidence.

- [ ] **Step 4: Optional browser smoke**

`npm run dev`, sign in, make an AI write via a connected tool (or the smoke script), open **AI Activity** from the sidebar, confirm the entry renders and **Revert** restores/deletes as expected; open a `Memory/` note and confirm the **AI changes** button opens the filtered view.

- [ ] **Step 5: Update the memory file**

Update `noto-mcp-memory-layer` with SP3 status (built/verified, endpoints + tables added, 9 tools unchanged, revert is human-only + audited).

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "test(sp3): full verification + live revert smoke"
```

---

## Self-Review notes (resolved)

- **Spec coverage:** schema (§4) → Task 1; provenance population (§4.1, S3-D3) → Task 2; preview (§5) → Task 3; revert create/edit/memory (§5 table) → Tasks 4–6; conflict guard (S3-D5) → Tasks 4–5; human-only + audited (S3-D4) → Tasks 1/4; timeline membership incl. reverts (S3-D6) → Task 1 query + Task 4 assertion; dedicated view + per-note + DI gating (§7) → Tasks 8–9; success criteria (§10) → Task 10.
- **`writeAudit` signature change is backward-compatible:** existing callers ignore the returned id; the new params are optional.
- **Type consistency:** `ActivityEntry`/`ActivityTarget` are defined once server-side (`audit/activity.ts`) and once client-side (`workspace/activityClient.ts`) with identical field names/shape; `api.ts` imports the client type. `performRevert` returns `RevertResult` with statuses `reverted | conflict | not_revertible`, mapped to HTTP 200/409/422 in `audit/routes.ts` and surfaced to the client as `RevertOutcome`.
- **Migration safety:** `audit_log` columns are added both in the `CREATE TABLE` (fresh DBs) and via guarded `ALTER TABLE` (existing DBs), mirroring the `pinned` precedent; `audit_snapshots` uses `CREATE TABLE IF NOT EXISTS` with `ON DELETE CASCADE` (FKs are enabled).
