# P3 — Knowledge-Web Connection

> Read `00-global-constraints.md` and `overview.md` first (esp. the "Cross-phase function seams"), then `03-shaping-pipeline.md` (it stages a `ShapedNote` JSON in `dump_items.shaped` and marks user-approved rows `status='selected'`). This phase replaces the P1 `commit.ts` stub with the real committer: it materializes selected `dump_items` into `files` under `Dump/<sourceSlug>/`, resolves ≤5 `[[wiki-links]]` (two-pass, against existing + sibling-dump titles), builds/updates the per-source MOC index note, embeds each note via `reembedNote`, audits every write, and idempotently overwrites on re-dump. No graph-layer change — the graph already derives edges from resolved `[[links]]` only (design spec §8). After this phase a raw dump round-trips end to end: paste → drain → manifest → commit → drain → real notes + MOC in the vault.

**Consumes:** `ShapedNote`, `DumpJobRow`, `DumpItemRow` (`server/dump/types.ts`, P0); `buildProvenanceMarker` (`src/noto-core/provenance.ts`, P0); `extractWikiLinks`, `normalizeTitle` (`src/noto-core/parser.ts`); `slugifyTitle` (`server/dump/slug.ts`, P1); `isCancelled` (`server/dump/jobs.ts`, P1); `createFile`, `updateFile`, `getOwnedFile`, `getVaultsForUser`, `pathTaken`, `countFilesForVault`, `writeAudit`, `writeSnapshot`, `sha256Hex`, `listDumpItems`, `updateDumpItem`, `setDumpJobStatus`, `setDumpJobCounts`, `getDumpSource`, `upsertDumpSource` (`server/db.ts`, P0/P1); `reembedNote` (`server/search/embedNote.ts`).

**Produces:** real `commitJob(job)` (replaces the stub) + pure `server/dump/assemble.ts` (note-body + MOC-body builders, unit-tested).

**Files:**
- Create: `landing/server/dump/assemble.ts`
- Modify: `landing/server/dump/commit.ts` (REPLACE the P1 stub body)
- Test: `landing/server/dump/assemble.test.ts`, `landing/server/dump/commit.test.ts`

---

## Task 1: Pure note-body + MOC assemblers (`server/dump/assemble.ts`)

These are **pure, deterministic** string builders — no DB, no `Date.now()`, no `Math.random()`. `dumpedAt`/`updatedAt` are passed in (Global Constraints §1). They produce the exact note-body shape from design spec §7 ("Assembled note") and the MOC shape from §8. Unit-tested in isolation.

**Files:** Create `landing/server/dump/assemble.ts`; Test `landing/server/dump/assemble.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `landing/server/dump/assemble.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { assembleNoteBody, buildMocBody, mocMembers } from "./assemble.ts";
import type { ShapedNote } from "./types.ts";
import { parseProvenanceMarker } from "../../src/noto-core/provenance.ts";

function shaped(over: Partial<ShapedNote> = {}): ShapedNote {
  return {
    notePath: "Dump/acme/Readme.md",
    title: "Readme",
    summary: "Project overview.",
    tags: ["docs", "intro"],
    links: ["Architecture", "Setup"],
    body: "First paragraph.\n\nSecond paragraph.",
    origin: { type: "github", repo: "acme/repo", path: "README.md", ref: "abc123" },
    ...over,
  };
}

describe("assembleNoteBody", () => {
  it("produces title, summary blockquote, body, Related links, marker, tags — in order", () => {
    const body = assembleNoteBody(shaped(), ["Architecture", "Setup"], 1700000000000);
    expect(body).toContain("# Readme\n\n> Project overview.\n\nFirst paragraph.");
    expect(body).toContain("## Related\n- [[Architecture]]\n- [[Setup]]");
    // marker is the LAST structural element before the tag line; provenance parses from the tail.
    const p = parseProvenanceMarker(body);
    expect(p?.type).toBe("github");
    expect(p?.repo).toBe("acme/repo");
    expect(p?.untrusted).toBe(true);
    // tags rendered as a trailing hashtag line
    expect(body.trimEnd().endsWith("#docs #intro")).toBe(true);
    // Related comes before the marker; marker before tags
    expect(body.indexOf("## Related")).toBeLessThan(body.indexOf("<!-- noto:source"));
    expect(body.indexOf("<!-- noto:source")).toBeLessThan(body.lastIndexOf("#docs"));
  });

  it("omits the summary blockquote when summary is empty", () => {
    const body = assembleNoteBody(shaped({ summary: "" }), [], 1);
    expect(body).not.toContain("\n> ");
    expect(body).toContain("# Readme\n\nFirst paragraph.");
  });

  it("omits the Related section when there are no resolved links", () => {
    const body = assembleNoteBody(shaped(), [], 1);
    expect(body).not.toContain("## Related");
  });

  it("omits the trailing tag line when there are no tags", () => {
    const body = assembleNoteBody(shaped({ tags: [] }), ["Setup"], 1);
    expect(body).not.toMatch(/#\w/);
    // still ends with the provenance marker as the last line
    expect(body.trimEnd().endsWith("-->")).toBe(true);
  });

  it("uses the RESOLVED links arg, not shaped.links (resolution happens upstream)", () => {
    // shaped.links has two candidates; only one resolved
    const body = assembleNoteBody(shaped(), ["Setup"], 1);
    expect(body).toContain("- [[Setup]]");
    expect(body).not.toContain("[[Architecture]]");
  });
});

describe("buildMocBody", () => {
  it("renders an index header with member links and a deterministic stamp", () => {
    const body = buildMocBody("acme-repo", ["Readme", "Architecture"], 1700000000000);
    expect(body.startsWith("# acme-repo — Index\n\n> Source index · 2 notes · Last updated ")).toBe(true);
    expect(body).toContain("- [[Readme]]\n- [[Architecture]]");
  });

  it("does not call Date.now — same input yields identical output", () => {
    const a = buildMocBody("s", ["A"], 42);
    const b = buildMocBody("s", ["A"], 42);
    expect(a).toBe(b);
    expect(a).toContain("· 1 notes ·");
  });
});

describe("mocMembers", () => {
  it("parses the [[links]] from an existing MOC body (order-preserving, deduped)", () => {
    const body = buildMocBody("s", ["A", "B", "A"], 1);
    expect(mocMembers(body)).toEqual(["A", "B"]);
  });

  it("returns [] for a MOC body with no links", () => {
    expect(mocMembers("# s — Index\n\n> Source index · 0 notes · Last updated x\n")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd landing && npx vitest run server/dump/assemble.test.ts`
Expected: FAIL — `Cannot find module './assemble.ts'`.

- [ ] **Step 3: Implement `assemble.ts`**

Create `landing/server/dump/assemble.ts`:
```typescript
// Pure, deterministic assemblers for Dump note bodies + per-source MOC index.
// NO Date.now()/Math.random() — timestamps are passed in (Global Constraints §1).
// Note-body shape: design spec §7 ("Assembled note"). MOC shape: §8.
import type { ShapedNote } from "./types.ts";
import { buildProvenanceMarker } from "../../src/noto-core/provenance.ts";
import { extractWikiLinks } from "../../src/noto-core/parser.ts";

/**
 * Assemble the final note body for a shaped item.
 *
 *   # <title>
 *
 *   > <summary>                 ← only when summary is non-empty
 *
 *   <verbatim cleaned body>
 *
 *   ## Related                  ← only when `links` is non-empty
 *   - [[L1]]
 *   - [[L2]]
 *
 *   <provenance marker>         ← always (last structural element)
 *   #tag1 #tag2                 ← only when tags is non-empty
 *
 * `links` is the ALREADY-RESOLVED title list (resolution is two-pass, done in
 * commit.ts) — NOT `shaped.links`. The marker is built from `shaped.origin`.
 */
export function assembleNoteBody(shaped: ShapedNote, links: string[], dumpedAt: number): string {
  const blocks: string[] = [`# ${shaped.title}`];
  const summary = shaped.summary.trim();
  if (summary) blocks.push(`> ${summary}`);
  blocks.push(shaped.body.trim());
  if (links.length > 0) {
    blocks.push(["## Related", ...links.map((l) => `- [[${l}]]`)].join("\n"));
  }
  const tail: string[] = [buildProvenanceMarker(shaped.origin, dumpedAt)];
  if (shaped.tags.length > 0) {
    tail.push(shaped.tags.map((t) => `#${t}`).join(" "));
  }
  // The marker + optional tag line form the final block, so the marker stays
  // within the last 4 lines that parseProvenanceMarker scans.
  blocks.push(tail.join("\n"));
  return blocks.join("\n\n") + "\n";
}

/**
 * Build the per-source MOC "index" note body. `updatedAt` is passed in (no
 * Date.now). Member titles render as `[[links]]`; the stamp is rendered from
 * the supplied epoch-ms so the function stays pure/deterministic.
 */
export function buildMocBody(sourceLabel: string, memberTitles: string[], updatedAt: number): string {
  const stamp = new Date(updatedAt).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
  const header =
    `# ${sourceLabel} — Index\n\n` +
    `> Source index · ${memberTitles.length} notes · Last updated ${stamp}`;
  const list = memberTitles.map((t) => `- [[${t}]]`).join("\n");
  return list ? `${header}\n\n${list}\n` : `${header}\n`;
}

/** Parse the `[[links]]` membership out of an existing MOC body (deduped, ordered). */
export function mocMembers(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const title of extractWikiLinks(body)) {
    if (!seen.has(title)) {
      seen.add(title);
      out.push(title);
    }
  }
  return out;
}
```

> `new Date(updatedAt).toISOString()` is deterministic for a fixed `updatedAt` (no implicit `Date.now()`), so `buildMocBody` stays pure. `extractWikiLinks` already trims + drops empties (`src/noto-core/parser.ts`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd landing && npx vitest run server/dump/assemble.test.ts`
Expected: PASS (all `assembleNoteBody` / `buildMocBody` / `mocMembers` cases).

- [ ] **Step 5: Typecheck + commit**

```bash
cd landing && npm run typecheck:server
git add landing/server/dump/assemble.ts landing/server/dump/assemble.test.ts
git commit -m "feat(dump): pure note-body + MOC assemblers (assemble.ts)"
```

---

## Task 2: Real `commitJob` (replace the P1 stub) — `server/dump/commit.ts`

This is the committer. It runs in the worker (no `req`): it resolves the vault, gathers `selected`/`update` items, runs **two-pass link resolution**, materializes notes via `createFile`/`updateFile`, embeds + audits each, then builds/updates the per-source MOC, and finalizes counts + status. It mirrors the note-create logic from `server/notes/routes.ts` (quota → uniqueness → `createFile` → `reembedNote` → `writeAudit`; for updates, `writeSnapshot(auditId, oldContent)` BEFORE `updateFile`) — Global Constraints §5.

**Files:** Modify `landing/server/dump/commit.ts` (REPLACE the stub); Test `landing/server/dump/commit.test.ts`.

- [ ] **Step 1: Write the failing integration test**

Create `landing/server/dump/commit.test.ts`. This drives the real raw pipeline (shaping from P2 + this committer) end to end via the worker.
```typescript
import { describe, it, expect } from "vitest";
import { startTestServer, signup } from "../test-helpers.ts";
import { drainOnce } from "./jobs.ts";
import { db } from "../db.ts";

// Two notes; note A's body references note B's title so the candidate set + the
// sibling-title pass resolve a real [[link]] between them after commit.
const RAW_TEXT = [
  "# Alpha Service",
  "",
  "The Alpha Service depends on the Beta Service for queueing. See Beta Service.",
  "",
  "# Beta Service",
  "",
  "The Beta Service is a durable queue used by other services.",
].join("\n");

async function poll(client: ReturnType<typeof makeClient>, jobId: string) {
  return (await (await client.req("GET", `/api/dump/jobs/${jobId}`)).json()) as {
    status: string;
    counts: Record<string, number>;
    manifest?: { itemId: string; title: string; notePath: string; status: string; dedupOf?: string }[];
  };
}
type makeClient = Awaited<ReturnType<typeof signup>>;

async function filesUnder(uid: string, prefix: string) {
  return db
    .prepare(
      "SELECT f.id, f.path, f.title, f.content FROM files f JOIN vaults v ON v.id=f.vault_id WHERE v.user_id=? AND f.path LIKE ? ORDER BY f.path",
    )
    .all(uid, prefix + "%") as { id: string; path: string; title: string; content: string }[];
}

describe("dump commit (raw, end-to-end)", () => {
  it("creates atomic notes under Dump/<slug>/, resolves a [[link]], builds a MOC, embeds + audits", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `c-${crypto.randomUUID()}@t.local`);
      const uid = (db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }).id;

      const create = await client.req("POST", "/api/dump", { source: { type: "raw", text: RAW_TEXT } });
      expect(create.status).toBe(201);
      const { jobId } = (await create.json()) as { jobId: string };

      await drainOnce(); // shaping
      const review = await poll(client, jobId);
      expect(review.status).toBe("awaiting_review");
      expect(review.manifest!.length).toBe(2);

      // Approve everything.
      const selectedItemIds = review.manifest!.map((m) => m.itemId);
      const commit = await client.req("POST", `/api/dump/jobs/${jobId}/commit`, { selectedItemIds });
      expect(commit.status).toBe(202);

      await drainOnce(); // committing
      const done = await poll(client, jobId);
      expect(done.status).toBe("done");
      expect(done.counts.committed).toBe(2);

      // 2 content notes + 1 MOC under Dump/<slug>/.
      const slugRow = db.prepare("SELECT source_slug FROM dump_jobs WHERE id=?").get(jobId) as { source_slug: string };
      const all = await filesUnder(uid, `Dump/${slugRow.source_slug}/`);
      const contentNotes = all.filter((f) => !f.path.endsWith(" — Index.md"));
      const moc = all.find((f) => f.path.endsWith(" — Index.md"));
      expect(contentNotes.length).toBe(2);
      expect(moc).toBeTruthy();

      // At least one content note has a resolved Related [[link]] to its sibling.
      expect(contentNotes.some((f) => /## Related\n- \[\[/.test(f.content))).toBe(true);

      // MOC lists both content notes.
      for (const f of contentNotes) expect(moc!.content).toContain(`[[${f.title}]]`);

      // Every content note body carries the untrusted provenance marker.
      for (const f of contentNotes) {
        expect(f.content).toMatch(/<!-- noto:source .*untrusted=1.*-->/);
      }

      // dump_sources rows exist for each committed file.
      for (const f of all) {
        const src = db.prepare("SELECT 1 FROM dump_sources WHERE user_id=? AND file_id=?").get(uid, f.id);
        expect(src).toBeTruthy();
      }

      // Audit: a dump:create row was written.
      const created = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE user_id=? AND tool='dump:create'").get(uid) as { n: number };
      expect(created.n).toBeGreaterThanOrEqual(3); // 2 notes + MOC
    } finally {
      srv.close();
    }
  });
});
```

> This test depends on P2's real `shapeJob` (raw provider + staging + manifest). It will only pass once P2 is merged. If you are executing strictly P3-first, gate it with `it.skip` and flip to `it` after P2 lands (note this in the commit message). The unit tests in Task 1 do not depend on P2.

- [ ] **Step 2: Run to verify it fails**

Run: `cd landing && npx vitest run server/dump/commit.test.ts`
Expected: FAIL — the stub `commitJob` sets `done` but creates no files (`contentNotes.length` is 0, no MOC, no audit rows).

- [ ] **Step 3: Implement the real `commit.ts`** (replace the entire stub file)

Replace `landing/server/dump/commit.ts` with:
```typescript
// Real committer — replaces the P1 stub. Materializes selected dump_items into
// files under Dump/<sourceSlug>/, resolves <=5 [[wiki-links]] (two-pass against
// existing + sibling-dump titles), builds/updates the per-source MOC index,
// embeds each note (reembedNote, off the request thread), and audits every write
// (dump:create / dump:update). Mirrors server/notes/routes.ts create/update logic
// (Global Constraints §5). Ownership-scoped throughout; idempotent on re-dump (§9).
import {
  db,
  createFile,
  updateFile,
  getOwnedFile,
  getVaultsForUser,
  countFilesForVault,
  pathTaken,
  writeAudit,
  writeSnapshot,
  sha256Hex,
  setDumpJobStatus,
  setDumpJobCounts,
  listDumpItems,
  updateDumpItem,
  getDumpSource,
  upsertDumpSource,
  MAX_FILES_PER_VAULT,
} from "../db.ts";
import { reembedNote } from "../search/embedNote.ts";
import { normalizeTitle } from "../../src/noto-core/parser.ts";
import { slugifyTitle } from "./slug.ts";
import { assembleNoteBody, buildMocBody, mocMembers } from "./assemble.ts";
import { isCancelled } from "./jobs.ts";
import type { DumpJobRow, DumpItemRow, ShapedNote, DumpCounts } from "./types.ts";

/** All existing note titles in a vault (lower-cased → canonical) for link resolution. */
function vaultTitleIndex(vaultId: string): Map<string, string> {
  const rows = db.prepare("SELECT title FROM files WHERE vault_id = ?").all(vaultId) as { title: string }[];
  const idx = new Map<string, string>();
  for (const r of rows) {
    const t = normalizeTitle(r.title);
    if (t) idx.set(t.toLowerCase(), t);
  }
  return idx;
}

/** Final unique vault-relative note path under Dump/<slug>/, deduped via pathTaken. */
function uniqueNotePath(vaultId: string, sourceSlug: string, title: string): string {
  const base = slugifyTitle(title);
  let candidate = `Dump/${sourceSlug}/${base}.md`;
  let n = 2;
  while (pathTaken(vaultId, candidate)) {
    candidate = `Dump/${sourceSlug}/${base} (${n}).md`;
    n += 1;
  }
  return candidate;
}

function parseShaped(item: DumpItemRow): ShapedNote | null {
  if (!item.shaped) return null;
  try {
    return JSON.parse(item.shaped) as ShapedNote;
  } catch {
    return null;
  }
}

/** Create one new note: file → audit(dump:create) → embed → dump_sources → mark committed. */
async function commitNew(
  userId: string,
  vaultId: string,
  item: DumpItemRow,
  shaped: ShapedNote,
  links: string[],
  notePath: string,
  dumpedAt: number,
  jobId: string,
): Promise<{ fileId: string; title: string }> {
  const content = assembleNoteBody(shaped, links, dumpedAt);
  const file = createFile(vaultId, { path: notePath, title: shaped.title, content });
  writeAudit({
    userId,
    tokenId: null,
    tool: "dump:create",
    target: file.id,
    beforeHash: null,
    afterHash: sha256Hex(content),
    sourceClient: "web",
  });
  await reembedNote(file.id, content);
  upsertDumpSource({ userId, sourceKey: item.source_key, fileId: file.id, contentHash: sha256Hex(content), jobId });
  updateDumpItem(item.id, { status: "committed", file_id: file.id });
  return { fileId: file.id, title: shaped.title };
}

/** Overwrite an existing note (re-dump update): snapshot → audit(dump:update) → updateFile → embed. */
async function commitUpdate(
  userId: string,
  item: DumpItemRow,
  shaped: ShapedNote,
  links: string[],
  dumpedAt: number,
  jobId: string,
): Promise<{ fileId: string; title: string } | null> {
  const old = item.dedup_of ? getOwnedFile(userId, item.dedup_of) : undefined;
  if (!old) {
    updateDumpItem(item.id, { status: "failed", error: "Target note for update no longer exists" });
    return null;
  }
  const content = assembleNoteBody(shaped, links, dumpedAt);
  const auditId = writeAudit({
    userId,
    tokenId: null,
    tool: "dump:update",
    target: old.id,
    beforeHash: sha256Hex(old.content),
    afterHash: sha256Hex(content),
    sourceClient: "web",
  });
  writeSnapshot(auditId, old.content); // BEFORE updateFile (Global Constraints §5)
  updateFile(old.id, { content });
  await reembedNote(old.id, content);
  upsertDumpSource({ userId, sourceKey: item.source_key, fileId: old.id, contentHash: sha256Hex(content), jobId });
  updateDumpItem(item.id, { status: "committed", file_id: old.id });
  return { fileId: old.id, title: shaped.title };
}

/**
 * Build or update the per-source MOC index note.
 * - source_key = `<sourceType>:<sourceId>:__index__` (Global Constraints §15).
 * - members = committed titles this job ∪ existing members from the old MOC.
 * - Rewritten ONLY when membership changed (design spec §9); created if absent.
 */
async function commitMoc(
  userId: string,
  vaultId: string,
  job: DumpJobRow,
  committedTitles: string[],
  updatedAt: number,
): Promise<void> {
  const sourceId = mocSourceId(job);
  const mocKey = `${job.source_type}:${sourceId}:__index__`;
  const existing = getDumpSource(userId, mocKey);
  const sourceLabel = job.source_slug;

  if (existing) {
    const old = getOwnedFile(userId, existing.file_id);
    if (old) {
      const prior = mocMembers(old.content);
      const merged = dedupeOrdered([...prior, ...committedTitles]);
      if (sameMembership(prior, merged)) return; // no-op churn guard (design spec §9)
      const content = buildMocBody(sourceLabel, merged, updatedAt);
      const auditId = writeAudit({
        userId,
        tokenId: null,
        tool: "dump:update",
        target: old.id,
        beforeHash: sha256Hex(old.content),
        afterHash: sha256Hex(content),
        sourceClient: "web",
      });
      writeSnapshot(auditId, old.content);
      updateFile(old.id, { content });
      await reembedNote(old.id, content);
      upsertDumpSource({ userId, sourceKey: mocKey, fileId: old.id, contentHash: sha256Hex(content), jobId: job.id });
      return;
    }
    // Mapped file vanished — fall through and recreate.
  }

  if (committedTitles.length === 0) return; // nothing to index
  const members = dedupeOrdered(committedTitles);
  const content = buildMocBody(sourceLabel, members, updatedAt);
  const path = uniqueNotePath(vaultId, job.source_slug, `${job.source_slug} — Index`);
  const file = createFile(vaultId, { path, title: `${job.source_slug} — Index`, content });
  writeAudit({
    userId,
    tokenId: null,
    tool: "dump:create",
    target: file.id,
    beforeHash: null,
    afterHash: sha256Hex(content),
    sourceClient: "web",
  });
  await reembedNote(file.id, content);
  upsertDumpSource({ userId, sourceKey: mocKey, fileId: file.id, contentHash: sha256Hex(content), jobId: job.id });
}

/** Stable per-source id for the MOC key. raw has no persistent source identity → scope to the job. */
function mocSourceId(job: DumpJobRow): string {
  if (job.source_type === "raw") return job.id;
  try {
    const ref = JSON.parse(job.source_ref) as { repo?: string; workspaceId?: string };
    if (job.source_type === "github" && ref.repo) return ref.repo;
    if (job.source_type === "notion" && ref.workspaceId) return ref.workspaceId;
  } catch {
    /* fall through */
  }
  return job.source_slug;
}

function dedupeOrdered(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of items) {
    if (x && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function sameMembership(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

/**
 * Resolve a shaped note's candidate links to real titles. A candidate resolves
 * only if it matches an EXISTING vault title OR a SIBLING-dump title (a title
 * being created in THIS job). Case-insensitive match → canonical casing.
 * Capped at 5 (design spec §8); a note never links to itself.
 */
function resolveLinks(
  shaped: ShapedNote,
  selfTitle: string,
  existing: Map<string, string>,
  siblings: Map<string, string>,
): string[] {
  const out: string[] = [];
  const used = new Set<string>([normalizeTitle(selfTitle).toLowerCase()]);
  for (const raw of shaped.links) {
    const key = normalizeTitle(raw).toLowerCase();
    if (!key || used.has(key)) continue;
    const canonical = siblings.get(key) ?? existing.get(key);
    if (canonical) {
      out.push(canonical);
      used.add(key);
      if (out.length >= 5) break;
    }
  }
  return out;
}

export async function commitJob(job: DumpJobRow): Promise<void> {
  const userId = job.user_id;

  // Resolve the vault: prefer the job's vault, fall back to the user's first.
  const vaults = getVaultsForUser(userId);
  const vaultId = vaults.some((v) => v.id === job.vault_id) ? job.vault_id : vaults[0]?.id;
  if (!vaultId) {
    setDumpJobStatus(job.id, "failed", "No vault to commit into");
    return;
  }

  // Gather user-approved items (status 'selected'; P2 also uses 'update' for the
  // re-dump-overwrite variant that the user selected).
  const selected = listDumpItems(job.id).filter((i) => i.status === "selected" || i.status === "update");
  const parsed = selected
    .map((item) => ({ item, shaped: parseShaped(item) }))
    .filter((x): x is { item: DumpItemRow; shaped: ShapedNote } => x.shaped !== null);

  // PASS 1 — compute the sibling-title set (titles created in THIS job) ∪ existing
  // vault titles, so PASS 2 can resolve cross-references deterministically.
  const existing = vaultTitleIndex(vaultId);
  const siblings = new Map<string, string>();
  for (const { shaped } of parsed) {
    const t = normalizeTitle(shaped.title);
    if (t) siblings.set(t.toLowerCase(), t);
  }

  const dumpedAt = Date.now();
  const committedTitles: string[] = [];
  let committed = 0;
  let failed = 0;

  // PASS 2 — materialize each note (new or update), resolving links against
  // existing ∪ sibling titles.
  for (const { item, shaped } of parsed) {
    if (isCancelled(job.id)) {
      setDumpJobStatus(job.id, "cancelled");
      return;
    }
    try {
      const isUpdate = item.dedup_of !== null;
      if (!isUpdate && countFilesForVault(vaultId) >= MAX_FILES_PER_VAULT) {
        updateDumpItem(item.id, { status: "failed", error: "This vault is full." });
        failed += 1;
        continue;
      }
      const links = resolveLinks(shaped, shaped.title, existing, siblings);
      let result: { fileId: string; title: string } | null;
      if (isUpdate) {
        result = await commitUpdate(userId, item, shaped, links, dumpedAt, job.id);
      } else {
        const notePath = uniqueNotePath(vaultId, job.source_slug, shaped.title);
        result = await commitNew(userId, vaultId, item, shaped, links, notePath, dumpedAt, job.id);
      }
      if (result) {
        committed += 1;
        committedTitles.push(result.title);
        // A freshly-created note becomes a valid existing-title target for later
        // notes in the same pass (keeps resolution + path dedupe consistent).
        existing.set(result.title.toLowerCase(), result.title);
      } else {
        failed += 1;
      }
    } catch (err) {
      updateDumpItem(item.id, { status: "failed", error: err instanceof Error ? err.message : String(err) });
      failed += 1;
    }
  }

  // MOC — built/updated after notes (so all members exist). Best-effort; a MOC
  // failure must not fail the whole commit.
  if (!isCancelled(job.id)) {
    try {
      await commitMoc(userId, vaultId, job, committedTitles, dumpedAt);
    } catch (err) {
      console.warn("[dump] MOC build failed:", err);
    }
  }

  const counts = mergeCounts(job, { committed, failed });
  setDumpJobCounts(job.id, counts);
  setDumpJobStatus(job.id, "done");
}

/** Preserve the counts the shaping phase set; overlay commit results. */
function mergeCounts(job: DumpJobRow, extra: Partial<DumpCounts>): DumpCounts {
  let prior: DumpCounts = {};
  try {
    prior = JSON.parse(job.counts) as DumpCounts;
  } catch {
    /* default {} */
  }
  return { ...prior, ...extra };
}
```

> **Why two-pass.** Sibling resolution must see *every* title in the job before any note is written, so note A can `[[link]]` to note B even though B is created later. PASS 1 seeds `siblings` from all parsed shaped titles; PASS 2 then resolves + writes. Newly-created titles are also folded into `existing` during PASS 2 so path-dedupe and resolution stay consistent if two siblings share a title.
> **Idempotency.** Re-dump of an unchanged item is `status='skipped'` upstream (P2 dedup), so it never reaches PASS 2. A changed item arrives as `dedup_of`-set (the user picked "overwrite" → `status='selected'` or `'update'`); `commitUpdate` snapshots + overwrites the existing `file_id` in place. The MOC is found by its stable `source_key` and rewritten only when membership grows (design spec §9).
> **`Date.now()` is allowed here** — `commit.ts` is the imperative worker, not a pure helper. The pure builders in `assemble.ts` take `dumpedAt`/`updatedAt` as args.

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `cd landing && npx vitest run server/dump/commit.test.ts`
Expected: PASS — 2 content notes + 1 MOC under `Dump/<slug>/`, a resolved `## Related` `[[link]]`, the MOC lists both, every note carries an `untrusted=1` marker, `dump_sources` rows exist, and `dump:create` audit rows are present.

> If P2 is not yet merged and you left this test as `it.skip`, run the Task 1 suite green and proceed; flip to `it` and re-run once P2 lands.

- [ ] **Step 5: Typecheck + lint the changed files + commit**

```bash
cd landing && npm run typecheck:server
npx eslint server/dump/commit.ts server/dump/assemble.ts
git add landing/server/dump/commit.ts landing/server/dump/commit.test.ts
git commit -m "feat(dump): real commitJob — create notes, resolve links, build MOC, embed, audit"
```

---

## Task 3: Idempotent re-dump (update + new + unchanged) integration test

Verifies the §9 idempotency path end to end: re-enqueue the SAME raw source with one changed note + one brand-new note → the manifest shows `update` + `new` + `duplicate` (unchanged) → commit → the changed note's file is overwritten in place (with a `dump:update` audit + snapshot), the new note is created, the MOC is updated **in place** (same file id, membership grows), and the unchanged note is **not** rewritten.

**Files:** Test — append to `landing/server/dump/commit.test.ts`.

- [ ] **Step 1: Append the failing test**

Append inside the existing `describe("dump commit (raw, end-to-end)", () => { ... })` block (it reuses the helpers defined at the top):
```typescript
  it("idempotently re-dumps: updates a changed note, adds a new note, skips an unchanged one, updates the MOC in place", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `r-${crypto.randomUUID()}@t.local`);
      const uid = (db.prepare("SELECT id FROM users ORDER BY rowid DESC LIMIT 1").get() as { id: string }).id;

      // ---- First dump: Alpha + Beta ----
      const v1 = [
        "# Alpha Service",
        "",
        "Alpha v1 body.",
        "",
        "# Beta Service",
        "",
        "Beta stays the same.",
      ].join("\n");
      const c1 = await client.req("POST", "/api/dump", { source: { type: "raw", text: v1 } });
      const { jobId: job1 } = (await c1.json()) as { jobId: string };
      await drainOnce();
      const r1 = await poll(client, job1);
      await client.req("POST", `/api/dump/jobs/${job1}/commit`, { selectedItemIds: r1.manifest!.map((m) => m.itemId) });
      await drainOnce();

      const slug = (db.prepare("SELECT source_slug FROM dump_jobs WHERE id=?").get(job1) as { source_slug: string }).source_slug;
      const before = await filesUnder(uid, `Dump/${slug}/`);
      const mocBefore = before.find((f) => f.path.endsWith(" — Index.md"))!;
      const betaBefore = before.find((f) => f.title === "Beta Service")!;
      const alphaBefore = before.find((f) => f.title === "Alpha Service")!;

      // ---- Second dump: Alpha CHANGED + Beta UNCHANGED + Gamma NEW ----
      // NOTE: raw source_key = raw:sha256(content) per ITEM body, so an unchanged
      // Beta section keeps its key+hash (duplicate), a changed Alpha keeps key but
      // new hash (update), and Gamma is brand new.
      const v2 = [
        "# Alpha Service",
        "",
        "Alpha v2 body — substantially rewritten with new detail.",
        "",
        "# Beta Service",
        "",
        "Beta stays the same.",
        "",
        "# Gamma Service",
        "",
        "Gamma is new this round.",
      ].join("\n");
      const c2 = await client.req("POST", "/api/dump", { source: { type: "raw", text: v2 } });
      const { jobId: job2 } = (await c2.json()) as { jobId: string };
      await drainOnce();
      const r2 = await poll(client, job2);

      // Manifest classification: 1 update (Alpha) + 1 new (Gamma) + 1 duplicate (Beta).
      const byTitle = new Map(r2.manifest!.map((m) => [m.title, m]));
      expect(byTitle.get("Alpha Service")!.status).toBe("update");
      expect(byTitle.get("Gamma Service")!.status).toBe("new");
      expect(byTitle.get("Beta Service")!.status).toBe("duplicate");

      // Approve the update + the new note (duplicates are not selectable).
      const toSelect = r2.manifest!.filter((m) => m.status === "update" || m.status === "new").map((m) => m.itemId);
      await client.req("POST", `/api/dump/jobs/${job2}/commit`, { selectedItemIds: toSelect });
      await drainOnce();
      const done = await poll(client, job2);
      expect(done.status).toBe("done");

      const after = await filesUnder(uid, `Dump/${slug}/`);

      // Alpha overwritten IN PLACE (same file id, content changed).
      const alphaAfter = after.find((f) => f.id === alphaBefore.id)!;
      expect(alphaAfter).toBeTruthy();
      expect(alphaAfter.content).toContain("Alpha v2 body");
      expect(alphaAfter.content).not.toContain("Alpha v1 body");

      // dump:update audit + snapshot for Alpha exist.
      const upd = db.prepare("SELECT id FROM audit_log WHERE user_id=? AND tool='dump:update' AND target=?").get(uid, alphaBefore.id) as { id: string } | undefined;
      expect(upd).toBeTruthy();
      const snap = db.prepare("SELECT 1 FROM audit_snapshots WHERE audit_id=?").get(upd!.id);
      expect(snap).toBeTruthy();

      // Beta NOT rewritten (same content as before; no update audit for it).
      const betaAfter = after.find((f) => f.id === betaBefore.id)!;
      expect(betaAfter.content).toBe(betaBefore.content);
      const betaUpd = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE tool='dump:update' AND target=?").get(betaBefore.id) as { n: number };
      expect(betaUpd.n).toBe(0);

      // Gamma created.
      const gamma = after.find((f) => f.title === "Gamma Service");
      expect(gamma).toBeTruthy();

      // MOC updated IN PLACE: same file id, membership grew to include Gamma.
      const mocAfter = after.find((f) => f.id === mocBefore.id)!;
      expect(mocAfter).toBeTruthy();
      expect(mocAfter.content).toContain("[[Gamma Service]]");
      expect(mocAfter.content).toContain("[[Alpha Service]]");
      expect(mocAfter.content).toContain("[[Beta Service]]");
      // It's still the SAME MOC note, not a duplicate.
      const mocCount = after.filter((f) => f.path.endsWith(" — Index.md")).length;
      expect(mocCount).toBe(1);
    } finally {
      srv.close();
    }
  });
```

- [ ] **Step 2: Run to verify it fails (or passes)**

Run: `cd landing && npx vitest run server/dump/commit.test.ts`
Expected (with Task 2 implemented + P2 merged): PASS. If P2's dedup/`dump_sources` wiring is incomplete, the manifest-status assertions surface the gap precisely — fix in P2, not here.

> This test asserts behavior owned jointly by P2 (dedup classification → `status`/`dedup_of`) and P3 (commit-time overwrite + MOC-in-place). The commit-side guarantees — overwrite via `commitUpdate`, MOC membership growth without duplication, no-op skip for unchanged — are P3's and are what Task 2's code delivers.

- [ ] **Step 3: Commit**

```bash
cd landing && npm run typecheck:server
git add landing/server/dump/commit.test.ts
git commit -m "test(dump): idempotent re-dump — update + new + duplicate, MOC updated in place"
```

---

## Final verification (P3)

- [ ] `cd landing && npx vitest run server/dump/assemble.test.ts` → PASS
- [ ] `cd landing && npx vitest run server/dump/commit.test.ts` → PASS
- [ ] `cd landing && npm run typecheck:server` → no errors
- [ ] `cd landing && npx eslint server/dump/assemble.ts server/dump/commit.ts` → clean (no new errors)
- [ ] `cd landing && npm run build` → exits 0

---

**P3 done when:** committing approved `dump_items` materializes atomic notes under `Dump/<sourceSlug>/`; each body is `# title` → optional `> summary` → verbatim body → optional `## Related` `[[≤5 links]]` → `<!-- noto:source … untrusted=1 -->` marker → optional `#tags` line; links resolve two-pass against existing vault titles ∪ sibling-dump titles (never self, capped at 5); a per-source MOC index note is created and idempotently updated in place (rewritten only when membership changes, found by its `<type>:<sourceId>:__index__` source_key); every committed note is embedded via `reembedNote` and audited (`dump:create` / `dump:update`, with a snapshot before each overwrite); `dump_sources` rows track `(user_id, source_key) → file_id + content_hash`; re-dump overwrites changed notes in place, adds new ones, and skips unchanged ones with no MOC churn; and `assemble.ts` stays pure (no `Date.now()`), with both unit and end-to-end integration tests green plus `typecheck:server` + `build` passing.
