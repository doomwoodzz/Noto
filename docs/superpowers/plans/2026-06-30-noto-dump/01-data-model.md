# P0 — Data Model, Types & Provenance

> Read `00-global-constraints.md` first. This file builds the persistence layer, shared types, and the provenance marker that every later phase imports. No feature behavior yet — just the foundation, fully tested.

**Files:**
- Modify: `landing/server/db.ts` (add tables + accessors)
- Create: `landing/server/dump/types.ts`
- Create: `landing/src/noto-core/provenance.ts`
- Test: `landing/server/dump/db.test.ts`, `landing/src/noto-core/provenance.test.ts`

---

## Task 1: Migrations for the four Dump tables

**Files:** Modify `landing/server/db.ts` (add to the `CREATE TABLE IF NOT EXISTS` block, after the `note_passages` table).

- [ ] **Step 1: Write the failing test**

Create `landing/server/dump/db.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { db } from "../db.ts";

describe("dump migrations", () => {
  it("creates the four dump tables", () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toContain("dump_jobs");
    expect(names).toContain("dump_items");
    expect(names).toContain("dump_sources");
    expect(names).toContain("connector_tokens");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd landing && npx vitest run server/dump/db.test.ts`
Expected: FAIL — tables do not exist.

- [ ] **Step 3: Add the tables to `db.ts`**

In `landing/server/db.ts`, after the `note_passages` `CREATE TABLE`/index block, add:
```typescript
db.exec(`
  CREATE TABLE IF NOT EXISTS dump_jobs (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_ref  TEXT NOT NULL,
    source_slug TEXT NOT NULL,
    status      TEXT NOT NULL,
    counts      TEXT NOT NULL DEFAULT '{}',
    error       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_dump_jobs_user ON dump_jobs(user_id, created_at);

  CREATE TABLE IF NOT EXISTS dump_items (
    id              TEXT PRIMARY KEY,
    job_id          TEXT NOT NULL REFERENCES dump_jobs(id) ON DELETE CASCADE,
    source_key      TEXT NOT NULL,
    status          TEXT NOT NULL,
    redaction_count INTEGER NOT NULL DEFAULT 0,
    shaped          TEXT,
    file_id         TEXT,
    dedup_of        TEXT,
    error           TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_dump_items_job ON dump_items(job_id);

  CREATE TABLE IF NOT EXISTS dump_sources (
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_key   TEXT NOT NULL,
    file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    job_id       TEXT,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (user_id, source_key)
  );
  CREATE INDEX IF NOT EXISTS idx_dump_sources_file ON dump_sources(file_id);

  CREATE TABLE IF NOT EXISTS connector_tokens (
    id                   TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider             TEXT NOT NULL,
    external_account     TEXT,
    installation_id      TEXT,
    access_token_cipher  BLOB,
    refresh_token_cipher BLOB,
    expires_at           INTEGER,
    scopes               TEXT,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    UNIQUE (user_id, provider)
  );
  CREATE INDEX IF NOT EXISTS idx_connector_tokens_user ON connector_tokens(user_id);
`);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd landing && npx vitest run server/dump/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add landing/server/db.ts landing/server/dump/db.test.ts
git commit -m "feat(dump): add dump_jobs/dump_items/dump_sources/connector_tokens tables"
```

---

## Task 2: Shared types (`server/dump/types.ts`)

**Files:** Create `landing/server/dump/types.ts`.

- [ ] **Step 1: Write the types file**

These are the contracts named in `overview.md` plus the row/selector shapes. (Pure types — verified by typecheck, no runtime test.)
```typescript
// Shared Dump types. See docs/superpowers/plans/2026-06-30-noto-dump/overview.md.

export interface ProvenanceOrigin {
  type: "raw" | "github" | "notion";
  ref?: string;
  url?: string;
  path?: string;
  repo?: string;
}

export interface RawItem {
  sourceKey: string;
  title: string;
  body: string;
  origin: ProvenanceOrigin;
}

export interface ShapedNote {
  notePath: string;
  title: string;
  summary: string;
  tags: string[];
  links: string[];
  body: string;
  origin: ProvenanceOrigin;
}

export interface FetchCtx {
  userId: string;
  sourceRef: unknown;
  cap: number;
  onProgress: (fetched: number) => void;
}

export interface SourceProvider {
  fetch(ctx: FetchCtx): Promise<RawItem[]>;
}

export type DumpStatus =
  | "queued" | "fetching" | "shaping" | "awaiting_review" | "committing" | "done" | "failed" | "cancelled";

export type DumpItemStatus =
  | "pending" | "shaped" | "duplicate" | "update" | "selected" | "committed" | "failed" | "skipped";

export interface DumpCounts {
  fetched?: number; shaped?: number; redacted?: number;
  duplicates?: number; updates?: number; committed?: number; failed?: number;
  overCap?: number; totalAvailable?: number;
}

export interface DumpJobRow {
  id: string; user_id: string; vault_id: string;
  source_type: "raw" | "github" | "notion";
  source_ref: string; source_slug: string;
  status: DumpStatus; counts: string; error: string | null;
  created_at: number; updated_at: number;
}

export interface DumpItemRow {
  id: string; job_id: string; source_key: string;
  status: DumpItemStatus; redaction_count: number;
  shaped: string | null; file_id: string | null; dedup_of: string | null; error: string | null;
}

export interface DumpSourceRow {
  user_id: string; source_key: string; file_id: string;
  content_hash: string; job_id: string | null; created_at: number;
}

export interface ConnectorTokenRow {
  id: string; user_id: string; provider: "github" | "notion";
  external_account: string | null; installation_id: string | null;
  access_token_cipher: Uint8Array | null; refresh_token_cipher: Uint8Array | null;
  expires_at: number | null; scopes: string | null; created_at: number; updated_at: number;
}

export interface ManifestItem {
  itemId: string;
  title: string;
  summary: string;
  tags: string[];
  linkCount: number;
  notePath: string;
  redactionCount: number;
  status: "new" | "update" | "duplicate" | "skipped";
  dedupOf?: string;
}

// Public job view returned to the client by the poll endpoint.
export interface PublicDumpJob {
  id: string;
  sourceType: "raw" | "github" | "notion";
  status: DumpStatus;
  counts: DumpCounts;
  error: string | null;
  manifest?: ManifestItem[]; // present once status === "awaiting_review"
}
```

- [ ] **Step 2: Typecheck**

Run: `cd landing && npm run typecheck:server`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add landing/server/dump/types.ts
git commit -m "feat(dump): shared types (RawItem/ShapedNote/SourceProvider/job rows)"
```

---

## Task 3: DB accessors for Dump

**Files:** Modify `landing/server/db.ts` (add accessor functions + prepared statements near the other accessors); Test `landing/server/dump/db.test.ts` (extend).

- [ ] **Step 1: Write the failing tests**

Append to `landing/server/dump/db.test.ts`:
```typescript
import {
  createDumpJob, getOwnedDumpJob, setDumpJobStatus, setDumpJobCounts,
  insertDumpItem, listDumpItems, updateDumpItem,
  getDumpSource, upsertDumpSource,
  saveConnectorToken, getConnectorToken, listConnectors, deleteConnector,
  createUser, createVault,
} from "../db.ts";

describe("dump accessors", () => {
  function freshUserVault() {
    const u = createUser({ email: `dump-${crypto.randomUUID()}@t.local` });
    const v = createVault(u.id, { name: "V" });
    return { userId: u.id, vaultId: v.id };
  }

  it("creates + reads a job, scoped by owner", () => {
    const { userId, vaultId } = freshUserVault();
    const job = createDumpJob({ userId, vaultId, sourceType: "raw", sourceRef: { type: "raw" }, sourceSlug: "pasted" });
    expect(getOwnedDumpJob(userId, job.id)?.status).toBe("queued");
    expect(getOwnedDumpJob("someone-else", job.id)).toBeUndefined();
  });

  it("advances status + counts", () => {
    const { userId, vaultId } = freshUserVault();
    const job = createDumpJob({ userId, vaultId, sourceType: "raw", sourceRef: {}, sourceSlug: "p" });
    setDumpJobStatus(job.id, "shaping");
    setDumpJobCounts(job.id, { fetched: 3, shaped: 2 });
    const row = getOwnedDumpJob(userId, job.id)!;
    expect(row.status).toBe("shaping");
    expect(JSON.parse(row.counts).shaped).toBe(2);
  });

  it("inserts + lists + updates items", () => {
    const { userId, vaultId } = freshUserVault();
    const job = createDumpJob({ userId, vaultId, sourceType: "raw", sourceRef: {}, sourceSlug: "p" });
    const item = insertDumpItem({ jobId: job.id, sourceKey: "raw:abc", status: "pending" });
    updateDumpItem(item.id, { status: "shaped", shaped: JSON.stringify({ title: "X" }), redactionCount: 1 });
    const items = listDumpItems(job.id);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("shaped");
    expect(items[0].redaction_count).toBe(1);
  });

  it("upserts + reads a dump_source by (user, key)", () => {
    const { userId, vaultId } = freshUserVault();
    upsertDumpSource({ userId, sourceKey: "raw:k", fileId: "f1", contentHash: "h1", jobId: "j1" });
    expect(getDumpSource(userId, "raw:k")?.content_hash).toBe("h1");
    upsertDumpSource({ userId, sourceKey: "raw:k", fileId: "f1", contentHash: "h2", jobId: "j2" });
    expect(getDumpSource(userId, "raw:k")?.content_hash).toBe("h2");
  });

  it("saves + reads + deletes a connector token", () => {
    const { userId } = freshUserVault();
    saveConnectorToken({ userId, provider: "github", externalAccount: "octocat", installationId: "42", accessTokenCipher: null, scopes: "contents:read" });
    expect(getConnectorToken(userId, "github")?.external_account).toBe("octocat");
    expect(listConnectors(userId).map((c) => c.provider)).toContain("github");
    deleteConnector(userId, "github");
    expect(getConnectorToken(userId, "github")).toBeUndefined();
  });
});
```
(`createUser` already exists in `db.ts`; `createVault` is also exported.)

- [ ] **Step 2: Run to verify failure**

Run: `cd landing && npx vitest run server/dump/db.test.ts`
Expected: FAIL — accessors not defined.

- [ ] **Step 3: Implement the accessors in `db.ts`**

Add near the other accessor functions (import the dump types at the top of `db.ts`: `import type { DumpJobRow, DumpItemRow, DumpSourceRow, ConnectorTokenRow, DumpStatus, DumpItemStatus, DumpCounts } from "./dump/types.ts";`):
```typescript
/* ----------------------------- dump jobs ------------------------------- */
const stmtInsertDumpJob = db.prepare(
  "INSERT INTO dump_jobs (id, user_id, vault_id, source_type, source_ref, source_slug, status, counts, error, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
);
const stmtOwnedDumpJob = db.prepare("SELECT * FROM dump_jobs WHERE id = ? AND user_id = ?");
const stmtSetDumpJobStatus = db.prepare("UPDATE dump_jobs SET status = ?, updated_at = ? WHERE id = ?");
const stmtSetDumpJobStatusErr = db.prepare("UPDATE dump_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?");
const stmtSetDumpJobCounts = db.prepare("UPDATE dump_jobs SET counts = ?, updated_at = ? WHERE id = ?");
const stmtClaimableJobs = db.prepare("SELECT * FROM dump_jobs WHERE status IN ('queued','committing') ORDER BY created_at ASC LIMIT ?");

export function createDumpJob(input: { userId: string; vaultId: string; sourceType: "raw"|"github"|"notion"; sourceRef: unknown; sourceSlug: string }): DumpJobRow {
  const id = crypto.randomUUID();
  const ts = Date.now();
  stmtInsertDumpJob.run(id, input.userId, input.vaultId, input.sourceType, JSON.stringify(input.sourceRef), input.sourceSlug, "queued", "{}", null, ts, ts);
  return stmtOwnedDumpJob.get(id, input.userId) as DumpJobRow;
}
export function getOwnedDumpJob(userId: string, jobId: string): DumpJobRow | undefined {
  return stmtOwnedDumpJob.get(jobId, userId) as DumpJobRow | undefined;
}
export function setDumpJobStatus(jobId: string, status: DumpStatus, error?: string | null): void {
  if (error !== undefined) stmtSetDumpJobStatusErr.run(status, error, Date.now(), jobId);
  else stmtSetDumpJobStatus.run(status, Date.now(), jobId);
}
export function setDumpJobCounts(jobId: string, counts: DumpCounts): void {
  stmtSetDumpJobCounts.run(JSON.stringify(counts), Date.now(), jobId);
}
export function claimableDumpJobs(limit = 5): DumpJobRow[] {
  return stmtClaimableJobs.all(limit) as DumpJobRow[];
}

/* ----------------------------- dump items ------------------------------ */
const stmtInsertDumpItem = db.prepare(
  "INSERT INTO dump_items (id, job_id, source_key, status, redaction_count, shaped, file_id, dedup_of, error) VALUES (?,?,?,?,?,?,?,?,?)",
);
const stmtItemsByJob = db.prepare("SELECT * FROM dump_items WHERE job_id = ? ORDER BY rowid ASC");
const stmtItemById = db.prepare("SELECT * FROM dump_items WHERE id = ?");

export function insertDumpItem(input: { jobId: string; sourceKey: string; status: DumpItemStatus; shaped?: string|null; dedupOf?: string|null; redactionCount?: number }): DumpItemRow {
  const id = crypto.randomUUID();
  stmtInsertDumpItem.run(id, input.jobId, input.sourceKey, input.status, input.redactionCount ?? 0, input.shaped ?? null, null, input.dedupOf ?? null, null);
  return stmtItemById.get(id) as DumpItemRow;
}
export function listDumpItems(jobId: string): DumpItemRow[] {
  return stmtItemsByJob.all(jobId) as DumpItemRow[];
}
export function getDumpItem(itemId: string): DumpItemRow | undefined {
  return stmtItemById.get(itemId) as DumpItemRow | undefined;
}
export function updateDumpItem(itemId: string, patch: Partial<Pick<DumpItemRow, "status"|"shaped"|"file_id"|"dedup_of"|"error"|"redaction_count">>): void {
  const cur = stmtItemById.get(itemId) as DumpItemRow;
  db.prepare("UPDATE dump_items SET status=?, shaped=?, file_id=?, dedup_of=?, error=?, redaction_count=? WHERE id=?").run(
    patch.status ?? cur.status,
    patch.shaped !== undefined ? patch.shaped : cur.shaped,
    patch.file_id !== undefined ? patch.file_id : cur.file_id,
    patch.dedup_of !== undefined ? patch.dedup_of : cur.dedup_of,
    patch.error !== undefined ? patch.error : cur.error,
    patch.redaction_count ?? cur.redaction_count,
    itemId,
  );
}

/* ---------------------------- dump sources ----------------------------- */
const stmtGetDumpSource = db.prepare("SELECT * FROM dump_sources WHERE user_id = ? AND source_key = ?");
const stmtUpsertDumpSource = db.prepare(
  "INSERT INTO dump_sources (user_id, source_key, file_id, content_hash, job_id, created_at) VALUES (?,?,?,?,?,?) " +
  "ON CONFLICT(user_id, source_key) DO UPDATE SET file_id=excluded.file_id, content_hash=excluded.content_hash, job_id=excluded.job_id",
);
export function getDumpSource(userId: string, sourceKey: string): DumpSourceRow | undefined {
  return stmtGetDumpSource.get(userId, sourceKey) as DumpSourceRow | undefined;
}
export function upsertDumpSource(input: { userId: string; sourceKey: string; fileId: string; contentHash: string; jobId?: string|null }): void {
  stmtUpsertDumpSource.run(input.userId, input.sourceKey, input.fileId, input.contentHash, input.jobId ?? null, Date.now());
}

/* -------------------------- connector tokens --------------------------- */
const stmtGetConnector = db.prepare("SELECT * FROM connector_tokens WHERE user_id = ? AND provider = ?");
const stmtListConnectors = db.prepare("SELECT * FROM connector_tokens WHERE user_id = ? ORDER BY created_at ASC");
const stmtDeleteConnector = db.prepare("DELETE FROM connector_tokens WHERE user_id = ? AND provider = ?");
const stmtUpsertConnector = db.prepare(
  "INSERT INTO connector_tokens (id, user_id, provider, external_account, installation_id, access_token_cipher, refresh_token_cipher, expires_at, scopes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) " +
  "ON CONFLICT(user_id, provider) DO UPDATE SET external_account=excluded.external_account, installation_id=excluded.installation_id, access_token_cipher=excluded.access_token_cipher, refresh_token_cipher=excluded.refresh_token_cipher, expires_at=excluded.expires_at, scopes=excluded.scopes, updated_at=excluded.updated_at",
);
export function saveConnectorToken(input: { userId: string; provider: "github"|"notion"; externalAccount?: string|null; installationId?: string|null; accessTokenCipher?: Uint8Array|null; refreshTokenCipher?: Uint8Array|null; expiresAt?: number|null; scopes?: string|null }): void {
  const ts = Date.now();
  stmtUpsertConnector.run(crypto.randomUUID(), input.userId, input.provider, input.externalAccount ?? null, input.installationId ?? null, input.accessTokenCipher ?? null, input.refreshTokenCipher ?? null, input.expiresAt ?? null, input.scopes ?? null, ts, ts);
}
export function getConnectorToken(userId: string, provider: "github"|"notion"): ConnectorTokenRow | undefined {
  return stmtGetConnector.get(userId, provider) as ConnectorTokenRow | undefined;
}
export function listConnectors(userId: string): ConnectorTokenRow[] {
  return stmtListConnectors.all(userId) as ConnectorTokenRow[];
}
export function deleteConnector(userId: string, provider: "github"|"notion"): void {
  stmtDeleteConnector.run(userId, provider);
}
```

> Note: `node:sqlite` `BLOB` columns round-trip as `Uint8Array`. When binding a `Uint8Array` param, pass it directly. `ON CONFLICT … DO UPDATE` is supported by SQLite (the underlying engine).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd landing && npx vitest run server/dump/db.test.ts`
Expected: PASS (all accessor tests).

- [ ] **Step 5: Typecheck + commit**

```bash
cd landing && npm run typecheck:server
git add landing/server/db.ts landing/server/dump/db.test.ts
git commit -m "feat(dump): DB accessors for jobs/items/sources/connector tokens"
```

---

## Task 4: Provenance marker (`src/noto-core/provenance.ts`)

**Files:** Create `landing/src/noto-core/provenance.ts`; Test `landing/src/noto-core/provenance.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `landing/src/noto-core/provenance.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildProvenanceMarker, parseProvenanceMarker } from "./provenance.ts";

describe("provenance marker", () => {
  it("round-trips origin fields", () => {
    const m = buildProvenanceMarker({ type: "github", repo: "octo/repo", path: "docs/x.md", url: "https://github.com/octo/repo/blob/abc/docs/x.md", ref: "abc" }, 1700000000000);
    expect(m.startsWith("<!-- noto:source v=1 type=github untrusted=1")).toBe(true);
    const p = parseProvenanceMarker("# Title\n\nbody\n\n" + m);
    expect(p?.type).toBe("github");
    expect(p?.repo).toBe("octo/repo");
    expect(p?.untrusted).toBe(true);
  });

  it("escapes quotes/newlines in values", () => {
    const m = buildProvenanceMarker({ type: "raw", path: 'a "weird"\npath' }, 1);
    expect(m).not.toContain("\n<"); // single line
    expect(parseProvenanceMarker(m)?.path).toBe('a "weird" path');
  });

  it("returns null when no marker present", () => {
    expect(parseProvenanceMarker("just a normal note\n")).toBeNull();
  });

  it("only scans the tail (ignores marker-like text mid-body)", () => {
    const body = "<!-- noto:source v=1 type=raw untrusted=1 -->\n" + Array(50).fill("line").join("\n");
    expect(parseProvenanceMarker(body)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd landing && npx vitest run src/noto-core/provenance.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `provenance.ts`**

```typescript
// Provenance marker for dumped (externally-sourced, untrusted) notes.
// Appended as the LAST line of a note body. Parsed from the note tail.
import type { ProvenanceOrigin } from "../../server/dump/types.ts";

export interface ParsedProvenance extends ProvenanceOrigin {
  untrusted: boolean;
  dumpedAt?: number;
}

const FIELDS = ["type", "ref", "url", "path", "repo"] as const;

function esc(v: string): string {
  return v.replace(/"/g, "%22").replace(/[\r\n]+/g, " ");
}
function unesc(v: string): string {
  return v.replace(/%22/g, '"');
}

/** Build the single-line HTML-comment marker. `untrusted=1` is always present. */
export function buildProvenanceMarker(origin: ProvenanceOrigin, dumpedAt: number): string {
  const parts: string[] = ["v=1", `type=${origin.type}`, "untrusted=1"];
  for (const f of FIELDS) {
    if (f === "type") continue;
    const val = origin[f as keyof ProvenanceOrigin];
    if (val) parts.push(`${f}="${esc(String(val))}"`);
  }
  parts.push(`dumpedAt=${dumpedAt}`);
  return `<!-- noto:source ${parts.join(" ")} -->`;
}

/** Parse a marker from the LAST 4 lines of a note body. Returns null if absent. */
export function parseProvenanceMarker(noteBody: string): ParsedProvenance | null {
  const lines = noteBody.split(/\r\n|\r|\n/);
  const tail = lines.slice(Math.max(0, lines.length - 4));
  const line = tail.find((l) => l.trim().startsWith("<!-- noto:source "));
  if (!line) return null;
  const inner = line.trim().replace(/^<!--\s*noto:source\s*/, "").replace(/-->\s*$/, "");
  const out: ParsedProvenance = { type: "raw", untrusted: false };
  const re = /(\w+)=(?:"([^"]*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) {
    const key = m[1];
    const val = m[2] !== undefined ? unesc(m[2]) : m[3];
    if (key === "type" && (val === "raw" || val === "github" || val === "notion")) out.type = val;
    else if (key === "untrusted") out.untrusted = val === "1";
    else if (key === "dumpedAt") out.dumpedAt = Number(val);
    else if (key === "ref" || key === "url" || key === "path" || key === "repo") out[key] = val;
  }
  return out;
}
```

> The cross-package import `../../server/dump/types.ts` type-checks under `tsconfig.app.json`'s `bundler` resolution (same mechanism that lets `embedNote.ts` import `../../src/noto-core/chunk.ts`). It is a **type-only** import, erased at build.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd landing && npx vitest run src/noto-core/provenance.test.ts`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
cd landing && npm run build
git add landing/src/noto-core/provenance.ts landing/src/noto-core/provenance.test.ts
git commit -m "feat(dump): provenance marker build/parse (core)"
```

---

**P0 done when:** all four tables exist, accessors are tested green on `:memory:`, types compile, the provenance marker round-trips, and `npm run typecheck:server` + `npm run build` pass.
