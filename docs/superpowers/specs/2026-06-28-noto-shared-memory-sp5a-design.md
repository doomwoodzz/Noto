# Noto Shared Memory — SP5a Design (semantic retrieval)

**Date:** 2026-06-28
**Status:** Approved design (brainstorm complete) — ready for `superpowers:writing-plans`
**Depends on:** SP1–SP4 (implemented, committed on `feat/noto-web-app`). Companions: `…-sp1-design.md` … `…-sp4-design.md`; the client Smart Search memory `noto-smart-search`.

## 0. What SP5a is

SP1–SP4 exposed Noto as a shared memory layer (read/write tools over stdio + remote `/mcp`), ranking notes/memories with SQLite **FTS5 lexical** bm25. SP5a makes the server-side `/api/search` and `/api/memory` recall **semantic** — ranked by MiniLM embedding similarity — so the AI tools retrieve by *meaning*, not keyword overlap. It reuses the `Xenova/all-MiniLM-L6-v2` model already vendored for the client Smart Search, but runs it in Node (no browser/wasm).

This is the retrieval half of the original "SP5 — semantic memory" (decomposed during brainstorming). **SP5b** — decay scoring + semantic consolidation of the atomic store — is a follow-up that builds on SP5a's embeddings.

## 1. Scope

**In:**
- A server **embedder** (`@huggingface/transformers` in Node, vendored model, lazy-loaded, warmed on boot, DI-injectable).
- Vector storage: a `note_passages` table + a `memories.embedding` column (Float32 BLOBs).
- **Embed-on-write** hooks on every note-content mutation + `remember`.
- **Semantic ranking** for `/api/search` + `/api/memory` recall: cosine + a 0.25 relevance floor, with **lexical fallback** to the existing FTS5 path.
- A best-effort **boot backfill** for pre-existing content.

**Out (later / never):** decay scoring + consolidation/dedup → **SP5b** · the client-side Smart Search (⌘⇧F, browser) — untouched · server-initiated sentence-level highlight · hybrid/fusion ranking · re-embedding migrations beyond on-write + boot backfill · any change to the 9 tools, auth, or confinement.

## 2. Locked decisions (brainstorm, 2026-06-28)

| # | Decision | Choice |
|---|---|---|
| S5a-D1 | Vectors | **Float32 BLOB in SQLite + brute-force in-JS cosine** (= dot; MiniLM output is L2-normalized). No native extension. Sub-10ms over a user's hundreds–low-thousands of vectors. |
| S5a-D2 | Ranking | **Semantic primary, lexical fallback.** Cosine + a **0.25** relevance floor (the client's proven `EMBED_SCORE_FLOOR`); fall back to the existing FTS5 ranker when the model isn't ready or there are no embedded candidates. |
| S5a-D3 | Lifecycle | **Sync on write + lazy model.** Embed on `remember` and on note create/edit; the model lazy-loads on first use (warmed on boot), cached in RAM. Embedding errors are **swallowed** — the write still succeeds, the row is left unembedded (→ lexical for that row). |
| S5a-D4 | Model | `Xenova/all-MiniLM-L6-v2`, `dtype:"q8"`, `{pooling:"mean", normalize:true}` → 384-dim, loaded from the vendored `public/models` via `onnxruntime-node` (no wasm; `device` defaults to CPU in Node). |

## 3. Architecture

```
/api/search , /api/memory (recall)     ← hit by the SP4 /mcp bridge + stdio noto-mcp + the cookie web UI
        │
  search/semantic.ts   semanticSearchNotes() / semanticRecall()
        │  embedder.ready()? ──no──►  lexical: db.searchFiles / db.recallMemories      (UNCHANGED fallback path)
        │  yes
        ├─ embedder.embed([query]) → qVec               [search/embedder.ts — swappable singleton, DI for tests]
        ├─ db loaders return the user's {passage|memory} vectors (BLOB → Float32)
        ├─ cosine(qVec, v) per row ; drop < 0.25 ; sort desc ; top-K
        └─ hydrate snippet/headingPath (passages) | bump last_used_at/use_count (memories)

writes (remember / create-note / append / update_section / note PATCH)
        └─ reembedNote(fileId) | embedMemory(memoryId, text)        (sync, best-effort, never fails the write)
              chunkNote(content) → embedder.embed(passageTexts) → replace note_passages rows
              embedder.embed([memoryText]) → memories.embedding

boot (server/index.ts): embedder.warm()  →(async)→  backfillEmbeddings()  (embed rows missing a vector; non-blocking)
```

`semantic.ts` is the only new orchestration; it *ranks* — every read/write still flows through the same ownership-scoped queries, so all SP1–SP4 guards (auth, ownership-404, `Memory/` confinement, SP3 audit, SP4 `/mcp`) are untouched. `noto-mcp` (stdio) and `/mcp` get semantic retrieval **for free** — they call the same `/api/search` + `/api/memory`.

**Component boundaries:**
1. `search/embedder.ts` — the model. `Embedder { ready(): boolean; embed(texts: string[]): Promise<Float32Array[]> }` + `warm()` + a `setEmbedder()` test seam. One responsibility: text → normalized vectors.
2. `db.ts` — storage + loaders only: `note_passages` table, `memories.embedding`, `floatsToBlob`/`blobToFloats`, `replaceNotePassages`, `setMemoryEmbedding`, `getUserPassageVectors`, `getUserMemoryVectors`, `getFilesMissingPassages`/`getMemoriesMissingEmbedding`. Existing `searchFiles`/`recallMemories` kept as the lexical fallback.
3. `search/semantic.ts` — the ranking orchestration (embed → cosine → floor → top-K → fallback). Pure-ish over `db.ts` + an injected embedder.
4. `search/embedNote.ts` — `reembedNote(fileId)` / `embedMemory(id, text)` (chunk + embed + store), best-effort wrappers the routes call.
5. Reuse: `chunkNote` (`src/noto-core/chunk.ts`) + cosine math (`src/workspace/smartSearch/vectorMath.ts`) — both pure, no browser deps. *(The plan pins the import path: the server imports these modules directly; if `tsconfig.server.json` scoping blocks a cross-`src` import, the chunker + cosine move to a shared module both sides import.)*

## 4. The embedder (`server/search/embedder.ts`)

```ts
export interface Embedder { ready(): boolean; embed(texts: string[]): Promise<Float32Array[]> }
```
The real impl mirrors the client worker (`embedder.worker.ts`): `env.allowRemoteModels=false; env.allowLocalModels=true; env.localModelPath=<repoRoot>/public/models`; lazy `pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" })`; `embed` runs `extractor(texts, {pooling:"mean", normalize:true})` and slices the `[n,384]` output tensor into `Float32Array(384)[]`. `ready()` is true once the pipeline promise has resolved; `warm()` kicks the load without awaiting. A module-level swappable singleton (`let impl = realEmbedder; export function setEmbedder(e)`) lets tests inject deterministic vectors (vitest isolates modules per file). `embed` rejects on model/inference failure; callers catch and fall back.

## 5. Vector storage (`db.ts`)

- **`memories.embedding BLOB`** — additive migration (guarded `ALTER TABLE`, mirroring the `pinned`/SP3 precedent); null until embedded.
- **`note_passages`** (new):
  ```
  id           TEXT PRIMARY KEY            -- 'fileId#index'
  file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE
  idx          INTEGER NOT NULL
  heading_path TEXT NOT NULL               -- JSON string[]
  text         TEXT NOT NULL               -- passage text (for the snippet)
  char_start   INTEGER NOT NULL
  embedding    BLOB                         -- Float32Array(384).buffer, null until embedded
  ```
  Index on `file_id`. Ownership via `note_passages → files → vaults.user_id` (no denormalized `user_id`; a file's owner is fixed). `ON DELETE CASCADE` drops passages when a note is deleted.
- BLOB ⇄ vector: `floatsToBlob(Float32Array): Uint8Array` / `blobToFloats(Uint8Array): Float32Array` (1536 bytes per 384-vector).
- Loaders (only rows with a non-null embedding): `getUserPassageVectors(userId)` → `{passageId, fileId, title, headingPath, text, vec}[]`; `getUserMemoryVectors(userId, scopes, type?)` → `{…PublicMemory, vec}[]` (status='active', scope ∈ scopes∪global).

## 6. Embed-on-write hooks (`search/embedNote.ts`)

- `reembedNote(fileId)`: load the file (owned) → `chunkNote({id, content})` → `embedder.embed(passages.map(p=>p.text))` → `replaceNotePassages(fileId, passages, vectors)` (delete the file's rows, insert fresh). Called after **every note-content mutation**: `POST /api/notes`, `POST /api/vaults/:id/files`, `PATCH /api/files/:id` (when `content` changes), `POST /api/files/:id/append`, `PATCH /api/files/:id/section`.
- `embedMemory(memoryId, text)`: `embedder.embed([text])` → `setMemoryEmbedding(memoryId, vec)`. Called after `rememberMemory` in `POST /api/memory` (skip on a pure dedup-bump where nothing was created).
- **Best-effort:** both wrap their body in `try/catch` → log + return; an embedding/model failure never propagates to the write response. Re-embed replaces prior vectors so edits stay fresh.

## 7. Semantic ranking + fallback (`search/semantic.ts`)

- `semanticSearchNotes(userId, query, limit)`: if `embedder.ready()` → `embed([query])`, cosine vs `getUserPassageVectors(userId)`, drop `< 0.25`, sort desc, top-K → `{fileId, title, headingPath, snippet (≤160 chars of passage text), score}[]`. Else (or zero embedded candidates) → `db.searchFiles` (FTS) shaped identically. Wired into `search/routes.ts`.
- `semanticRecall(userId, scopes, query, type, limit)`: if `ready()` → `embed([query])`, cosine vs `getUserMemoryVectors(userId, scopes, type)`, drop `< 0.25`, top-K, bump `last_used_at`/`use_count` on the hits → `PublicMemory[]`. Else → `db.recallMemories` (bm25+recency). Wired into `memory/routes.ts`'s recall handler. Empty query (browse) keeps the existing recency path.
- Both `semantic.ts` and the §6 write hooks use the single swappable `embedder` singleton from §4; tests call `setEmbedder(fake)` to inject deterministic vectors (vitest isolates modules per file).

## 8. Backfill (pre-existing content)

`server/index.ts`, after `warm()` resolves, fires a non-blocking `backfillEmbeddings()` (mirrors the existing `files_fts` boot backfill at `db.ts`): embed any `memories` with a null embedding and any owned files lacking `note_passages`. Bounded by the per-user file/vault quotas; **never blocks startup**; failures degrade to lexical. Not run inside `createApp()` (so tests don't load the real model).

## 9. Safety / perf / degradation

- **Never breaks reads/writes:** any embedding/model error → lexical fallback (reads) or an unembedded row (writes). Vendored model missing (fetch failed) → everything stays lexical = today's behavior.
- **Scale:** brute-force 384-dim dot over a user's vectors (hundreds–low-thousands) is sub-10ms; the per-query model inference (~ms once warm) dominates.
- **Guards untouched:** `semantic.ts` only ranks; ownership/scope/confinement/audit all still enforced by the unchanged routes + `db.ts` queries. `noto-mcp` + `/mcp` are unmodified (still 9 tools).

## 10. Testing (TDD, existing vitest stack)

- **Embedder** (`search/embedder.test.ts`, extended timeout for model load): `cosine(embed(x),embed(x))≈1`; a paraphrase outscores an unrelated sentence; output is 384-dim and unit-norm.
- **Vectors:** `floatsToBlob`/`blobToFloats` round-trip; loaders return only embedded rows, correctly user-scoped (A can't see B's vectors).
- **`semantic.ts`** (fake embedder, deterministic vectors): ranks by cosine; the 0.25 floor trims; `ready()===false` → lexical fallback; recall scope/type filter + `last_used` bump.
- **On-write** (fake embedder): after `remember`, `memories.embedding` is non-null; after a note create/edit, its `note_passages` exist with vectors; an embedder that throws still returns a successful write.
- **Integration (`/api`, fake embedder):** `/api/search` + `/api/memory` return semantically-ranked results; with the embedder "not ready", lexical.
- **Live smoke** (real model + entrypoint): `remember` a few facts, then `recall` by a **paraphrase** with no shared keywords surfaces them; `search_notes` by concept finds the note; confirm it works over both stdio `noto-mcp` and `/mcp` with **zero** tool changes.

## 11. Success criteria

1. `recall` / `search_notes` rank by embedding similarity — a paraphrase query with no shared keywords retrieves the right memory/note — over both stdio and `/mcp`, with the 0.25 floor trimming junk.
2. Cold/failed model → graceful lexical fallback; writes never fail on embedding errors.
3. New writes embed synchronously; pre-existing content is backfilled on boot.
4. No change to the 9 tools, auth, ownership, `Memory/` confinement, SP3 trust surface, or the client Smart Search; full suite green + a live paraphrase-recall smoke passes.

## 12. File structure (proposed; writing-plans pins exact paths)

**Server — `landing/server/`:**
- `search/embedder.ts` — the `Embedder` singleton + `warm()` + `setEmbedder()`.
- `search/embedNote.ts` — `reembedNote` / `embedMemory` (best-effort write hooks).
- `search/semantic.ts` — `semanticSearchNotes` / `semanticRecall` (+ lexical fallback).
- `db.ts` — `note_passages` table + `memories.embedding` migration; `floatsToBlob`/`blobToFloats`; `replaceNotePassages`/`setMemoryEmbedding`; `getUserPassageVectors`/`getUserMemoryVectors`; backfill helpers. Keep `searchFiles`/`recallMemories` as the fallback.
- route edits: `search/routes.ts` → `semanticSearchNotes`; `memory/routes.ts` → `semanticRecall` + `embedMemory`; `notes/routes.ts` → `reembedNote` after each content mutation.
- `index.ts` — `warm()` + `backfillEmbeddings()` on boot.
- deps: confirm `onnxruntime-node` resolves (transitive via `@huggingface/transformers`); add it explicitly if not.

**Reuse:** `chunkNote` (`src/noto-core/chunk.ts`), cosine/`l2normalize` (`src/workspace/smartSearch/vectorMath.ts`), the vendored model + `scripts/fetch-embedding-model.mjs`, the 0.25 floor.

## 13. Open questions (none blocking; defaults set)

- **`note_passages.text` duplication:** stores passage text for snippets (simplest); a `char_start`-slice off the note could avoid it later (storage-only, not correctness).
- **Backfill cost on huge vaults:** a one-time async CPU cost after boot; acceptable, and bounded by quotas. Revisit batching only if it bites.
- **Shared-module path for `chunkNote`/cosine:** the plan picks direct cross-`src` import vs a relocated shared module based on `tsconfig.server.json` scoping.

Everything else is locked in §2 or deferred to SP5b per §1.
