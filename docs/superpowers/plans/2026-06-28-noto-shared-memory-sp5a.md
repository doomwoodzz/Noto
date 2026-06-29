# SP5a — Semantic Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make server-side `/api/search` + `/api/memory` recall rank by MiniLM embedding similarity (with lexical fallback), so the AI tools — over stdio `noto-mcp` and the SP4 `/mcp` — retrieve by meaning, not keyword overlap.

**Architecture:** A lazy-loaded server embedder (`@huggingface/transformers` + `onnxruntime-node`, the vendored `Xenova/all-MiniLM-L6-v2`) embeds note passages (`chunkNote`) on write and memory text on `remember`, storing Float32 BLOBs in SQLite. `semantic.ts` ranks by in-JS cosine (= dot; vectors are L2-normalized) with a 0.25 floor, falling back to the existing FTS5 path when the model isn't ready. All guards (auth/ownership/confinement/audit) are untouched — `semantic.ts` only ranks.

**Tech Stack:** Express 5 + `node:sqlite`; `@huggingface/transformers ^3.8.1` (already a dep) running on `onnxruntime-node` (already resolvable); `chunkNote` reused from `src/noto-core/chunk.ts`; vitest (`node` env, `startTestServer`, `:memory:` DB).

**Spec:** `docs/superpowers/specs/2026-06-28-noto-shared-memory-sp5a-design.md`.

**Commit posture (per the handoff):** per-task local commits on `feat/noto-web-app`; pushing / PR is a final checkpoint to confirm with the user.

**Conventions:** `.ts` import extensions in `landing/`; server tests boot `createApp()` on port 0, fresh `:memory:` DB per file, unique email per test. Run server tests `npm test` (from `landing/`); server typecheck `npm run typecheck:server`; build `npm run build`; lint `npm run lint`. The vendored model lives at `landing/public/models/Xenova/all-MiniLM-L6-v2/` (present; `scripts/fetch-embedding-model.mjs` is wired as predev/prebuild).

---

## File Structure

**Server (`landing/server/`):**
- `search/vec.ts` — CREATE: `dot`/`cosine` (pure; vectors are normalized so similarity = dot).
- `search/embedder.ts` — CREATE: the `Embedder` singleton (`ready`/`embed`) + `warm()` + `setEmbedder()` test seam.
- `search/embedNote.ts` — CREATE: `reembedNote(fileId, content)` / `embedMemory(memoryId, text)` (best-effort write hooks; imports `chunkNote`).
- `search/semantic.ts` — CREATE: `semanticSearchNotes` / `semanticRecall` (cosine + 0.25 floor + lexical fallback) + `backfillEmbeddings`.
- `db.ts` — MODIFY: `note_passages` table + `memories.embedding` migration; `floatsToBlob`/`blobToFloats`; `replaceNotePassages`/`setMemoryEmbedding`; `getUserPassageVectors`/`getUserMemoryVectors`; `bumpMemoryUsage`; backfill loaders. Keep `searchFiles`/`recallMemories` as the lexical fallback.
- `search/routes.ts`, `memory/routes.ts`, `notes/routes.ts` — MODIFY: call the semantic functions + the write hooks.
- `index.ts` — MODIFY: `warm()` + `backfillEmbeddings()` on boot.

---

## Task 1: Vector storage (schema, BLOB helpers, loaders) + vec math

**Files:**
- Create: `landing/server/search/vec.ts`
- Modify: `landing/server/db.ts`
- Test: `landing/server/search/vec.test.ts`, `landing/server/db.embeddings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `landing/server/search/vec.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dot, cosine } from "./vec.ts";

describe("vec", () => {
  it("dot of identical unit vectors is 1, orthogonal is 0", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(dot(a, a)).toBeCloseTo(1);
    expect(dot(a, b)).toBeCloseTo(0);
  });
  it("cosine normalizes un-normalized inputs", () => {
    expect(cosine([2, 0], [3, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 5])).toBeCloseTo(0);
  });
});
```

Create `landing/server/db.embeddings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { floatsToBlob, blobToFloats } from "./db.ts";

describe("embedding BLOB round-trip", () => {
  it("survives floats → blob → floats", () => {
    const v = new Float32Array([0.1, -0.2, 0.333, 1, -1]);
    const back = blobToFloats(floatsToBlob(v));
    expect(Array.from(back)).toEqual(Array.from(v));
    expect(floatsToBlob(v).byteLength).toBe(v.length * 4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd landing && npx vitest run server/search/vec.test.ts server/db.embeddings.test.ts`
Expected: FAIL — modules/exports missing.

- [ ] **Step 3: Create `landing/server/search/vec.ts`**

```ts
/** Dot product (similarity for L2-normalized vectors). */
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}

/** Cosine similarity for arbitrary (possibly un-normalized) vectors. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? d / denom : 0;
}
```

- [ ] **Step 4: Extend the schema in `db.ts`**

In the main `db.exec(\`…\`)` schema block, add the `note_passages` table after the `memories` block:

```sql
  CREATE TABLE IF NOT EXISTS note_passages (
    id           TEXT PRIMARY KEY,                       -- 'fileId#index'
    file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    idx          INTEGER NOT NULL,
    heading_path TEXT NOT NULL,                          -- JSON string[]
    text         TEXT NOT NULL,
    char_start   INTEGER NOT NULL,
    embedding    BLOB
  );
  CREATE INDEX IF NOT EXISTS idx_passages_file ON note_passages(file_id);
```

After the existing SP3 `audit_log` additive-migration block, add the `memories.embedding` migration:

```ts
// Additive migration: SP5a semantic memory. Older DBs predate the embedding column.
{
  const cols = db.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "embedding")) {
    db.exec("ALTER TABLE memories ADD COLUMN embedding BLOB");
  }
}
```

Also add `embedding BLOB` to the `memories` CREATE TABLE (for fresh DBs), after `supersedes_id TEXT`.

- [ ] **Step 5: Add storage helpers + loaders in `db.ts`**

```ts
/* ----------------------------- embeddings ----------------------------- */
export function floatsToBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}
export function blobToFloats(b: Uint8Array): Float32Array {
  // Copy into an aligned buffer (sqlite BLOBs may not be 4-byte aligned).
  const copy = new Uint8Array(b.byteLength);
  copy.set(b);
  return new Float32Array(copy.buffer);
}

const stmtDeletePassages = db.prepare("DELETE FROM note_passages WHERE file_id = ?");
const stmtInsertPassage = db.prepare(
  "INSERT INTO note_passages (id, file_id, idx, heading_path, text, char_start, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
export interface PassageInput { id: string; index: number; headingPath: string[]; text: string; charStart: number }
export function replaceNotePassages(fileId: string, passages: PassageInput[], vectors: (Float32Array | null)[]): void {
  stmtDeletePassages.run(fileId);
  passages.forEach((p, i) => {
    const vec = vectors[i] ?? null;
    stmtInsertPassage.run(p.id, fileId, p.index, JSON.stringify(p.headingPath), p.text, p.charStart, vec ? floatsToBlob(vec) : null);
  });
}

const stmtSetMemoryEmbedding = db.prepare("UPDATE memories SET embedding = ? WHERE id = ?");
export function setMemoryEmbedding(memoryId: string, vec: Float32Array): void {
  stmtSetMemoryEmbedding.run(floatsToBlob(vec), memoryId);
}

export interface PassageVector { passageId: string; fileId: string; title: string; path: string; headingPath: string[]; text: string; vec: Float32Array }
const stmtUserPassages = db.prepare(
  `SELECT p.id AS passageId, p.file_id AS fileId, f.title AS title, f.path AS path,
          p.heading_path AS headingPath, p.text AS text, p.embedding AS embedding
     FROM note_passages p JOIN files f ON f.id = p.file_id JOIN vaults v ON v.id = f.vault_id
    WHERE v.user_id = ? AND p.embedding IS NOT NULL`,
);
export function getUserPassageVectors(userId: string): PassageVector[] {
  const rows = stmtUserPassages.all(userId) as unknown as Array<{ passageId: string; fileId: string; title: string; path: string; headingPath: string; text: string; embedding: Uint8Array }>;
  return rows.map((r) => ({ passageId: r.passageId, fileId: r.fileId, title: r.title, path: r.path, headingPath: JSON.parse(r.headingPath) as string[], text: r.text, vec: blobToFloats(r.embedding) }));
}

export function getUserMemoryVectors(userId: string, scopes: string[], type: string | undefined): { mem: PublicMemory; vec: Float32Array }[] {
  const scopeList = [...new Set([...scopes, "global"])];
  const ph = scopeList.map(() => "?").join(",");
  const typeClause = type ? "AND type = ?" : "";
  const sql = `SELECT * FROM memories WHERE user_id = ? AND status = 'active' AND scope IN (${ph}) ${typeClause} AND embedding IS NOT NULL`;
  const args = [userId, ...scopeList, ...(type ? [type] : [])];
  const rows = prepareCached(sql).all(...args) as unknown as (MemoryRow & { embedding: Uint8Array })[];
  return rows.map((r) => ({ mem: toPublicMemory(r), vec: blobToFloats(r.embedding) }));
}

export function bumpMemoryUsage(ids: string[]): void {
  if (!ids.length) return;
  const ph = ids.map(() => "?").join(",");
  prepareCached(`UPDATE memories SET last_used_at = ?, use_count = use_count + 1 WHERE id IN (${ph})`).run(now(), ...ids);
}

/* backfill loaders */
export function getMemoriesMissingEmbedding(limit = 1000): { id: string; text: string }[] {
  return db.prepare("SELECT id, text FROM memories WHERE embedding IS NULL AND status = 'active' LIMIT ?").all(limit) as unknown as { id: string; text: string }[];
}
export function getFileIdsMissingPassages(limit = 1000): string[] {
  return (db.prepare("SELECT f.id FROM files f WHERE f.id NOT IN (SELECT DISTINCT file_id FROM note_passages) LIMIT ?").all(limit) as Array<{ id: string }>).map((r) => r.id);
}
export function getFileContent(fileId: string): { id: string; content: string } | undefined {
  return db.prepare("SELECT id, content FROM files WHERE id = ?").get(fileId) as { id: string; content: string } | undefined;
}
```

(`PublicMemory`, `MemoryRow`, `toPublicMemory`, `prepareCached`, `now` already exist in `db.ts` — reuse them.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd landing && npx vitest run server/search/vec.test.ts server/db.embeddings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck + commit**

Run: `cd landing && npm run typecheck:server`

```bash
git add landing/server/search/vec.ts landing/server/db.ts landing/server/search/vec.test.ts landing/server/db.embeddings.test.ts
git commit -m "feat(sp5a): note_passages + memories.embedding storage, BLOB+vec helpers"
```

---

## Task 2: The server embedder (real MiniLM in Node)

**Files:**
- Create: `landing/server/search/embedder.ts`
- Test: `landing/server/search/embedder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `landing/server/search/embedder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { realEmbedder } from "./embedder.ts";
import { dot } from "./vec.ts";

describe("realEmbedder (vendored MiniLM via onnxruntime-node)", () => {
  it("embeds to 384-dim unit vectors; a paraphrase scores higher than an unrelated sentence", async () => {
    const [a, b, c] = await realEmbedder.embed([
      "the cat sat on the mat",
      "a feline rested on the rug",
      "quarterly revenue exceeded the forecast",
    ]);
    expect(a.length).toBe(384);
    expect(dot(a, a)).toBeCloseTo(1, 1);          // normalized
    expect(dot(a, b)).toBeGreaterThan(dot(a, c)); // paraphrase closer than unrelated
    expect(realEmbedder.ready()).toBe(true);
  }, 60000); // model load (~seconds) on first call
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd landing && npx vitest run server/search/embedder.test.ts`
Expected: FAIL — `./embedder.ts` not found.

- [ ] **Step 3: Implement `landing/server/search/embedder.ts`**

```ts
import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Embedder {
  ready(): boolean;
  embed(texts: string[]): Promise<Float32Array[]>;
}

// Load the vendored model from public/models (same files the client Smart Search uses); never hit the network.
const here = dirname(fileURLToPath(import.meta.url)); // .../landing/server/search
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = resolve(here, "../../public/models");

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
let extractorP: Promise<FeatureExtractionPipeline> | null = null;
let loaded = false;
function load(): Promise<FeatureExtractionPipeline> {
  if (!extractorP) {
    extractorP = pipeline("feature-extraction", MODEL_ID, { dtype: "q8" }).then((e) => { loaded = true; return e; });
  }
  return extractorP;
}

export const realEmbedder: Embedder = {
  ready: () => loaded,
  async embed(texts) {
    if (texts.length === 0) return [];
    const extractor = await load();
    const out = await extractor(texts, { pooling: "mean", normalize: true });
    const dim = out.dims[out.dims.length - 1];
    const flat = out.data as Float32Array;
    const vecs: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 1) vecs.push(flat.slice(i * dim, (i + 1) * dim));
    return vecs;
  },
};

/** Kick off the model load without awaiting (call on boot). */
export function warm(): void { void load().catch(() => {}); }

// Swappable singleton — tests inject deterministic vectors via setEmbedder().
let impl: Embedder = realEmbedder;
export function setEmbedder(e: Embedder): void { impl = e; }
export const embedder: Embedder = { ready: () => impl.ready(), embed: (t) => impl.embed(t) };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd landing && npx vitest run server/search/embedder.test.ts`
Expected: PASS (1 test, a few seconds). **If it fails to load the model**, check: the onnx file exists at `public/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx` (run `npm run fetch-embedding-model` if missing); `dtype:"q8"` matches that file. **If `onnxruntime-node` errors under vitest** (native addon), report — we may pin `test.pool: "forks"` in `vitest.config.ts`.

- [ ] **Step 5: Typecheck + commit**

Run: `cd landing && npm run typecheck:server`

```bash
git add landing/server/search/embedder.ts landing/server/search/embedder.test.ts
git commit -m "feat(sp5a): server MiniLM embedder (vendored model, onnxruntime-node, lazy + DI seam)"
```

---

## Task 3: Embed-on-write hooks + semantic ranking + route wiring

**Files:**
- Create: `landing/server/search/embedNote.ts`, `landing/server/search/semantic.ts`
- Modify: `landing/server/search/routes.ts`, `landing/server/memory/routes.ts`, `landing/server/notes/routes.ts`
- Test: `landing/server/search/semantic.test.ts`

- [ ] **Step 1: Write the failing test** (drives the full live path through `/api` with a fake embedder)

Create `landing/server/search/semantic.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";
import { setEmbedder, realEmbedder, type Embedder } from "./embedder.ts";

let srv: TestServer;
beforeAll(async () => { srv = await startTestServer(); });
afterAll(() => srv.close());
afterEach(() => setEmbedder(realEmbedder)); // restore

// Deterministic fake: each text maps to a one-hot basis vector by `topic`; same topic → dot 1, different → 0.
function fakeEmbedder(topicOf: (t: string) => number, ready = true): Embedder {
  const unit = (i: number) => { const v = new Float32Array(384); v[((i % 384) + 384) % 384] = 1; return v; };
  return { ready: () => ready, embed: async (texts) => texts.map((t) => unit(topicOf(t))) };
}

async function setup(email: string) {
  const cookie = await signup(srv.baseURL, email);
  const token = await mintToken(cookie, ["read", "write", "memory"], "S");
  return { pat: makePatClient(srv.baseURL, token) };
}

describe("semantic recall", () => {
  it("ranks by embedding similarity and applies the 0.25 floor", async () => {
    // 'deploy' family → topic 1; everything else → topic 2 (orthogonal).
    setEmbedder(fakeEmbedder((t) => (/deploy|ship|release/i.test(t) ? 1 : 2)));
    const { pat } = await setup("sem-recall@example.com");
    await pat.req("POST", "/api/memory", { text: "we ship releases on fridays", scope: "p" }); // topic 1
    await pat.req("POST", "/api/memory", { text: "the office plants need watering", scope: "p" }); // topic 2

    const r = await pat.req("GET", "/api/memory?q=deployment+cadence&scope=p"); // query → topic 1
    const { memories } = (await r.json()) as { memories: { text: string }[] };
    expect(memories.length).toBe(1);
    expect(memories[0].text).toBe("we ship releases on fridays"); // the orthogonal one is below 0.25
  });

  it("falls back to lexical FTS when the model isn't ready", async () => {
    setEmbedder({ ready: () => false, embed: async () => { throw new Error("cold"); } });
    const { pat } = await setup("sem-fallback@example.com");
    await pat.req("POST", "/api/memory", { text: "kubernetes ingress notes", scope: "p" });
    const r = await pat.req("GET", "/api/memory?q=kubernetes&scope=p"); // lexical keyword hit
    const { memories } = (await r.json()) as { memories: { text: string }[] };
    expect(memories.some((m) => m.text === "kubernetes ingress notes")).toBe(true);
  });

  it("a write still succeeds when embedding throws", async () => {
    setEmbedder({ ready: () => true, embed: async () => { throw new Error("boom"); } });
    const { pat } = await setup("sem-writeok@example.com");
    const res = await pat.req("POST", "/api/memory", { text: "survives", scope: "p" });
    expect(res.status).toBe(201);
  });
});

describe("semantic search_notes", () => {
  it("ranks note passages by similarity", async () => {
    setEmbedder(fakeEmbedder((t) => (/photosynthesis|chlorophyll|sunlight/i.test(t) ? 1 : 2)));
    const { pat } = await setup("sem-search@example.com");
    await pat.req("POST", "/api/notes", { path: "Memory/bio.md", title: "Bio", content: "# Bio\nchlorophyll captures sunlight\n" });
    await pat.req("POST", "/api/notes", { path: "Memory/hist.md", title: "Hist", content: "# Hist\nthe treaty was signed\n" });
    const r = await pat.req("GET", "/api/search?q=photosynthesis");
    const { results } = (await r.json()) as { results: { title: string }[] };
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Bio");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd landing && npx vitest run server/search/semantic.test.ts`
Expected: FAIL — semantic functions/hooks not wired (recall is still lexical bm25; the fake's ranking/floor isn't applied).

- [ ] **Step 3: Create `landing/server/search/embedNote.ts`**

```ts
import { chunkNote } from "../../src/noto-core/chunk.ts";
import { embedder } from "./embedder.ts";
import { replaceNotePassages, setMemoryEmbedding, type PassageInput } from "../db.ts";

/** Re-chunk + (best-effort) embed a note's passages and replace its note_passages rows. Never throws. */
export async function reembedNote(fileId: string, content: string): Promise<void> {
  try {
    const passages = chunkNote({ id: fileId, content });
    const inputs: PassageInput[] = passages.map((p) => ({ id: p.id, index: p.index, headingPath: p.headingPath, text: p.text, charStart: p.charStart }));
    let vectors: (Float32Array | null)[] = passages.map(() => null);
    if (passages.length > 0) {
      try { vectors = await embedder.embed(passages.map((p) => p.text)); } catch { /* leave null → lexical for this note */ }
    }
    replaceNotePassages(fileId, inputs, vectors);
  } catch { /* best-effort: never fail the write */ }
}

/** Best-effort embed of a memory's text. Never throws. */
export async function embedMemory(memoryId: string, text: string): Promise<void> {
  try { const [v] = await embedder.embed([text]); if (v) setMemoryEmbedding(memoryId, v); } catch { /* leave null */ }
}
```

**Note on the import:** `../../src/noto-core/chunk.ts` is a cross-`src` import. After this step, run `npm run typecheck:server`. **If it errors** (the server tsconfig `include:["server"]` rejects it), the fallback is to add `"src/noto-core/chunk.ts"` to `tsconfig.server.json`'s `include`; if that's unclean, relocate `chunk.ts` to `server/lib/chunk.ts` and re-point the client import. Report which you did.

- [ ] **Step 4: Create `landing/server/search/semantic.ts`**

```ts
import { embedder } from "./embedder.ts";
import { dot } from "./vec.ts";
import {
  getUserPassageVectors, getUserMemoryVectors, bumpMemoryUsage,
  searchFiles, recallMemories, type PublicMemory,
} from "../db.ts";
import { bestSnippet } from "./snippet.ts";

const FLOOR = 0.25; // mirrors the client's EMBED_SCORE_FLOOR

export interface NoteSearchResult { fileId: string; title: string; path: string; headingPath: string[]; snippet: string; score: number }

export async function semanticSearchNotes(userId: string, query: string, limit: number): Promise<NoteSearchResult[]> {
  const q = query.trim();
  if (q && embedder.ready()) {
    try {
      const rows = getUserPassageVectors(userId);
      if (rows.length > 0) {
        const [qv] = await embedder.embed([q]);
        return rows
          .map((r) => ({ r, score: dot(qv, r.vec) }))
          .filter((s) => s.score >= FLOOR)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((s) => ({ fileId: s.r.fileId, title: s.r.title, path: s.r.path, headingPath: s.r.headingPath, snippet: s.r.text.slice(0, 160), score: s.score }));
      }
    } catch { /* fall through to lexical */ }
  }
  // Lexical fallback: identical shape to the previous FTS path.
  return searchFiles(userId, q, limit).map((h) => {
    const { headingPath, snippet } = bestSnippet(h.content, q);
    return { fileId: h.fileId, title: h.title, path: h.path, headingPath, snippet, score: h.score };
  });
}

export async function semanticRecall(userId: string, scopes: string[], query: string, type: string | undefined, limit: number): Promise<(PublicMemory & { score: number })[]> {
  const q = query.trim();
  if (q && embedder.ready()) {
    try {
      const rows = getUserMemoryVectors(userId, scopes, type);
      if (rows.length > 0) {
        const [qv] = await embedder.embed([q]);
        const scored = rows
          .map((r) => ({ r, score: dot(qv, r.vec) }))
          .filter((s) => s.score >= FLOOR)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        bumpMemoryUsage(scored.map((s) => s.r.mem.id));
        return scored.map((s) => ({ ...s.r.mem, score: s.score }));
      }
    } catch { /* fall through to lexical */ }
  }
  return recallMemories(userId, scopes, query, type, limit);
}
```

- [ ] **Step 5: Add the boot backfill to `semantic.ts`**

```ts
import { getMemoriesMissingEmbedding, getFileIdsMissingPassages, getFileContent } from "../db.ts";
import { reembedNote, embedMemory } from "./embedNote.ts";

/** One-shot, best-effort: embed any content lacking vectors. Call after the model warms; never throws. */
export async function backfillEmbeddings(): Promise<void> {
  try {
    for (const m of getMemoriesMissingEmbedding()) await embedMemory(m.id, m.text);
    for (const fileId of getFileIdsMissingPassages()) {
      const f = getFileContent(fileId);
      if (f) await reembedNote(f.id, f.content);
    }
  } catch { /* best-effort */ }
}
```

- [ ] **Step 6: Wire the read routes**

In `search/routes.ts`: import `semanticSearchNotes`, drop the `searchFiles`/`bestSnippet` usage in the handler, make it async:
```ts
import { semanticSearchNotes } from "./semantic.ts";
// …in GET /search handler:
searchRouter.get("/search", limiter, async (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "read")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
  res.json({ results: await semanticSearchNotes(uid, q, limit) });
});
```
**Remove** the now-unused `searchFiles` + `bestSnippet` imports from `search/routes.ts` (they moved into `semantic.ts`) — `noUnusedLocals` will flag them otherwise; **keep** `listNoteRefs` (used by `/notes`).

In `memory/routes.ts` recall handler: import `semanticRecall`, make the handler async, replace `recallMemories(...)`:
```ts
import { semanticRecall } from "../search/semantic.ts";
// …in GET /api/memory handler, replace the final line:
  res.json({ memories: await semanticRecall(uid, scopes, q, type, limit) });
```
(make that handler `async`.) **Remove** the now-unused `recallMemories` import from `memory/routes.ts` (it moved into `semantic.ts`); keep `rememberMemory`/`listMemories`/`writeAudit`.

- [ ] **Step 7: Wire the write hooks**

In `memory/routes.ts` POST handler, after `const { memory, deduped } = rememberMemory({...});` and the existing audit block, embed when not a pure dedup-bump:
```ts
  if (!deduped) await embedMemory(memory.id, memory.text);
```
(make the POST handler `async`; import `embedMemory` from `../search/embedNote.ts`.)

In `notes/routes.ts`, import `reembedNote`, and after each note-content write call it (make those handlers `async`):
- `POST /notes` (create): after `const file = createFile(vault.id, parsed.data);` → `await reembedNote(file.id, parsed.data.content);`
- `POST /vaults/:vaultId/files`: after `const created = createFile(vault.id, parsed.data);` → `await reembedNote(created.id, parsed.data.content);` (return `created`).
- `PATCH /files/:fileId`: after `const updated = updateFile(...)`, if `parsed.data.content !== undefined` → `await reembedNote(existing.id, parsed.data.content);`
- `POST /files/:fileId/append`: after `const updated = updateFile(file.id, { content: nextContent });` → `await reembedNote(file.id, nextContent);`
- `PATCH /files/:fileId/section`: after `const updated = updateFile(file.id, { content: nextContent });` → `await reembedNote(file.id, nextContent);`

```ts
import { reembedNote } from "../search/embedNote.ts";
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd landing && npx vitest run server/search/semantic.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Typecheck + lint, then commit**

Run: `cd landing && npm run typecheck:server && npm run lint`

```bash
git add landing/server/search/embedNote.ts landing/server/search/semantic.ts landing/server/search/routes.ts landing/server/memory/routes.ts landing/server/notes/routes.ts landing/server/search/semantic.test.ts
git commit -m "feat(sp5a): semantic search_notes + recall (cosine, 0.25 floor, lexical fallback) + embed-on-write"
```

---

## Task 4: Boot warm + backfill

**Files:**
- Modify: `landing/server/index.ts`
- Test: `landing/server/search/backfill.test.ts`

- [ ] **Step 1: Write the failing test**

Create `landing/server/search/backfill.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";
import { setEmbedder, realEmbedder, type Embedder } from "./embedder.ts";
import { backfillEmbeddings } from "./semantic.ts";

let srv: TestServer;
beforeAll(async () => { srv = await startTestServer(); });
afterAll(() => srv.close());
afterEach(() => setEmbedder(realEmbedder));

const topicFake = (topicOf: (t: string) => number): Embedder => ({
  ready: () => true,
  embed: async (texts) => texts.map((t) => { const v = new Float32Array(384); v[topicOf(t) % 384] = 1; return v; }),
});

describe("backfillEmbeddings", () => {
  it("embeds memories written while the model was unavailable, making them recallable", async () => {
    // 1) write a memory while embedding throws → stored with NULL embedding.
    setEmbedder({ ready: () => false, embed: async () => { throw new Error("cold"); } });
    const cookie = await signup(srv.baseURL, "backfill@example.com");
    const token = await mintToken(cookie, ["read", "write", "memory"], "B");
    const pat = makePatClient(srv.baseURL, token);
    await pat.req("POST", "/api/memory", { text: "we use terraform for infra", scope: "p" });

    // recall is lexical-only here (no vector) — a paraphrase misses:
    const before = await (await pat.req("GET", "/api/memory?q=infrastructure-as-code&scope=p")).json() as { memories: unknown[] };
    expect(before.memories.length).toBe(0);

    // 2) model comes up; backfill embeds the orphan; the paraphrase now hits.
    setEmbedder(topicFake((t) => (/terraform|infra|infrastructure/i.test(t) ? 7 : 8)));
    await backfillEmbeddings();
    const after = await (await pat.req("GET", "/api/memory?q=infrastructure-as-code&scope=p")).json() as { memories: { text: string }[] };
    expect(after.memories.some((m) => m.text === "we use terraform for infra")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd landing && npx vitest run server/search/backfill.test.ts`
Expected: FAIL — the orphan memory stays unembedded (backfill not invoked here, but the test calls `backfillEmbeddings()` directly; it should PASS once Task 3's `backfillEmbeddings` is correct). If it already passes, that confirms backfill works; proceed to wire boot. (The new work in *this* task is the `index.ts` wiring below.)

- [ ] **Step 3: Wire warm + backfill into `index.ts`**

After the server starts listening, kick the model warm and run the backfill once the model is ready (non-blocking, never crashes boot):

```ts
import { warm } from "./search/embedder.ts";
import { backfillEmbeddings } from "./search/semantic.ts";
// …after app.listen(...) succeeds:
warm();
void (async () => {
  try { await backfillEmbeddings(); } catch { /* best-effort */ }
})();
```

(Place this in the real entrypoint only — NOT in `createApp()`/`app.ts`, so tests never load the real model. `warm()` returns immediately; the backfill awaits the lazy load internally via `embedder.embed`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd landing && npx vitest run server/search/backfill.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Typecheck + commit**

Run: `cd landing && npm run typecheck:server`

```bash
git add landing/server/index.ts landing/server/search/backfill.test.ts
git commit -m "feat(sp5a): warm the embedder + backfill missing vectors on boot"
```

---

## Task 5: Full verification + live paraphrase smoke

**Files:** none (verification only)

- [ ] **Step 1: Full suites + checks**

Run: `cd landing && npm test`
Expected: all green (prior 203 + the SP5a tests). The `embedder.test.ts` loads the real model (a few seconds).

Run: `cd landing && npm run typecheck:server && npm run lint && npm run build`
Expected: clean.

Run: `cd /Users/SV/Desktop/Noto/noto-mcp && npm test && npm run typecheck && npm run build`
Expected: 21 green (stdio unchanged; still 9 tools).

- [ ] **Step 2: Live paraphrase smoke (real model + entrypoint)**

Start the API on a temp DB + port:
```bash
cd landing
DATABASE_PATH=/tmp/noto-sp5a-smoke.sqlite PORT=8802 NODE_ENV=development \
  SESSION_SECRET=smoke-session-secret-at-least-32-chars-long APP_ORIGIN=http://localhost:5173 \
  npx tsx server/index.ts > /tmp/sp5a-smoke.log 2>&1 &
SRV=$!
curl --retry 60 --retry-delay 1 --retry-connrefused -sf http://127.0.0.1:8802/api/health > /dev/null && echo "up"
```
Then a Node smoke (`/tmp/sp5a-smoke.mjs`) that primes CSRF, signs up, mints a `read,write,memory` PAT, then:
1. `remember` "we deploy the API to Fly.io every Friday afternoon" (scope `s`).
2. `remember` "the office coffee machine is on the third floor" (scope `s`).
3. `recall` with a **paraphrase that shares no keywords** — `GET /api/memory?q=what's+our+release+cadence&scope=s` — and assert the **deploy** memory is returned and the coffee one is **not** (semantic + 0.25 floor).
4. `create_note` `Memory/photosynthesis.md` ("chlorophyll absorbs light to make sugars"), then `GET /api/search?q=how+plants+turn+sunlight+into+energy` returns it.
5. Give the model a moment after boot (warm). Print PASS/FAIL. Then `kill $SRV`.

Expected: paraphrase recall + concept search both hit. Capture the output. (This is the proof that retrieval is genuinely semantic, end-to-end, via the real model.)

- [ ] **Step 3: Update the memory file**

Update `noto-mcp-memory-layer` with SP5a status (server-side semantic retrieval shipped: vendored MiniLM via onnxruntime-node, note_passages + memories.embedding BLOBs, in-JS cosine + 0.25 floor + lexical fallback, embed-on-write + boot backfill; noto-mcp + /mcp get it free; decay/consolidation = SP5b).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "test(sp5a): full verification + live paraphrase-recall smoke"
```

---

## Self-Review notes (resolved)

- **Spec coverage:** embedder (§4) → Task 2; vectors/storage (§5) → Task 1; write hooks (§6) → Task 3; semantic ranking + lexical fallback (§7) → Task 3; backfill (§8) → Tasks 3 (fn) + 4 (boot wiring); testing (§10) → all tasks; success criteria (§11) → Task 5.
- **`chunkNote` cross-`src` import** (the spec's §3.5 / §13 unknown): isolated to `embedNote.ts` (Task 3 Step 3) with an explicit typecheck gate + a documented fallback (tsconfig include / relocate).
- **Type consistency:** `Embedder`/`setEmbedder`/`embedder` (embedder.ts) are consumed by `embedNote.ts` + `semantic.ts`; `PassageInput`/`PublicMemory`/`PassageVector` (db.ts) flow into `replaceNotePassages`/`getUserMemoryVectors`/`semantic.ts`; `semanticSearchNotes` returns the exact shape the old `search/routes.ts` produced (`{fileId,title,path,headingPath,snippet,score}`); `semanticRecall` returns `(PublicMemory & {score})[]` like `recallMemories`.
- **Guards untouched:** `semantic.ts` only ranks; every route still runs the same auth/scope/ownership/confinement/audit. `noto-mcp` + `/mcp` are not modified (still 9 tools); the client Smart Search is not touched.
- **Determinism:** all functional tests use a fake embedder (`setEmbedder`, restored in `afterEach`); only `embedder.test.ts` loads the real model (extended timeout).
