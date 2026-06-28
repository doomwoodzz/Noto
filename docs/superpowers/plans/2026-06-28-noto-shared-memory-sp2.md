# Noto Shared Memory — SP2 Implementation Plan (write-back loop + multi-client)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let AI tools write durable memory back into Noto — atomic (SP1) plus narrative `Memory/*.md` pages — hard-confined to `Memory/` so they can't clobber human notes, audited on every write, with Cursor + Codex wired alongside Claude Code.

**Architecture:** Same stdio `noto-mcp` → PAT → Express → SQLite chain as SP1. SP2 adds 2 write endpoints (`POST /api/notes`, `POST /api/files/:id/append`) + a `Memory/` confinement guard on all PAT writes (incl. the existing section PATCH), 3 `noto-mcp` write tools (→ 9 total), and per-client config/steering in the Settings panel. No new tables (narrative pages are ordinary `files` rows under `Memory/`, already FTS-indexed).

**Tech Stack:** Node 22+ / Express 5, `node:sqlite`, zod 4, vitest 3, TypeScript (`.ts` import specifiers in `landing/`; `.js` specifiers in `noto-mcp/` per its NodeNext build); `@modelcontextprotocol/sdk` 1.x; React 19.

**Spec:** `docs/superpowers/specs/2026-06-28-noto-shared-memory-sp2-design.md`.

---

## Conventions (read once)

- **Imports:** `landing/` uses explicit `.ts` extensions; `noto-mcp/` source uses `.js` extensions (NodeNext) for production imports, `.ts` in test files.
- **Run one test file (landing):** `npx vitest run server/<path>.test.ts` from `landing/`.
- **Run one test file (noto-mcp):** `npx vitest run src/<path>.test.ts` from `noto-mcp/`.
- **Typecheck:** `npm run typecheck:server` (landing server), `npx tsc -b --noEmit` (landing client), `npm run typecheck` (noto-mcp).
- **Validation error shape:** `400 {error: parsed.error.issues[0]?.message ?? "<fallback>"}`.
- **Confinement rule:** PAT-authed writes (`req.apiUser` set) must target a path under `Memory/`; cookie sessions are unconfined.
- **Commits:** the plan lists commit steps for completeness; the executor may be told to leave changes uncommitted (as in SP1) — follow the controller's instruction.

## What already exists (REUSE — verified in code 2026-06-28)
- `landing/server/notes/routes.ts`: `createSchema`/`pathSchema`/`titleSchema`/`contentSchema`, `writeLimiter`, `jsonBody`, `requireUserId`, `resolveUserId` (PAT-or-cookie), `requireScope` import, and the section PATCH handler (`requireScope("write")`, ambiguity 409, `expectUpdatedAt`, `writeAudit`).
- `landing/server/db.ts`: `ensureDefaultVault`, `getVaultsForUser` (returns `{id,name}[]`, default first), `createFile`, `getOwnedFile`, `updateFile`, `countFilesForVault`, `MAX_FILES_PER_VAULT`, `pathTaken`, `toPublicFile`, `writeAudit({userId,tokenId,tool,target,beforeHash})`, `sha256Hex`.
- `landing/server/notes/sections.ts`: `getSection`, `replaceSection`, `listHeadings` (LF-normalizing).
- `landing/server/auth/pat.ts`: `requireScope` (scopes `read|write|destructive|memory`).
- `landing/server/test-helpers.ts`: `startTestServer`, `signup`, `mintToken(cookie, scopes, name)`, `makePatClient` (4th arg = extra headers), `makeCookieClient`.
- `noto-mcp/src/{notoClient,tools,index}.ts`: 6 tools, injected-fetch client, SDK `server.tool(name, desc, zodShape, handler)`.
- `landing/src/workspace/{mcpClient.ts, McpSettings.tsx}`, `landing/src/app/{mcpClient.ts, api.ts}`: `api.pat.mint` already accepts `("read"|"write"|"destructive"|"memory")[]`.

## File structure

**Server — `landing/server/`:**
- `notes/confinement.ts` + `notes/confinement.test.ts` — CREATE: `isMemoryPath`.
- `notes/sections.ts` + `notes/sections.test.ts` — MODIFY: add `appendUnderHeading` + tests.
- `notes/routes.ts` — MODIFY: import `isMemoryPath` + `appendUnderHeading`; add `POST /api/notes`, `POST /api/files/:fileId/append`; add confinement to section PATCH.
- `notes/write.test.ts` — CREATE: integration tests for the write endpoints + confinement.

**Package — `noto-mcp/src/`:**
- `notoClient.ts` + `notoClient.test.ts` — MODIFY: add `createNote`/`appendNote`/`updateSection` + tests.
- `tools.ts` + `tools.test.ts` — MODIFY: add 3 handlers + tests.
- `index.ts` — MODIFY: register the 3 tools.

**Client/UI — `landing/src/`:**
- `workspace/mcpConfigs.ts` + `workspace/mcpConfigs.test.ts` — CREATE: per-client snippet/steering generator.
- `workspace/mcpClient.ts` — MODIFY: `mintToken` scope type adds `"write"`.
- `workspace/McpSettings.tsx` — MODIFY: per-client tabs; mint `read,memory,write`.

---

# Part A — Server: write endpoints + confinement

### Task 1: `isMemoryPath` confinement guard

**Files:**
- Create: `landing/server/notes/confinement.ts`, `landing/server/notes/confinement.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// landing/server/notes/confinement.test.ts
import { describe, expect, it } from "vitest";
import { isMemoryPath, MEMORY_PREFIX } from "./confinement.ts";

describe("isMemoryPath", () => {
  it("accepts paths inside Memory/", () => {
    expect(isMemoryPath("Memory/decisions.md")).toBe(true);
    expect(isMemoryPath("Memory/proj/log.md")).toBe(true);
    expect(MEMORY_PREFIX).toBe("Memory/");
  });
  it("rejects paths outside Memory/ (case-sensitive, no prefix games)", () => {
    expect(isMemoryPath("Notes/x.md")).toBe(false);
    expect(isMemoryPath("memory/x.md")).toBe(false);   // case
    expect(isMemoryPath("MemoryX/x.md")).toBe(false);  // not the folder
    expect(isMemoryPath("x.md")).toBe(false);
  });
  it("rejects traversal escapes even under Memory/", () => {
    expect(isMemoryPath("Memory/../secret.md")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run (from `landing/`): `npx vitest run server/notes/confinement.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// landing/server/notes/confinement.ts
// The agent-writable boundary. PAT-authed note writes must stay under Memory/
// so an AI can never clobber a human-authored note elsewhere in the vault.
export const MEMORY_PREFIX = "Memory/";

/** True if a vault-relative path is inside the agent-writable Memory/ folder. */
export function isMemoryPath(path: string): boolean {
  return path.startsWith(MEMORY_PREFIX) && !path.slice(MEMORY_PREFIX.length).includes("..");
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run server/notes/confinement.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add landing/server/notes/confinement.ts landing/server/notes/confinement.test.ts
git commit -m "feat(server): Memory/ confinement guard (isMemoryPath)"
```

---

### Task 2: `appendUnderHeading` helper

**Files:**
- Modify: `landing/server/notes/sections.ts`
- Modify: `landing/server/notes/sections.test.ts`

- [ ] **Step 1: Add the failing test** (append to the existing `describe` in `sections.test.ts`)

```ts
import { appendUnderHeading } from "./sections.ts"; // add to the existing import line

const APPEND_DOC = "# Root\n\n## Log\n\n- one\n\n## Other\n\ntail";

it("appendUnderHeading adds text at the end of the section, before the next heading", () => {
  const out = appendUnderHeading(APPEND_DOC, "Root/Log", "- two");
  expect(out).not.toBeNull();
  expect(out).toContain("- one");
  expect(out).toContain("- two");
  // "- two" lands inside Log, before "## Other"
  expect(out!.indexOf("- two")).toBeLessThan(out!.indexOf("## Other"));
  expect(out).toContain("## Other");
});

it("appendUnderHeading returns null for a missing heading", () => {
  expect(appendUnderHeading(APPEND_DOC, "Root/Nope", "x")).toBeNull();
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run server/notes/sections.test.ts`
Expected: FAIL — `appendUnderHeading` not exported.

- [ ] **Step 3: Implement** (append to `sections.ts`, after `replaceSection`)

```ts
/** Append `text` at the end of the section addressed by `headingPath` (before the
 *  next same-or-higher heading). Returns the new document, or null if not found. */
export function appendUnderHeading(content: string, headingPath: string, text: string): string | null {
  const section = getSection(content, headingPath);
  if (section === null) return null;
  const newSection = `${section.replace(/\s+$/, "")}\n\n${text.trim()}\n`;
  return replaceSection(content, headingPath, newSection);
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run server/notes/sections.test.ts`
Expected: PASS (all, incl. the 2 new).

- [ ] **Step 5: Commit**

```bash
git add landing/server/notes/sections.ts landing/server/notes/sections.test.ts
git commit -m "feat(server): appendUnderHeading section helper"
```

---

### Task 3: `POST /api/notes` (create in default vault, confined)

**Files:**
- Modify: `landing/server/notes/routes.ts`
- Create: `landing/server/notes/write.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// landing/server/notes/write.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, makeCookieClient, type TestServer } from "../test-helpers.ts";

let s: TestServer;
beforeAll(async () => { s = await startTestServer(); });
afterAll(() => s.close());

async function writer(email: string, scopes: string[] = ["read", "memory", "write"]) {
  const cookie = await signup(s.baseURL, email);
  return { cookie, pat: makePatClient(s.baseURL, await mintToken(cookie, scopes, "w")) };
}

describe("POST /api/notes (create in default vault)", () => {
  it("creates a Memory/ note via a write PAT and returns its id", async () => {
    const { pat } = await writer("create-mem@example.com");
    const res = await pat.req("POST", "/api/notes", { path: "Memory/decisions.md", title: "Decisions", content: "# Decisions\n" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { fileId: string; path: string };
    expect(body.fileId).toBeTruthy();
    expect(body.path).toBe("Memory/decisions.md");
  });

  it("rejects a create OUTSIDE Memory/ from a PAT with 403 (confinement)", async () => {
    const { pat } = await writer("create-outside@example.com");
    const res = await pat.req("POST", "/api/notes", { path: "Notes/secret.md", title: "x", content: "" });
    expect(res.status).toBe(403);
  });

  it("rejects create from a read/memory-only token with 403 (scope)", async () => {
    const { pat } = await writer("create-noscope@example.com", ["read", "memory"]);
    const res = await pat.req("POST", "/api/notes", { path: "Memory/x.md", title: "x", content: "" });
    expect(res.status).toBe(403);
  });

  it("409s on a duplicate path", async () => {
    const { pat } = await writer("create-dup@example.com");
    await pat.req("POST", "/api/notes", { path: "Memory/a.md", title: "A", content: "" });
    const res = await pat.req("POST", "/api/notes", { path: "Memory/a.md", title: "A", content: "" });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run server/notes/write.test.ts`
Expected: FAIL — `/api/notes` POST 404s.

- [ ] **Step 3: Add the import + route to `notes/routes.ts`**

Add to the imports (top of file):
```ts
import { isMemoryPath } from "./confinement.ts";
import { appendUnderHeading } from "./sections.ts"; // extend the existing ./sections.ts import line instead of duplicating
```
(Extend the existing `import { getSection, replaceSection, listHeadings } from "./sections.ts";` to also import `appendUnderHeading`.)

Add the route (after the `POST /vaults/:vaultId/files` handler, before the section routes):
```ts
// Create a note in the caller's default vault (PAT write scope or cookie).
// PAT writes are confined to Memory/.
notesRouter.post("/notes", writeLimiter, jsonBody, (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "write")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid note" });
    return;
  }
  if (req.apiUser && !isMemoryPath(parsed.data.path)) {
    res.status(403).json({ error: "AI writes are confined to Memory/" });
    return;
  }
  ensureDefaultVault(uid);
  const vault = getVaultsForUser(uid)[0];
  if (!vault) {
    res.status(500).json({ error: "No vault" });
    return;
  }
  if (countFilesForVault(vault.id) >= MAX_FILES_PER_VAULT) {
    res.status(409).json({ error: "This vault is full." });
    return;
  }
  if (pathTaken(vault.id, parsed.data.path)) {
    res.status(409).json({ error: "A note already exists at that path." });
    return;
  }
  const file = createFile(vault.id, parsed.data);
  writeAudit({ userId: uid, tokenId: req.apiUser?.tokenId ?? null, tool: "create_note", target: file.id, beforeHash: null });
  res.status(201).json({ fileId: file.id, path: file.path });
});
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run server/notes/write.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add landing/server/notes/routes.ts landing/server/notes/write.test.ts
git commit -m "feat(server): POST /api/notes (default-vault create, Memory/-confined)"
```

---

### Task 4: `POST /api/files/:fileId/append`

**Files:**
- Modify: `landing/server/notes/routes.ts`
- Modify: `landing/server/notes/write.test.ts`

- [ ] **Step 1: Add the failing test** (append to `write.test.ts`)

```ts
describe("POST /api/files/:id/append", () => {
  async function memNote(pat: ReturnType<typeof makePatClient>, path: string, content: string) {
    const r = await pat.req("POST", "/api/notes", { path, title: "T", content });
    return ((await r.json()) as { fileId: string }).fileId;
  }

  it("appends to the end of a Memory/ note", async () => {
    const { pat } = await writer("append-end@example.com");
    const id = await memNote(pat, "Memory/log.md", "# Log\n\nfirst");
    const res = await pat.req("POST", `/api/files/${id}/append`, { text: "second" });
    expect(res.status).toBe(200);
    const note = (await (await pat.req("GET", `/api/files/${id}`)).json()) as { file: { content: string } };
    expect(note.file.content).toContain("first");
    expect(note.file.content).toContain("second");
  });

  it("appends under a heading", async () => {
    const { pat } = await writer("append-head@example.com");
    const id = await memNote(pat, "Memory/h.md", "# Root\n\n## Log\n\n- one\n\n## Other\n\ntail");
    const res = await pat.req("POST", `/api/files/${id}/append`, { text: "- two", underHeading: "Root/Log" });
    expect(res.status).toBe(200);
    const c = ((await (await pat.req("GET", `/api/files/${id}`)).json()) as { file: { content: string } }).file.content;
    expect(c.indexOf("- two")).toBeLessThan(c.indexOf("## Other"));
  });

  it("409s on a stale expectUpdatedAt", async () => {
    const { pat } = await writer("append-stale@example.com");
    const id = await memNote(pat, "Memory/s.md", "# S\n\nx");
    const res = await pat.req("POST", `/api/files/${id}/append`, { text: "y", expectUpdatedAt: 1 });
    expect(res.status).toBe(409);
  });

  it("403s appending to a note OUTSIDE Memory/ via PAT", async () => {
    const { cookie, pat } = await writer("append-outside@example.com");
    // create a non-Memory note via the cookie session (unconfined)
    const { vaults } = await (await cookie.req("GET", "/api/vaults")).json();
    const made = await cookie.req("POST", `/api/vaults/${vaults[0].id}/files`, { path: "Notes/Plain.md", title: "P", content: "# P\n\nx" });
    const id = ((await made.json()) as { file: { id: string } }).file.id;
    const res = await pat.req("POST", `/api/files/${id}/append`, { text: "sneaky" });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run server/notes/write.test.ts`
Expected: FAIL — append route 404s.

- [ ] **Step 3: Add the schema + route to `notes/routes.ts`** (after the section PATCH handler)

```ts
const appendSchema = z.object({
  text: z.string().trim().min(1).max(256 * 1024),
  underHeading: z.string().trim().min(1).max(400).optional(),
  expectUpdatedAt: z.number().int().optional(),
});

// Append text to a note (optionally under a heading). PAT writes confined to Memory/.
notesRouter.post("/files/:fileId/append", writeLimiter, jsonBody, (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "write")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const file = getOwnedFile(uid, req.params.fileId as string);
  if (!file) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  if (req.apiUser && !isMemoryPath(file.path)) {
    res.status(403).json({ error: "AI writes are confined to Memory/" });
    return;
  }
  const parsed = appendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid append" });
    return;
  }
  if (parsed.data.expectUpdatedAt !== undefined && parsed.data.expectUpdatedAt !== file.updated_at) {
    res.status(409).json({ error: "Note changed since expectUpdatedAt", currentUpdatedAt: file.updated_at });
    return;
  }
  let nextContent: string;
  if (parsed.data.underHeading) {
    const matches = listHeadings(file.content).filter((h) => h.path === parsed.data.underHeading);
    if (matches.length > 1) {
      res.status(409).json({ error: "Ambiguous heading: multiple sections share this path" });
      return;
    }
    const appended = appendUnderHeading(file.content, parsed.data.underHeading, parsed.data.text);
    if (appended === null) {
      res.status(404).json({ error: "Section not found", headings: listHeadings(file.content).map((h) => h.path) });
      return;
    }
    nextContent = appended;
  } else {
    nextContent = `${file.content.replace(/\s+$/, "")}\n\n${parsed.data.text}\n`;
  }
  writeAudit({ userId: uid, tokenId: req.apiUser?.tokenId ?? null, tool: "append_note", target: file.id, beforeHash: sha256Hex(file.content) });
  const updated = updateFile(file.id, { content: nextContent });
  res.json({ fileId: updated.id, updatedAt: updated.updatedAt });
});
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run server/notes/write.test.ts`
Expected: PASS (8 total).

- [ ] **Step 5: Commit**

```bash
git add landing/server/notes/routes.ts landing/server/notes/write.test.ts
git commit -m "feat(server): POST /api/files/:id/append (Memory/-confined, audited)"
```

---

### Task 5: confine the existing section PATCH + server regression

**Files:**
- Modify: `landing/server/notes/routes.ts`
- Modify: `landing/server/notes/write.test.ts`

- [ ] **Step 1: Add the failing test** (append to `write.test.ts`)

```ts
describe("PATCH /api/files/:id/section confinement", () => {
  it("403s a section edit on a non-Memory note via PAT, but allows it via cookie", async () => {
    const { cookie, pat } = await writer("section-confine@example.com");
    const { vaults } = await (await cookie.req("GET", "/api/vaults")).json();
    const made = await cookie.req("POST", `/api/vaults/${vaults[0].id}/files`, { path: "Notes/Doc.md", title: "Doc", content: "# Doc\n\n## A\n\nbody" });
    const id = ((await made.json()) as { file: { id: string } }).file.id;
    // PAT (write) blocked by confinement
    expect((await pat.req("PATCH", `/api/files/${id}/section`, { heading: "Doc/A", content: "## A\n\nedited" })).status).toBe(403);
    // cookie session is unconfined
    expect((await cookie.req("PATCH", `/api/files/${id}/section`, { heading: "Doc/A", content: "## A\n\nedited" })).status).toBe(200);
  });

  it("allows a section edit on a Memory/ note via PAT", async () => {
    const { pat } = await writer("section-mem@example.com");
    const made = await pat.req("POST", "/api/notes", { path: "Memory/m.md", title: "M", content: "# M\n\n## A\n\nbody" });
    const id = ((await made.json()) as { fileId: string }).fileId;
    expect((await pat.req("PATCH", `/api/files/${id}/section`, { heading: "M/A", content: "## A\n\nedited" })).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run server/notes/write.test.ts`
Expected: FAIL — the non-Memory PAT edit currently returns 200 (no confinement yet).

- [ ] **Step 3: Add the confinement check to the section PATCH handler**

In `notes/routes.ts`, in the `notesRouter.patch("/files/:fileId/section", ...)` handler, immediately after the `if (!file) { ... return; }` block (the 404 ownership check) and before `const parsed = sectionPatchSchema.safeParse(...)`, insert:
```ts
  if (req.apiUser && !isMemoryPath(file.path)) {
    res.status(403).json({ error: "AI writes are confined to Memory/" });
    return;
  }
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run server/notes/write.test.ts`
Expected: PASS (10 total).

- [ ] **Step 5: Full server regression**

Run (from `landing/`): `npm test`
Expected: ALL pass (existing SP1 + new). Then `npm run typecheck:server` → clean, and `npx eslint server/notes/confinement.ts server/notes/routes.ts server/notes/sections.ts` → clean.

- [ ] **Step 6: Commit**

```bash
git add landing/server/notes/routes.ts landing/server/notes/write.test.ts
git commit -m "feat(server): confine PAT section edits to Memory/; green full suite"
```

---

# Part B — `noto-mcp` write tools

### Task 6: `notoClient` write methods

**Files:**
- Modify: `noto-mcp/src/notoClient.ts`, `noto-mcp/src/notoClient.test.ts`

- [ ] **Step 1: Add the failing tests** (append to the existing `describe` in `notoClient.test.ts`)

```ts
it("createNote POSTs to /api/notes with the body", async () => {
  const fetchImpl = fakeFetch((url, init) => {
    expect(url).toBe("https://noto.test/api/notes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ path: "Memory/x.md", title: "X" });
    return { status: 201, body: { fileId: "f1", path: "Memory/x.md" } };
  });
  const c = createNotoClient({ ...opts, fetchImpl });
  expect((await c.createNote({ path: "Memory/x.md", title: "X" })).fileId).toBe("f1");
});

it("appendNote POSTs to /api/files/:id/append", async () => {
  const fetchImpl = fakeFetch((url, init) => {
    expect(url).toBe("https://noto.test/api/files/f1/append");
    expect(JSON.parse(init.body as string)).toMatchObject({ text: "hi", underHeading: "A/B" });
    return { status: 200, body: { fileId: "f1", updatedAt: 9 } };
  });
  const c = createNotoClient({ ...opts, fetchImpl });
  expect((await c.appendNote({ fileId: "f1", text: "hi", underHeading: "A/B" })).updatedAt).toBe(9);
});

it("updateSection PATCHes /api/files/:id/section", async () => {
  const fetchImpl = fakeFetch((url, init) => {
    expect(url).toBe("https://noto.test/api/files/f1/section");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toMatchObject({ heading: "A", content: "## A\n\nx" });
    return { status: 200, body: { fileId: "f1", updatedAt: 9 } };
  });
  const c = createNotoClient({ ...opts, fetchImpl });
  expect((await c.updateSection({ fileId: "f1", heading: "A", content: "## A\n\nx" })).updatedAt).toBe(9);
});
```

- [ ] **Step 2: Run it — verify it fails**

Run (from `noto-mcp/`): `npx vitest run src/notoClient.test.ts`
Expected: FAIL — methods don't exist.

- [ ] **Step 3: Add the methods** (inside the `return { ... }` object of `createNotoClient`, after `recall`)

```ts
    createNote: (a: { path: string; title: string; content?: string }) =>
      call<{ fileId: string; path: string }>("POST", "/api/notes", a),
    appendNote: (a: { fileId: string; text: string; underHeading?: string; expectUpdatedAt?: number }) =>
      call<{ fileId: string; updatedAt: number }>("POST", `/api/files/${encodeURIComponent(a.fileId)}/append`, { text: a.text, underHeading: a.underHeading, expectUpdatedAt: a.expectUpdatedAt }),
    updateSection: (a: { fileId: string; heading: string; content: string; expectUpdatedAt?: number }) =>
      call<{ fileId: string; updatedAt: number }>("PATCH", `/api/files/${encodeURIComponent(a.fileId)}/section`, { heading: a.heading, content: a.content, expectUpdatedAt: a.expectUpdatedAt }),
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run src/notoClient.test.ts`
Expected: PASS (7 total).

- [ ] **Step 5: Commit**

```bash
git add noto-mcp/src/notoClient.ts noto-mcp/src/notoClient.test.ts
git commit -m "feat(noto-mcp): createNote/appendNote/updateSection client methods"
```

---

### Task 7: write tool handlers + registration

**Files:**
- Modify: `noto-mcp/src/tools.ts`, `noto-mcp/src/tools.test.ts`, `noto-mcp/src/index.ts`

- [ ] **Step 1: Add the failing tests** (append to `tools.test.ts`; add the methods to `fakeClient()` first)

In `fakeClient()`, add these three to the returned object:
```ts
    createNote: vi.fn(async () => ({ fileId: "f1", path: "Memory/x.md" })),
    appendNote: vi.fn(async () => ({ fileId: "f1", updatedAt: 9 })),
    updateSection: vi.fn(async () => ({ fileId: "f1", updatedAt: 9 })),
```
Then add tests:
```ts
it("create_note passes args through and returns text content", async () => {
  const client = fakeClient();
  const h = makeHandlers(client as unknown as NotoClient, { scope: "proj/x" });
  const out = await h.create_note({ path: "Memory/x.md", title: "X" });
  expect(client.createNote).toHaveBeenCalledWith({ path: "Memory/x.md", title: "X" });
  expect(JSON.parse(out.content[0].text).fileId).toBe("f1");
});

it("append_note passes args through", async () => {
  const client = fakeClient();
  const h = makeHandlers(client as unknown as NotoClient, { scope: "proj/x" });
  await h.append_note({ fileId: "f1", text: "hi" });
  expect(client.appendNote).toHaveBeenCalledWith({ fileId: "f1", text: "hi" });
});

it("update_section surfaces a client error as isError", async () => {
  const client = fakeClient();
  client.updateSection = vi.fn(async () => { throw new Error("AI writes are confined to Memory/"); });
  const h = makeHandlers(client as unknown as NotoClient, { scope: "proj/x" });
  const out = await h.update_section({ fileId: "f1", heading: "A", content: "x" });
  expect(out.isError).toBe(true);
  expect(out.content[0].text).toContain("Memory/");
});
```
(`NotoClient` is already imported in `tools.test.ts` from SP1.)

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run src/tools.test.ts`
Expected: FAIL — handlers don't exist.

- [ ] **Step 3: Add the 3 handlers** (inside the `return { ... }` of `makeHandlers`, after `recall`). Write tools do NOT inject `ctx.scope` (they are path-addressed):

```ts
    async create_note(a: { path: string; title: string; content?: string }) {
      try { return ok(await client.createNote(a)); } catch (e) { return fail(e); }
    },
    async append_note(a: { fileId: string; text: string; underHeading?: string; expectUpdatedAt?: number }) {
      try { return ok(await client.appendNote(a)); } catch (e) { return fail(e); }
    },
    async update_section(a: { fileId: string; heading: string; content: string; expectUpdatedAt?: number }) {
      try { return ok(await client.updateSection(a)); } catch (e) { return fail(e); }
    },
```

- [ ] **Step 4: Register the 3 tools in `index.ts`** (after the `recall` registration, before `server.connect`)

```ts
server.tool("create_note", "Create a note. Agent writes must live under Memory/ (e.g. 'Memory/decisions.md').",
  { path: z.string(), title: z.string(), content: z.string().optional() },
  async (a) => h.create_note(a));

server.tool("append_note", "Append text to a note (optionally under a heading). Memory/ notes only.",
  { fileId: z.string(), text: z.string(), underHeading: z.string().optional(), expectUpdatedAt: z.number().int().optional() },
  async (a) => h.append_note(a));

server.tool("update_section", "Replace one section of a Memory/ note by heading path. Prefer this over rewriting a whole note.",
  { fileId: z.string(), heading: z.string(), content: z.string(), expectUpdatedAt: z.number().int().optional() },
  async (a) => h.update_section(a));
```

- [ ] **Step 5: Run tests + typecheck + build**

Run (from `noto-mcp/`): `npx vitest run` → all pass (scope 4, notoClient 7, tools 10).
Run: `npm run typecheck` → clean. Run: `npm run build` → `dist/` produced.

- [ ] **Step 6: Commit**

```bash
git add noto-mcp/src/tools.ts noto-mcp/src/tools.test.ts noto-mcp/src/index.ts
git commit -m "feat(noto-mcp): create_note/append_note/update_section tools (9 total)"
```

---

# Part C — Client + multi-client Settings

### Task 8: `mcpConfigs` generator + `mintToken` scope

**Files:**
- Create: `landing/src/workspace/mcpConfigs.ts`, `landing/src/workspace/mcpConfigs.test.ts`
- Modify: `landing/src/workspace/mcpClient.ts`

- [ ] **Step 1: Write the failing test**

```ts
// landing/src/workspace/mcpConfigs.test.ts
import { describe, expect, it } from "vitest";
import { buildConfigs, STEERING_BODY } from "./mcpConfigs.ts";

describe("buildConfigs", () => {
  const cfg = buildConfigs({ notoUrl: "https://noto.test", token: "noto_pat_abc" });
  it("Claude Code + Cursor JSON carry url, token, and the right NOTO_CLIENT", () => {
    expect(cfg.claudeCode).toContain("https://noto.test");
    expect(cfg.claudeCode).toContain("noto_pat_abc");
    expect(cfg.claudeCode).toContain("\"claude-code\"");
    expect(cfg.cursor).toContain("\"cursor\"");
  });
  it("Codex TOML includes the server + native-memory reconciliation", () => {
    expect(cfg.codex).toContain("[mcp_servers.noto]");
    expect(cfg.codex).toContain("NOTO_CLIENT = \"codex\"");
    expect(cfg.codex).toContain("disable_on_external_context = true");
  });
  it("cursor rule has frontmatter; steering body mentions Memory/", () => {
    expect(cfg.cursorRule).toContain("alwaysApply: false");
    expect(STEERING_BODY).toContain("Memory/");
  });
  it("falls back to a placeholder token when none is given", () => {
    expect(buildConfigs({ notoUrl: "https://x", token: "" }).claudeCode).toContain("noto_pat_…");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run (from `landing/`): `npx vitest run src/workspace/mcpConfigs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// landing/src/workspace/mcpConfigs.ts
// Pure generators for per-client MCP config + steering. No IO.
export interface McpConfigInput { notoUrl: string; token: string }

export const STEERING_BODY = `## Noto shared memory (MCP server: noto)
Noto is your persistent, cross-session memory, shared across your AI tools.
- BEFORE a task that depends on prior context, decisions, or my preferences:
  call \`recall\` and \`search_notes\` (scoped to this project); fetch only the
  sections you need with \`get_section\`. Don't re-read a note whose updatedAt you have.
- AFTER a durable decision/preference/fact emerges: persist it — \`remember\` for a
  one-line fact, or write narrative into a \`Memory/\` page via \`create_note\` /
  \`append_note\` / \`update_section\`. Store durable things only; never secrets.
- NEVER write outside \`Memory/\`. Prefer \`append_note\`/\`update_section\` over rewrites.`;

function jsonConfig(notoUrl: string, token: string, client: string): string {
  return JSON.stringify(
    { mcpServers: { noto: { command: "npx", args: ["-y", "noto-mcp"], env: { NOTO_URL: notoUrl, NOTO_TOKEN: token, NOTO_CLIENT: client } } } },
    null, 2,
  );
}

export function buildConfigs({ notoUrl, token }: McpConfigInput) {
  const t = token || "noto_pat_…";
  return {
    claudeCode: jsonConfig(notoUrl, t, "claude-code"),
    cursor: jsonConfig(notoUrl, t, "cursor"),
    codex:
      `[mcp_servers.noto]\n` +
      `command = "npx"\n` +
      `args = ["-y", "noto-mcp"]\n` +
      `env = { NOTO_URL = "${notoUrl}", NOTO_TOKEN = "${t}", NOTO_CLIENT = "codex" }\n\n` +
      `[memories]\n` +
      `disable_on_external_context = true\n`,
    steering: STEERING_BODY,
    cursorRule: `---\ndescription: When to read/write Noto shared memory via MCP\nalwaysApply: false\n---\n${STEERING_BODY}`,
  };
}
```

- [ ] **Step 4: Update `mintToken` scope type** in `landing/src/workspace/mcpClient.ts`

```ts
  mintToken(name: string, scopes: ("read" | "memory" | "write")[]): Promise<{ id: string; token: string }>;
```

- [ ] **Step 5: Run it — verify it passes**

Run: `npx vitest run src/workspace/mcpConfigs.test.ts`
Expected: PASS (4). Then `npx tsc -b --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add landing/src/workspace/mcpConfigs.ts landing/src/workspace/mcpConfigs.test.ts landing/src/workspace/mcpClient.ts
git commit -m "feat(app): per-client MCP config/steering generator + write scope type"
```

---

### Task 9: Settings panel — per-client tabs + write-scoped mint

**Files:**
- Modify: `landing/src/workspace/McpSettings.tsx`

- [ ] **Step 1: Rewrite `McpSettings.tsx`** to add a client selector and use `buildConfigs`. Replace the file with:

```tsx
import { useEffect, useState } from "react";
import type { McpClient, PatInfo, MemoryInfo } from "./mcpClient";
import { buildConfigs } from "./mcpConfigs";

type ClientKind = "claude-code" | "cursor" | "codex";
const CLIENT_LABEL: Record<ClientKind, string> = { "claude-code": "Claude Code", cursor: "Cursor", codex: "Codex" };
const CONFIG_TARGET: Record<ClientKind, string> = {
  "claude-code": ".mcp.json (project)",
  cursor: ".cursor/mcp.json (project)",
  codex: "~/.codex/config.toml",
};

export function McpSettings({ client, onClose }: { client: McpClient; onClose: () => void }) {
  const [tokens, setTokens] = useState<PatInfo[]>([]);
  const [memories, setMemories] = useState<MemoryInfo[]>([]);
  const [name, setName] = useState("Claude Code");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<ClientKind>("claude-code");

  const refresh = () => {
    client.listTokens().then(setTokens).catch(() => {});
    client.listMemories().then(setMemories).catch(() => {});
  };
  useEffect(() => {
    client.listTokens().then(setTokens).catch(() => {});
    client.listMemories().then(setMemories).catch(() => {});
  }, [client]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mint = async () => {
    setBusy(true); setErr(null);
    try {
      const { token } = await client.mintToken(name.trim() || "AI tool", ["read", "memory", "write"]);
      setFresh(token);
      refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not mint token."); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setErr(null);
    try { await client.revokeToken(id); refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not revoke token."); }
  };

  const cfgs = buildConfigs({ notoUrl: client.notoUrl, token: fresh ?? "" });
  const config = kind === "claude-code" ? cfgs.claudeCode : kind === "cursor" ? cfgs.cursor : cfgs.codex;
  const steering = kind === "cursor" ? cfgs.cursorRule : cfgs.steering;
  const steeringTarget = kind === "claude-code" ? "CLAUDE.md" : kind === "cursor" ? ".cursor/rules/noto-memory.mdc" : "AGENTS.md";

  return (
    <>
      <div className="nw-menu-scrim" onClick={onClose} />
      <div className="nw-mcp-panel" role="dialog" aria-labelledby="mcp-dialog-title">
        <header className="nw-mcp-head">
          <h2 id="mcp-dialog-title">Connect AI tools (MCP)</h2>
          <button className="nw-mcp-x" onClick={onClose} aria-label="Close">×</button>
        </header>

        <section className="nw-mcp-sec">
          <h3>1 · Create a token</h3>
          <div className="nw-mcp-row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name" aria-label="Token name" />
            <button onClick={mint} disabled={busy}>Mint token</button>
          </div>
          <p className="nw-mcp-empty">Grants read + memory + write. Writes are limited to your <code>Memory/</code> folder.</p>
          {err && <p className="nw-mcp-err">{err}</p>}
          {fresh && <p className="nw-mcp-token">Copy now — shown once: <code>{fresh}</code></p>}
        </section>

        <section className="nw-mcp-sec">
          <h3>2 · Configure your tool</h3>
          <div className="nw-mcp-tabs" role="tablist">
            {(Object.keys(CLIENT_LABEL) as ClientKind[]).map((k) => (
              <button key={k} role="tab" aria-selected={kind === k}
                className={kind === k ? "nw-mcp-tab nw-mcp-tab-on" : "nw-mcp-tab"}
                onClick={() => setKind(k)}>{CLIENT_LABEL[k]}</button>
            ))}
          </div>
          <p className="nw-mcp-empty">Add to <code>{CONFIG_TARGET[kind]}</code>:</p>
          <pre className="nw-mcp-config">{config}</pre>
          <p className="nw-mcp-empty">Then add this steering to <code>{steeringTarget}</code> in your project:</p>
          <pre className="nw-mcp-config">{steering}</pre>
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
          {memories.length === 0 && <p className="nw-mcp-empty">No memories yet.</p>}
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

- [ ] **Step 2: Add tab styles** — append to `landing/src/styles/workspace.css`:

```css
.nw-mcp-tabs { display: flex; gap: 6px; margin-bottom: 8px; }
.nw-mcp-tab { background: none; border: 1px solid var(--nw-line-3); color: inherit; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
.nw-mcp-tab-on { background: rgba(127, 140, 170, 0.16); }
```

- [ ] **Step 3: Verify build + typecheck**

Run (from `landing/`): `npx tsc -b --noEmit` → clean. `npm run build` → succeeds. `npm test` → all pass (no regressions). `npx eslint src/workspace/McpSettings.tsx src/workspace/mcpConfigs.ts` → clean.

- [ ] **Step 4: Commit**

```bash
git add landing/src/workspace/McpSettings.tsx landing/src/styles/workspace.css
git commit -m "feat(app): Settings panel per-client tabs (Claude Code/Cursor/Codex) + write-scoped mint"
```

---

## Final verification (SP2 success criteria)

- [ ] **Server suite + typecheck + lint green:** from `landing/`, `npm test`, `npm run typecheck:server`, and `npx eslint server/notes/` all clean.
- [ ] **`noto-mcp` green:** from `noto-mcp/`, `npm test` (scope 4, notoClient 7, tools 10), `npm run typecheck`, `npm run build`.
- [ ] **Client green:** from `landing/`, `npx tsc -b --noEmit` + `npm run build`.
- [ ] **Confinement holds:** a `write` PAT creates/appends/edits under `Memory/` (2xx) and is **403 outside `Memory/`**; cookie sessions are unconfined.
- [ ] **9 tools, no delete:** `noto-mcp/src/index.ts` registers exactly 9 tools; no delete tool/endpoint added.
- [ ] **Live loop (manual, like SP1):** via the real `noto-mcp` server, `create_note`/`append_note` a `Memory/` page in one session, then `search_notes`/`get_section` retrieve it in a fresh session; a non-`Memory/` write returns an `isError` "confined to Memory/".
- [ ] **Multi-client config:** the Settings panel renders working Claude Code / Cursor / Codex snippets + steering, Codex incl. `disable_on_external_context`.

## Self-review notes (addressed)

- **Spec coverage:** confinement (T1, applied in T3/T4/T5) · `appendUnderHeading` (T2) · `POST /api/notes` (T3) · `POST …/append` (T4) · section confinement (T5) · 3 client methods (T6) · 3 tools + registration (T7) · `mcpConfigs` + write-scope type (T8) · per-client Settings tabs + write mint (T9). Narrative `Memory/*.md` pages = T3/T4 endpoints + T8/T9 steering (no separate storage). Codex native-memory reconciliation = T8 codex snippet. All In-scope items mapped; Out-of-scope (delete, remote HTTP, provenance UI, embeddings, writes outside Memory/) absent by construction.
- **Type consistency:** `isMemoryPath`/`MEMORY_PREFIX`, `appendUnderHeading`, `createNote`/`appendNote`/`updateSection` (client + handlers + tool names), `buildConfigs`/`STEERING_BODY`, `mintToken(...,("read"|"memory"|"write")[])` are used identically across tasks. Endpoint shapes returned (`{fileId,path}`, `{fileId,updatedAt}`) match what the client parses.
- **Reuse honored:** no new tables; `createFile`/`getOwnedFile`/`updateFile`/`writeAudit`/`sha256Hex`/`ensureDefaultVault`/`getVaultsForUser` reused with real signatures; section PATCH extended in place.
- **Known soft spots flagged inline:** SDK `tool()` signature (matches installed 1.29.0 from SP1); `tsc -b --noEmit` as the client typecheck (fall back to `npm run build` if absent).
```
