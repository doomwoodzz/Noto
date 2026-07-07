# Structural + Semantic Graph Edges Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted, confidence-tagged edge layer under Noto's existing MiniLM search — structural edges (wikilinks/tags) are free, semantic edges cost one MiniLM call and are only computed for under-linked notes, both cached in SQLite so a budgeted query can read a note's neighborhood without re-embedding or re-scanning on every call.

**Architecture:** Noto here is the web app under `landing/` (React + Express + `node:sqlite`), not the Swift prototype in the repo root. A new pure module (`src/noto-core/graphEdges.ts`) defines the edge shape, the link-density gate, and the budgeted traversal — no DB, no model, fully unit-testable. Three new server modules (`server/graph/{similarity,cluster,build,query}.ts`) do the DB- and model-dependent work: reuse the existing per-passage MiniLM vectors that Smart Search already computes (`server/search/embedder.ts`, `note_passages` table) instead of embedding notes a second time, cluster with Louvain (graceful fallback to label propagation), and expose one internal query function. Two new SQLite tables (`note_graph_state`, `note_edges`) hold the content-hash cache, well-linked flag, community id, and edges. The rebuild hooks into every existing note-save path (already `await`s `reembedNote`) and into server boot alongside `backfillEmbeddings`.

**Tech Stack:** TypeScript/Node (ESM, `tsx`), `node:sqlite` (`DatabaseSync`), `@huggingface/transformers` (existing MiniLM embedder), `graphology` + `graphology-communities-louvain` (new deps, versions confirmed on npm: `0.26.0` / `2.0.2`), Vitest.

---

## Locked scope decisions (resolves the open questions from the original brief)

| Question | Answer |
|---|---|
| Note identifier scheme | `files.id` — an opaque `TEXT PRIMARY KEY` (`newId()`), scoped by `vault_id`. Not a path or slug. |
| Does a graph concept already exist? | Yes: `GraphNode`/`GraphEdge`/`KnowledgeGraph` in [`src/noto-core/types.ts`](../../../landing/src/noto-core/types.ts):36-56, built transiently by `buildGraph()` in [`graph.ts`](../../../landing/src/noto-core/graph.ts) for the live Knowledge Web UI. **This plan does not touch that code path.** It adds a separate, DB-persisted edge concept (`PersistedEdge` / `note_edges` table) carrying `relation`/`confidence`/`confidenceScore`, which the UI graph doesn't have and doesn't need (it's rebuilt from `MetadataCache` on every load). Wiring the two together (e.g. rendering semantic edges in Knowledge Web) is an explicit non-goal / follow-up, not part of this plan. |
| Where does the cache/graph live? | Nowhere as JSON. Noto is a multi-tenant server backed by SQLite (`server/db.ts`, `node:sqlite`) — the content-hash cache, well-linked flag, community id, and edges all live in two new tables (`note_graph_state`, `note_edges`), scoped by `vault_id`, in the same DB file as everything else. |
| MCP exposure timing | Land as an internal function only (`queryVaultGraph` in `server/graph/query.ts`). No new HTTP route or MCP tool in this plan — flagged as a follow-up once the internal function has real usage. |

## Non-goals (reaffirmed for this codebase)

- Does not change the on-disk note format (still Markdown + SQLite `files.content`).
- Does not modify `GraphNode`/`GraphEdge`/`buildGraph`/`filterGraph` (the live Knowledge Web graph) or the Knowledge Web UI.
- Does not remove, bypass, or change `semanticSearchNotes`/`semanticRecall` (existing MiniLM retrieval) — this sits alongside it, reusing the same embedder singleton and the same `note_passages` vectors.
- Does not add a new HTTP endpoint or MCP tool.
- Does not silently change `LINK_DENSITY_THRESHOLD` (3) or `MIN_SEMANTIC_SIMILARITY` (0.55) — they're named exported constants in `src/noto-core/graphEdges.ts`, changed only by editing that file.

## File Structure

**New files:**
- `landing/src/noto-core/graphEdges.ts` — pure: edge types, `LINK_DENSITY_THRESHOLD`, `isWellLinked`, `buildStructuralEdges`, `MIN_SEMANTIC_SIMILARITY`, `TOP_K_SEMANTIC`, `budgetedQuery`.
- `landing/src/noto-core/graphEdges.test.ts` — unit tests for the above.
- `landing/server/graph/similarity.ts` — `meanPool`, `computeSemanticEdges` (reuses `note_passages` vectors + `embedder`).
- `landing/server/graph/similarity.test.ts`
- `landing/server/graph/cluster.ts` — `assignCommunities` (Louvain + label-propagation fallback).
- `landing/server/graph/cluster.test.ts`
- `landing/server/graph/build.ts` — `rebuildVaultGraph`, `rebuildStaleVaultGraphs` (orchestration + content-hash cache).
- `landing/server/graph/build.test.ts`
- `landing/server/graph/query.ts` — `queryVaultGraph` (the budgeted internal query).
- `landing/server/graph/query.test.ts`
- `landing/server/notes/routes.graph.test.ts` — integration test that saving a note wires the graph layer end to end.
- `landing/scripts/benchmark-graph-edges.mts` — MiniLM call-count/token benchmark, before vs. after.

**Modified files:**
- `landing/server/db.ts` — two new tables (`note_graph_state`, `note_edges`) + accessor functions.
- `landing/server/notes/routes.ts` — 5 call sites, each gets one line after its existing `await reembedNote(...)`.
- `landing/server/dump/commit.ts` — 4 call sites, same pattern.
- `landing/server/index.ts` — boot-time `rebuildStaleVaultGraphs()` alongside the existing `backfillEmbeddings()`.
- `landing/package.json` — add `graphology`, `graphology-communities-louvain`.

---

### Task 1: Pure structural-edge + budgeted-query module

**Files:**
- Create: `landing/src/noto-core/graphEdges.ts`
- Test: `landing/src/noto-core/graphEdges.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// landing/src/noto-core/graphEdges.test.ts
import { describe, expect, it } from "vitest";
import { buildMetadataCache } from "./metadata";
import type { VaultFile } from "./types";
import {
  isWellLinked,
  buildStructuralEdges,
  budgetedQuery,
  LINK_DENSITY_THRESHOLD,
} from "./graphEdges";

function file(id: string, content: string): VaultFile {
  return { id, path: `${id}.md`, title: id, content, pinned: false, createdAt: 0, updatedAt: 0 };
}

describe("isWellLinked", () => {
  it("is false with zero links/tags", () => {
    const cache = buildMetadataCache([file("a", "no links here")]);
    expect(isWellLinked(cache.filesById.a)).toBe(false);
  });

  it("is false one below the threshold", () => {
    const cache = buildMetadataCache([file("a", "[[b]] #x"), file("b", "")]);
    expect(cache.filesById.a.outgoingLinks.length + cache.filesById.a.tags.length).toBe(2);
    expect(isWellLinked(cache.filesById.a)).toBe(false);
  });

  it("is true exactly at the threshold", () => {
    const cache = buildMetadataCache([file("a", "[[b]] [[c]] #x"), file("b", ""), file("c", "")]);
    expect(cache.filesById.a.outgoingLinks.length + cache.filesById.a.tags.length).toBe(LINK_DENSITY_THRESHOLD);
    expect(isWellLinked(cache.filesById.a)).toBe(true);
  });

  it("is true well above the threshold", () => {
    const cache = buildMetadataCache([file("a", "[[b]] [[c]] [[d]] #x #y"), file("b", ""), file("c", ""), file("d", "")]);
    expect(isWellLinked(cache.filesById.a)).toBe(true);
  });
});

describe("buildStructuralEdges", () => {
  it("emits an EXTRACTED links_to edge for a resolved wikilink", () => {
    const files = [file("a", "See [[B]]."), file("b", "B note")];
    const cache = buildMetadataCache(files);
    const edges = buildStructuralEdges(files[0], cache);
    expect(edges).toContainEqual({
      id: "a->b:links_to",
      sourceId: "a",
      targetId: "b",
      relation: "links_to",
      confidence: "EXTRACTED",
      confidenceScore: 1,
    });
  });

  it("skips an unresolved wikilink (no matching title)", () => {
    const files = [file("a", "See [[Nowhere]].")];
    const cache = buildMetadataCache(files);
    const edges = buildStructuralEdges(files[0], cache);
    expect(edges.some((e) => e.relation === "links_to")).toBe(false);
  });

  it("emits a tagged_with edge pointing at a synthetic tag node", () => {
    const files = [file("a", "Some #biology content.")];
    const cache = buildMetadataCache(files);
    const edges = buildStructuralEdges(files[0], cache);
    expect(edges).toContainEqual({
      id: "a->tag:biology:tagged_with",
      sourceId: "a",
      targetId: "tag:biology",
      relation: "tagged_with",
      confidence: "EXTRACTED",
      confidenceScore: 1,
    });
  });

  it("returns an empty list for a file missing from the cache", () => {
    const files = [file("a", "hi")];
    const cache = buildMetadataCache(files);
    expect(buildStructuralEdges(file("ghost", "x"), cache)).toEqual([]);
  });
});

describe("budgetedQuery", () => {
  const edges = [
    { id: "a->b:links_to", sourceId: "a", targetId: "b", relation: "links_to" as const, confidence: "EXTRACTED" as const, confidenceScore: 1 },
    { id: "a->c:sim", sourceId: "a", targetId: "c", relation: "semantically_similar_to" as const, confidence: "INFERRED" as const, confidenceScore: 0.9 },
    { id: "b->d:links_to", sourceId: "b", targetId: "d", relation: "links_to" as const, confidence: "EXTRACTED" as const, confidenceScore: 1 },
  ];

  it("prefers EXTRACTED edges over higher-scored INFERRED ones under a tight budget", () => {
    const result = budgetedQuery(edges, "a", 2); // room for `a` + one more
    expect(result.nodeIds).toEqual(["a", "b"]);
    expect(result.edges).toEqual([edges[0]]);
  });

  it("keeps expanding breadth-first until the budget is exhausted", () => {
    const result = budgetedQuery(edges, "a", 4);
    expect(new Set(result.nodeIds)).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("returns just the start node when it has no edges", () => {
    const result = budgetedQuery(edges, "isolated", 10);
    expect(result).toEqual({ nodeIds: ["isolated"], edges: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd landing && npx vitest run src/noto-core/graphEdges.test.ts`
Expected: FAIL — `Cannot find module './graphEdges'`

- [ ] **Step 3: Implement `graphEdges.ts`**

```typescript
// landing/src/noto-core/graphEdges.ts
// Structural + semantic edge model shared by the graph rebuild (server/graph/*)
// and the budgeted query. Structural edges are free (already-parsed wikilinks
// and tags); semantic edges cost a MiniLM call and are computed server-side —
// this module only owns the shared edge shape, the link-density gate, and the
// traversal, so both producers speak the same language.
import type { FileMetadata, MetadataCache, VaultFile } from "./types";

export type EdgeRelation = "links_to" | "tagged_with" | "semantically_similar_to";
export type EdgeConfidence = "EXTRACTED" | "INFERRED";

export interface PersistedEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: EdgeRelation;
  confidence: EdgeConfidence;
  confidenceScore: number;
}

/** A note with 3+ explicit links/tags doesn't need a MiniLM call to place it in the graph. */
export const LINK_DENSITY_THRESHOLD = 3;

/** Below this cosine similarity, a semantic edge isn't worth storing. */
export const MIN_SEMANTIC_SIMILARITY = 0.55;

/** Max semantic neighbors kept per under-linked note. */
export const TOP_K_SEMANTIC = 5;

export function isWellLinked(meta: FileMetadata): boolean {
  return meta.outgoingLinks.length + meta.tags.length >= LINK_DENSITY_THRESHOLD;
}

/** Build EXTRACTED edges (links_to + tagged_with) for one file from the metadata cache. */
export function buildStructuralEdges(file: VaultFile, cache: MetadataCache): PersistedEdge[] {
  const meta = cache.filesById[file.id];
  if (!meta) return [];
  const edges: PersistedEdge[] = [];
  for (const targetTitle of meta.outgoingLinks) {
    const targetId = cache.fileIdByTitle[targetTitle];
    if (targetId === undefined || targetId === file.id) continue;
    edges.push({
      id: `${file.id}->${targetId}:links_to`,
      sourceId: file.id,
      targetId,
      relation: "links_to",
      confidence: "EXTRACTED",
      confidenceScore: 1,
    });
  }
  for (const tag of meta.tags) {
    edges.push({
      id: `${file.id}->tag:${tag}:tagged_with`,
      sourceId: file.id,
      targetId: `tag:${tag}`,
      relation: "tagged_with",
      confidence: "EXTRACTED",
      confidenceScore: 1,
    });
  }
  return edges;
}

export interface GraphQueryResult {
  nodeIds: string[];
  edges: PersistedEdge[];
}

function pushTo(byNode: Map<string, PersistedEdge[]>, node: string, edge: PersistedEdge): void {
  const list = byNode.get(node);
  if (list) list.push(edge);
  else byNode.set(node, [edge]);
}

/**
 * BFS from `startId` over `edges` (treated as undirected), expanding EXTRACTED
 * edges before INFERRED ones (ties broken by confidenceScore desc), capped at
 * `budget` visited nodes.
 */
export function budgetedQuery(edges: PersistedEdge[], startId: string, budget: number): GraphQueryResult {
  const byNode = new Map<string, PersistedEdge[]>();
  for (const e of edges) {
    pushTo(byNode, e.sourceId, e);
    if (e.targetId !== e.sourceId) pushTo(byNode, e.targetId, e);
  }

  const visited = new Set<string>([startId]);
  const frontier: string[] = [startId];
  const resultEdges: PersistedEdge[] = [];
  const seenEdgeIds = new Set<string>();

  while (frontier.length > 0 && visited.size < budget) {
    const current = frontier.shift()!;
    const neighbors = [...(byNode.get(current) ?? [])].sort((a, b) => {
      if (a.confidence !== b.confidence) return a.confidence === "EXTRACTED" ? -1 : 1;
      return b.confidenceScore - a.confidenceScore;
    });
    for (const edge of neighbors) {
      if (visited.size >= budget) break;
      const other = edge.sourceId === current ? edge.targetId : edge.sourceId;
      if (!seenEdgeIds.has(edge.id)) {
        seenEdgeIds.add(edge.id);
        resultEdges.push(edge);
      }
      if (!visited.has(other)) {
        visited.add(other);
        frontier.push(other);
      }
    }
  }
  return { nodeIds: [...visited], edges: resultEdges };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd landing && npx vitest run src/noto-core/graphEdges.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add landing/src/noto-core/graphEdges.ts landing/src/noto-core/graphEdges.test.ts
git commit -m "feat(graph): add structural edge extraction + budgeted query traversal"
```

---

### Task 2: `note_graph_state` + `note_edges` tables and accessors

**Files:**
- Modify: `landing/server/db.ts`
- Test: Create `landing/server/db.graph-edges.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// landing/server/db.graph-edges.test.ts
import { describe, it, expect } from "vitest";
import {
  createUser, createVault, createFile,
  upsertNoteGraphState, getNoteGraphState, setNoteCommunities,
  replaceFileEdges, getVaultEdges, getStaleGraphVaultIds,
} from "./db.ts";

function freshVault() {
  const u = createUser({ email: `graph-${crypto.randomUUID()}@t.local` });
  const v = createVault(u.id, { name: "V" });
  return { userId: u.id, vaultId: v.id };
}

describe("note_graph_state", () => {
  it("upserts and reads back content hash + well-linked flag", () => {
    const { vaultId } = freshVault();
    const file = createFile(vaultId, { path: "a.md", title: "A", content: "hi" });
    upsertNoteGraphState({ fileId: file.id, vaultId, contentHash: "h1", wellLinked: false });
    expect(getNoteGraphState(file.id)).toMatchObject({ fileId: file.id, contentHash: "h1", wellLinked: false, community: null });
    upsertNoteGraphState({ fileId: file.id, vaultId, contentHash: "h2", wellLinked: true });
    expect(getNoteGraphState(file.id)).toMatchObject({ contentHash: "h2", wellLinked: true });
  });

  it("assigns communities by file id", () => {
    const { vaultId } = freshVault();
    const file = createFile(vaultId, { path: "b.md", title: "B", content: "hi" });
    upsertNoteGraphState({ fileId: file.id, vaultId, contentHash: "h1", wellLinked: false });
    setNoteCommunities(new Map([[file.id, 3]]));
    expect(getNoteGraphState(file.id)?.community).toBe(3);
  });
});

describe("note_edges", () => {
  it("replaces a file's outgoing edges idempotently", () => {
    const { vaultId } = freshVault();
    const a = createFile(vaultId, { path: "a.md", title: "A", content: "hi" });
    const b = createFile(vaultId, { path: "b.md", title: "B", content: "hi" });
    replaceFileEdges(vaultId, a.id, [
      { id: `${a.id}->${b.id}:links_to`, sourceId: a.id, targetId: b.id, relation: "links_to", confidence: "EXTRACTED", confidenceScore: 1 },
    ]);
    expect(getVaultEdges(vaultId)).toHaveLength(1);
    replaceFileEdges(vaultId, a.id, []); // re-run with no edges clears the old ones
    expect(getVaultEdges(vaultId)).toHaveLength(0);
  });
});

describe("getStaleGraphVaultIds", () => {
  it("flags a vault with a file that has no graph state yet", () => {
    const { vaultId } = freshVault();
    createFile(vaultId, { path: "c.md", title: "C", content: "hi" });
    expect(getStaleGraphVaultIds()).toContain(vaultId);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd landing && npx vitest run server/db.graph-edges.test.ts`
Expected: FAIL — `upsertNoteGraphState is not a function` (etc.)

- [ ] **Step 3: Add the tables**

Edit `landing/server/db.ts`. Find this exact block (currently lines 133-143):

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

Replace with (adds the two new tables right after it):

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

  CREATE TABLE IF NOT EXISTS note_graph_state (
    file_id       TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    vault_id      TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    content_hash  TEXT NOT NULL,
    well_linked   INTEGER NOT NULL,
    community     INTEGER,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_graph_state_vault ON note_graph_state(vault_id);

  -- source_id/target_id have no FK: target_id may be a synthetic 'tag:<name>'
  -- node that has no row in `files` (tagged_with edges point at tags, not notes).
  CREATE TABLE IF NOT EXISTS note_edges (
    id                TEXT PRIMARY KEY,
    vault_id          TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    source_id         TEXT NOT NULL,
    target_id         TEXT NOT NULL,
    relation          TEXT NOT NULL,
    confidence        TEXT NOT NULL,
    confidence_score  REAL NOT NULL,
    updated_at        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_note_edges_vault ON note_edges(vault_id);
  CREATE INDEX IF NOT EXISTS idx_note_edges_source ON note_edges(vault_id, source_id);
```

- [ ] **Step 4: Add the accessor functions**

Add this import to the top of `landing/server/db.ts` (alongside the existing `import type { DumpJobRow, ... } from "./dump/types.ts";` line):

```typescript
import type { PersistedEdge } from "../src/noto-core/graphEdges.ts";
```

Add these functions after `getFileContent` (right after the block ending at current line 1275, before the `/* ----------------------------- AI response cache ----------------------------- */` comment):

```typescript
/* ----------------------------- graph edges ----------------------------- */

export interface NoteGraphStateRow {
  fileId: string;
  vaultId: string;
  contentHash: string;
  wellLinked: boolean;
  community: number | null;
  updatedAt: number;
}

const stmtGetGraphState = db.prepare(
  "SELECT file_id AS fileId, vault_id AS vaultId, content_hash AS contentHash, well_linked AS wellLinked, community, updated_at AS updatedAt FROM note_graph_state WHERE file_id = ?",
);
export function getNoteGraphState(fileId: string): NoteGraphStateRow | undefined {
  const row = stmtGetGraphState.get(fileId) as (Omit<NoteGraphStateRow, "wellLinked"> & { wellLinked: number }) | undefined;
  return row ? { ...row, wellLinked: Boolean(row.wellLinked) } : undefined;
}

const stmtUpsertGraphState = db.prepare(
  `INSERT INTO note_graph_state (file_id, vault_id, content_hash, well_linked, community, updated_at)
   VALUES (?, ?, ?, ?, NULL, ?)
   ON CONFLICT(file_id) DO UPDATE SET
     content_hash = excluded.content_hash,
     well_linked  = excluded.well_linked,
     updated_at   = excluded.updated_at`,
);
export function upsertNoteGraphState(input: { fileId: string; vaultId: string; contentHash: string; wellLinked: boolean }): void {
  stmtUpsertGraphState.run(input.fileId, input.vaultId, input.contentHash, input.wellLinked ? 1 : 0, Date.now());
}

const stmtSetCommunity = db.prepare("UPDATE note_graph_state SET community = ? WHERE file_id = ?");
export function setNoteCommunities(communities: Map<string, number>): void {
  db.exec("BEGIN");
  try {
    for (const [fileId, community] of communities) stmtSetCommunity.run(community, fileId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const stmtDeleteFileEdges = db.prepare("DELETE FROM note_edges WHERE source_id = ?");
const stmtInsertEdge = db.prepare(
  `INSERT INTO note_edges (id, vault_id, source_id, target_id, relation, confidence, confidence_score, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
/** Replace every edge sourced FROM `fileId` (its structural + semantic outgoing edges). Transactional. */
export function replaceFileEdges(vaultId: string, fileId: string, edges: PersistedEdge[]): void {
  db.exec("BEGIN");
  try {
    stmtDeleteFileEdges.run(fileId);
    const ts = Date.now();
    for (const e of edges) {
      stmtInsertEdge.run(e.id, vaultId, e.sourceId, e.targetId, e.relation, e.confidence, e.confidenceScore, ts);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const stmtVaultEdges = db.prepare(
  "SELECT id, source_id AS sourceId, target_id AS targetId, relation, confidence, confidence_score AS confidenceScore FROM note_edges WHERE vault_id = ?",
);
export function getVaultEdges(vaultId: string): PersistedEdge[] {
  return stmtVaultEdges.all(vaultId) as unknown as PersistedEdge[];
}

const stmtStaleGraphVaults = db.prepare(
  `SELECT DISTINCT f.vault_id AS vaultId FROM files f
   LEFT JOIN note_graph_state g ON g.file_id = f.id
   WHERE g.file_id IS NULL OR g.updated_at < f.updated_at
   LIMIT ?`,
);
export function getStaleGraphVaultIds(limit = 500): string[] {
  return (stmtStaleGraphVaults.all(limit) as Array<{ vaultId: string }>).map((r) => r.vaultId);
}

const stmtVaultPassageVectors = db.prepare(
  `SELECT p.file_id AS fileId, p.embedding AS embedding
   FROM note_passages p JOIN files f ON f.id = p.file_id
   WHERE f.vault_id = ? AND p.embedding IS NOT NULL`,
);
export function getVaultPassageVectors(vaultId: string): { fileId: string; vec: Float32Array }[] {
  const rows = stmtVaultPassageVectors.all(vaultId) as Array<{ fileId: string; embedding: Uint8Array }>;
  return rows.map((r) => ({ fileId: r.fileId, vec: blobToFloats(r.embedding) }));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd landing && npx vitest run server/db.graph-edges.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add landing/server/db.ts landing/server/db.graph-edges.test.ts
git commit -m "feat(graph): add note_graph_state + note_edges tables and accessors"
```

---

### Task 3: Semantic-edge computation (reuses existing MiniLM vectors)

**Files:**
- Create: `landing/server/graph/similarity.ts`
- Test: `landing/server/graph/similarity.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// landing/server/graph/similarity.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { createUser, createVault, createFile, replaceNotePassages } from "../db.ts";
import { setEmbedder, realEmbedder, type Embedder } from "../search/embedder.ts";
import { computeSemanticEdges, meanPool } from "./similarity.ts";

afterEach(() => setEmbedder(realEmbedder));

function freshVault(): string {
  const u = createUser({ email: `sim-${crypto.randomUUID()}@t.local` });
  return createVault(u.id, { name: "V" }).id;
}

function unit(dim: number, hot: number): Float32Array {
  const v = new Float32Array(dim);
  v[hot] = 1;
  return v;
}

describe("meanPool", () => {
  it("averages and renormalizes a set of identical unit vectors", () => {
    const pooled = meanPool([unit(4, 0), unit(4, 0)]);
    expect(Array.from(pooled)).toEqual([1, 0, 0, 0]);
  });
});

describe("computeSemanticEdges", () => {
  it("links an under-linked note to its nearest neighbor by reusing existing passage vectors", async () => {
    const vaultId = freshVault();
    const near = createFile(vaultId, { path: "near.md", title: "Near", content: "x" });
    const far = createFile(vaultId, { path: "far.md", title: "Far", content: "y" });
    const under = createFile(vaultId, { path: "under.md", title: "Under", content: "z" });

    replaceNotePassages(near.id, [{ id: `${near.id}#0`, index: 0, headingPath: [], text: "near", charStart: 0 }], [unit(4, 0)]);
    replaceNotePassages(far.id, [{ id: `${far.id}#0`, index: 0, headingPath: [], text: "far", charStart: 0 }], [unit(4, 2)]);
    replaceNotePassages(under.id, [{ id: `${under.id}#0`, index: 0, headingPath: [], text: "under", charStart: 0 }], [unit(4, 0)]);

    setEmbedder({ ready: () => true, embed: async () => { throw new Error("should not embed — vectors already indexed"); } });

    const edges = await computeSemanticEdges(vaultId, [{ fileId: under.id, content: "z" }]);
    expect(edges).toEqual([
      { id: `${under.id}->${near.id}:semantically_similar_to`, sourceId: under.id, targetId: near.id, relation: "semantically_similar_to", confidence: "INFERRED", confidenceScore: 1 },
    ]);
  });

  it("falls back to a fresh embed() call for a note with no indexed passages yet", async () => {
    const vaultId = freshVault();
    const near = createFile(vaultId, { path: "near2.md", title: "Near2", content: "x" });
    const under = createFile(vaultId, { path: "under2.md", title: "Under2", content: "z" });
    replaceNotePassages(near.id, [{ id: `${near.id}#0`, index: 0, headingPath: [], text: "near", charStart: 0 }], [unit(4, 0)]);

    const fake: Embedder = { ready: () => true, embed: async (texts) => texts.map(() => unit(4, 0)) };
    setEmbedder(fake);

    const edges = await computeSemanticEdges(vaultId, [{ fileId: under.id, content: "brand new note, never chunked" }]);
    expect(edges.map((e) => e.targetId)).toEqual([near.id]);
  });

  it("returns nothing when the embedder isn't ready", async () => {
    setEmbedder({ ready: () => false, embed: async () => { throw new Error("must not be called"); } });
    const edges = await computeSemanticEdges("any-vault", [{ fileId: "x", content: "z" }]);
    expect(edges).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd landing && npx vitest run server/graph/similarity.test.ts`
Expected: FAIL — `Cannot find module './similarity.ts'`

- [ ] **Step 3: Implement `similarity.ts`**

```typescript
// landing/server/graph/similarity.ts
import { cosine } from "../search/vec.ts";
import { embedder } from "../search/embedder.ts";
import { getVaultPassageVectors } from "../db.ts";
import { MIN_SEMANTIC_SIMILARITY, TOP_K_SEMANTIC, type PersistedEdge } from "../../src/noto-core/graphEdges.ts";

function pushTo(map: Map<string, Float32Array[]>, key: string, value: Float32Array): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Mean-pool a note's (already L2-normalized) passage vectors into one note-level vector, renormalized. */
export function meanPool(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) throw new Error("meanPool: at least one vector required");
  const dim = vectors[0].length;
  const sum = new Float32Array(dim);
  for (const v of vectors) for (let i = 0; i < dim; i += 1) sum[i] += v[i];
  let norm = 0;
  for (let i = 0; i < dim; i += 1) { sum[i] /= vectors.length; norm += sum[i] * sum[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i += 1) sum[i] /= norm;
  return sum;
}

export interface NoteCandidate {
  fileId: string;
  content: string;
}

/**
 * Compute `semantically_similar_to` edges FROM each under-linked note. Reuses
 * the passage vectors Smart Search already computed (getVaultPassageVectors)
 * — only a note with zero indexed passages gets a fresh embedder.embed() call.
 */
export async function computeSemanticEdges(vaultId: string, underLinked: NoteCandidate[]): Promise<PersistedEdge[]> {
  if (underLinked.length === 0 || !embedder.ready()) return [];

  const byFile = new Map<string, Float32Array[]>();
  for (const row of getVaultPassageVectors(vaultId)) pushTo(byFile, row.fileId, row.vec);

  const noteVectors = new Map<string, Float32Array>();
  for (const [fileId, vecs] of byFile) noteVectors.set(fileId, meanPool(vecs));

  const missing = underLinked.filter((n) => !noteVectors.has(n.fileId));
  if (missing.length > 0) {
    const fresh = await embedder.embed(missing.map((n) => n.content));
    missing.forEach((n, i) => noteVectors.set(n.fileId, fresh[i]));
  }

  const edges: PersistedEdge[] = [];
  for (const note of underLinked) {
    const qvec = noteVectors.get(note.fileId);
    if (!qvec) continue;
    const scored = [...noteVectors.entries()]
      .filter(([id]) => id !== note.fileId)
      .map(([id, vec]) => ({ id, score: cosine(qvec, vec) }))
      .filter((s) => s.score >= MIN_SEMANTIC_SIMILARITY)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K_SEMANTIC);
    for (const { id: targetId, score } of scored) {
      edges.push({
        id: `${note.fileId}->${targetId}:semantically_similar_to`,
        sourceId: note.fileId,
        targetId,
        relation: "semantically_similar_to",
        confidence: "INFERRED",
        confidenceScore: Math.round(score * 1000) / 1000,
      });
    }
  }
  return edges;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd landing && npx vitest run server/graph/similarity.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add landing/server/graph/similarity.ts landing/server/graph/similarity.test.ts
git commit -m "feat(graph): compute semantic edges from existing passage vectors"
```

---

### Task 4: Clustering (Louvain + graceful fallback)

**Files:**
- Modify: `landing/package.json`
- Create: `landing/server/graph/cluster.ts`
- Test: `landing/server/graph/cluster.test.ts`

- [ ] **Step 1: Add the dependencies**

```bash
cd landing && npm install graphology@^0.26.0 graphology-communities-louvain@^2.0.2
```

Expected: `package.json` dependencies gain both packages; `package-lock.json` updates.

- [ ] **Step 2: Write the failing tests**

```typescript
// landing/server/graph/cluster.test.ts
import { describe, it, expect } from "vitest";
import { assignCommunities } from "./cluster.ts";
import type { PersistedEdge } from "../../src/noto-core/graphEdges.ts";

function edge(source: string, target: string): PersistedEdge {
  return { id: `${source}->${target}`, sourceId: source, targetId: target, relation: "links_to", confidence: "EXTRACTED", confidenceScore: 1 };
}

describe("assignCommunities", () => {
  it("groups two densely-linked clusters separately", () => {
    const nodeIds = ["a1", "a2", "a3", "b1", "b2", "b3"];
    const edges = [
      edge("a1", "a2"), edge("a2", "a3"), edge("a1", "a3"),
      edge("b1", "b2"), edge("b2", "b3"), edge("b1", "b3"),
    ];
    const communities = assignCommunities(nodeIds, edges);
    expect(communities.size).toBe(6);
    expect(communities.get("a1")).toBe(communities.get("a2"));
    expect(communities.get("a1")).toBe(communities.get("a3"));
    expect(communities.get("b1")).toBe(communities.get("b2"));
    expect(communities.get("a1")).not.toBe(communities.get("b1"));
  });

  it("assigns every isolated node its own bucket with no edges", () => {
    const communities = assignCommunities(["x", "y"], []);
    expect(communities.get("x")).not.toBe(communities.get("y"));
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd landing && npx vitest run server/graph/cluster.test.ts`
Expected: FAIL — `Cannot find module './cluster.ts'`

- [ ] **Step 4: Implement `cluster.ts`**

```typescript
// landing/server/graph/cluster.ts
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { PersistedEdge } from "../../src/noto-core/graphEdges.ts";

/**
 * Assign a community id to every node. Uses Louvain
 * (graphology-communities-louvain); if that throws for any reason, falls back
 * to a deterministic label-propagation pass so clustering degrades gracefully
 * instead of failing the whole graph rebuild.
 */
export function assignCommunities(nodeIds: string[], edges: PersistedEdge[]): Map<string, number> {
  try {
    return louvainCommunities(nodeIds, edges);
  } catch {
    return labelPropagation(nodeIds, edges);
  }
}

function louvainCommunities(nodeIds: string[], edges: PersistedEdge[]): Map<string, number> {
  const graph = new Graph({ type: "undirected", multi: false, allowSelfLoops: false });
  for (const id of nodeIds) graph.mergeNode(id);
  for (const e of edges) {
    if (e.sourceId === e.targetId) continue;
    graph.mergeNode(e.sourceId);
    graph.mergeNode(e.targetId);
    if (!graph.hasEdge(e.sourceId, e.targetId)) graph.addEdge(e.sourceId, e.targetId, { weight: e.confidenceScore });
  }
  const assignment = louvain(graph);
  return new Map(Object.entries(assignment));
}

/** Deterministic fallback: repeatedly adopt the majority neighbor label until stable (capped iterations). */
function labelPropagation(nodeIds: string[], edges: PersistedEdge[]): Map<string, number> {
  const neighbors = new Map<string, string[]>();
  for (const id of nodeIds) neighbors.set(id, []);
  for (const e of edges) {
    if (e.sourceId === e.targetId) continue;
    neighbors.get(e.sourceId)?.push(e.targetId);
    neighbors.get(e.targetId)?.push(e.sourceId);
  }
  const labels = new Map<string, number>(nodeIds.map((id, i) => [id, i]));
  for (let pass = 0; pass < 10; pass += 1) {
    let changed = false;
    for (const id of nodeIds) {
      const ns = neighbors.get(id) ?? [];
      if (ns.length === 0) continue;
      const counts = new Map<number, number>();
      for (const n of ns) {
        const label = labels.get(n)!;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      if (best !== labels.get(id)) {
        labels.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return labels;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd landing && npx vitest run server/graph/cluster.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add landing/package.json landing/package-lock.json landing/server/graph/cluster.ts landing/server/graph/cluster.test.ts
git commit -m "feat(graph): cluster vault edges with Louvain, fallback to label propagation"
```

---

### Task 5: Rebuild orchestration (content-hash cache + persistence)

**Files:**
- Create: `landing/server/graph/build.ts`
- Test: `landing/server/graph/build.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// landing/server/graph/build.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { createUser, createVault, createFile, updateFile, getVaultEdges, getNoteGraphState, sha256Hex } from "../db.ts";
import { setEmbedder, realEmbedder } from "../search/embedder.ts";
import { rebuildVaultGraph } from "./build.ts";

afterEach(() => setEmbedder(realEmbedder));

function freshVault(): string {
  const u = createUser({ email: `build-${crypto.randomUUID()}@t.local` });
  return createVault(u.id, { name: "V" }).id;
}

describe("rebuildVaultGraph", () => {
  it("extracts a links_to edge between two wikilinked notes", async () => {
    const vaultId = freshVault();
    const b = createFile(vaultId, { path: "b.md", title: "B", content: "B note" });
    const a = createFile(vaultId, { path: "a.md", title: "A", content: "See [[B]]." });
    setEmbedder({ ready: () => false, embed: async () => { throw new Error("model unavailable in this test"); } });

    const result = await rebuildVaultGraph(vaultId);
    expect(result.filesProcessed).toBeGreaterThan(0);
    expect(getVaultEdges(vaultId)).toContainEqual(
      expect.objectContaining({ sourceId: a.id, targetId: b.id, relation: "links_to", confidence: "EXTRACTED" }),
    );
  });

  it("skips unchanged notes on a re-run (content-hash cache)", async () => {
    const vaultId = freshVault();
    createFile(vaultId, { path: "c.md", title: "C", content: "hello" });
    setEmbedder({ ready: () => false, embed: async () => { throw new Error("should not be called"); } });

    const first = await rebuildVaultGraph(vaultId);
    expect(first.filesProcessed).toBeGreaterThan(0);

    const second = await rebuildVaultGraph(vaultId);
    expect(second.filesProcessed).toBe(0);
  });

  it("re-processes a note after its content changes", async () => {
    const vaultId = freshVault();
    const file = createFile(vaultId, { path: "d.md", title: "D", content: "v1" });
    setEmbedder({ ready: () => false, embed: async () => { throw new Error("should not be called"); } });
    await rebuildVaultGraph(vaultId);

    updateFile(file.id, { content: "v2" });
    const result = await rebuildVaultGraph(vaultId);
    expect(result.filesProcessed).toBe(1);
    expect(getNoteGraphState(file.id)?.contentHash).toBe(sha256Hex("v2"));
  });

  it("never throws — a failure yields a zeroed result", async () => {
    setEmbedder({ ready: () => true, embed: async () => { throw new Error("boom"); } });
    const result = await rebuildVaultGraph("not-a-real-vault-id");
    expect(result).toEqual({ filesProcessed: 0, edgeCount: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd landing && npx vitest run server/graph/build.test.ts`
Expected: FAIL — `Cannot find module './build.ts'`

- [ ] **Step 3: Implement `build.ts`**

```typescript
// landing/server/graph/build.ts
import {
  getFilesForVault, getNoteGraphState, upsertNoteGraphState, replaceFileEdges,
  getVaultEdges, setNoteCommunities, getStaleGraphVaultIds, sha256Hex,
  type PublicFile,
} from "../db.ts";
import { buildMetadataCache } from "../../src/noto-core/metadata.ts";
import { buildStructuralEdges, isWellLinked, type PersistedEdge } from "../../src/noto-core/graphEdges.ts";
import { computeSemanticEdges } from "./similarity.ts";
import { assignCommunities } from "./cluster.ts";

export interface RebuildResult {
  filesProcessed: number;
  edgeCount: number;
}

/**
 * Recompute the graph for one vault: skip notes whose content hasn't changed
 * since the last build (content-hash cache), extract structural edges for the
 * rest, add semantic edges only for under-linked notes, then re-cluster.
 * Never throws — best-effort, mirrors reembedNote/backfillEmbeddings.
 */
export async function rebuildVaultGraph(vaultId: string): Promise<RebuildResult> {
  try {
    return await rebuildVaultGraphInner(vaultId);
  } catch (err) {
    console.warn("[graph] rebuildVaultGraph failed:", err);
    return { filesProcessed: 0, edgeCount: 0 };
  }
}

async function rebuildVaultGraphInner(vaultId: string): Promise<RebuildResult> {
  const files: PublicFile[] = getFilesForVault(vaultId);
  const cache = buildMetadataCache(files);

  const changed = files.filter((f) => getNoteGraphState(f.id)?.contentHash !== sha256Hex(f.content));
  const structuralByFile = new Map<string, PersistedEdge[]>();
  const underLinked: { fileId: string; content: string }[] = [];

  for (const file of changed) {
    const meta = cache.filesById[file.id];
    const wellLinked = meta !== undefined && isWellLinked(meta);
    structuralByFile.set(file.id, buildStructuralEdges(file, cache));
    upsertNoteGraphState({ fileId: file.id, vaultId, contentHash: sha256Hex(file.content), wellLinked });
    if (!wellLinked) underLinked.push({ fileId: file.id, content: file.content });
  }

  const semanticByFile = new Map<string, PersistedEdge[]>();
  if (underLinked.length > 0) {
    for (const e of await computeSemanticEdges(vaultId, underLinked)) {
      const list = semanticByFile.get(e.sourceId);
      if (list) list.push(e);
      else semanticByFile.set(e.sourceId, [e]);
    }
  }

  for (const file of changed) {
    const structural = structuralByFile.get(file.id) ?? [];
    const semantic = semanticByFile.get(file.id) ?? [];
    replaceFileEdges(vaultId, file.id, [...structural, ...semantic]);
  }

  const allEdges = getVaultEdges(vaultId);
  setNoteCommunities(assignCommunities(files.map((f) => f.id), allEdges));

  return { filesProcessed: changed.length, edgeCount: allEdges.length };
}

/** Boot-time backfill: rebuild every vault whose graph is missing or stale. Mirrors backfillEmbeddings. */
export async function rebuildStaleVaultGraphs(): Promise<void> {
  for (const vaultId of getStaleGraphVaultIds()) {
    await rebuildVaultGraph(vaultId);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd landing && npx vitest run server/graph/build.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add landing/server/graph/build.ts landing/server/graph/build.test.ts
git commit -m "feat(graph): rebuild orchestration with content-hash cache + clustering"
```

---

### Task 6: Budgeted query (internal function)

**Files:**
- Create: `landing/server/graph/query.ts`
- Test: `landing/server/graph/query.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// landing/server/graph/query.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { createUser, createVault, createFile } from "../db.ts";
import { setEmbedder, realEmbedder, type Embedder } from "../search/embedder.ts";
import { rebuildVaultGraph } from "./build.ts";
import { queryVaultGraph } from "./query.ts";

afterEach(() => setEmbedder(realEmbedder));

describe("queryVaultGraph", () => {
  it("prefers the EXTRACTED links_to edge over INFERRED ones under a tight budget", async () => {
    const u = createUser({ email: `q-${crypto.randomUUID()}@t.local` });
    const vaultId = createVault(u.id, { name: "V" }).id;
    const b = createFile(vaultId, { path: "b.md", title: "B", content: "B note" });
    const a = createFile(vaultId, { path: "a.md", title: "A", content: "See [[B]]." });

    const fake: Embedder = { ready: () => true, embed: async (texts) => texts.map(() => { const v = new Float32Array(4); v[0] = 1; return v; }) };
    setEmbedder(fake);
    await rebuildVaultGraph(vaultId);

    const result = queryVaultGraph(vaultId, a.id, 2); // room for `a` + one more node
    expect(result.nodeIds).toEqual([a.id, b.id]);
  });

  it("attaches the note's community", async () => {
    const u = createUser({ email: `q2-${crypto.randomUUID()}@t.local` });
    const vaultId = createVault(u.id, { name: "V" }).id;
    const file = createFile(vaultId, { path: "a.md", title: "A", content: "solo note" });
    setEmbedder({ ready: () => false, embed: async () => { throw new Error("unused"); } });
    await rebuildVaultGraph(vaultId);

    const result = queryVaultGraph(vaultId, file.id, 5);
    expect(typeof result.community).toBe("number");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd landing && npx vitest run server/graph/query.test.ts`
Expected: FAIL — `Cannot find module './query.ts'`

- [ ] **Step 3: Implement `query.ts`**

```typescript
// landing/server/graph/query.ts
import { getVaultEdges, getNoteGraphState } from "../db.ts";
import { budgetedQuery, type GraphQueryResult } from "../../src/noto-core/graphEdges.ts";

export interface VaultGraphQueryResult extends GraphQueryResult {
  community: number | null;
}

/** The compact neighborhood around one note: EXTRACTED edges before INFERRED, capped at `budget`. Internal-only for now. */
export function queryVaultGraph(vaultId: string, fileId: string, budget = 20): VaultGraphQueryResult {
  const edges = getVaultEdges(vaultId);
  const result = budgetedQuery(edges, fileId, budget);
  return { ...result, community: getNoteGraphState(fileId)?.community ?? null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd landing && npx vitest run server/graph/query.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add landing/server/graph/query.ts landing/server/graph/query.test.ts
git commit -m "feat(graph): expose queryVaultGraph, a budgeted internal read"
```

---

### Task 7: Wire the rebuild into every save path + boot

**Files:**
- Modify: `landing/server/notes/routes.ts` (5 call sites)
- Modify: `landing/server/dump/commit.ts` (4 call sites)
- Modify: `landing/server/index.ts`
- Test: Create `landing/server/notes/routes.graph.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// landing/server/notes/routes.graph.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";
import { setEmbedder, realEmbedder, type Embedder } from "../search/embedder.ts";
import { getUserByEmail, getVaultsForUser, getVaultEdges } from "../db.ts";

let srv: TestServer;
beforeAll(async () => { srv = await startTestServer(); });
afterAll(() => srv.close());
afterEach(() => setEmbedder(realEmbedder));

describe("note save wires the graph layer", () => {
  it("creating a note that wikilinks another note persists a links_to edge", async () => {
    setEmbedder({ ready: () => false, embed: async () => { throw new Error("model unavailable in this test"); } } as Embedder);
    const email = `graph-${crypto.randomUUID()}@example.com`;
    const cookie = await signup(srv.baseURL, email);
    const token = await mintToken(cookie, ["read", "write"], "G");
    const pat = makePatClient(srv.baseURL, token);

    await pat.req("POST", "/api/notes", { path: "Memory/b.md", title: "B", content: "B note" });
    const aRes = await pat.req("POST", "/api/notes", { path: "Memory/a.md", title: "A", content: "See [[B]]." });
    const a = (await aRes.json()) as { fileId: string };

    const userId = getUserByEmail(email)!.id;
    const vaultId = getVaultsForUser(userId)[0].id;
    const edges = getVaultEdges(vaultId);
    expect(edges.some((e) => e.sourceId === a.fileId && e.relation === "links_to")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd landing && npx vitest run server/notes/routes.graph.test.ts`
Expected: FAIL — no `links_to` edge exists yet (nothing calls `rebuildVaultGraph`)

- [ ] **Step 3: Wire `server/notes/routes.ts`**

Add this import near the top of `landing/server/notes/routes.ts` (alongside `import { reembedNote } from "../search/embedNote.ts";`):

```typescript
import { rebuildVaultGraph } from "../graph/build.ts";
```

Then add one line after each of these 5 existing calls:

1. Line 265 — inside the vault-scoped create route:
   - Before: `    await reembedNote(created.id, parsed.data.content);`
   - After:
     ```typescript
         await reembedNote(created.id, parsed.data.content);
         await rebuildVaultGraph(vault.id);
     ```

2. Line 300 — inside the default-vault create route:
   - Before: `  await reembedNote(file.id, parsed.data.content);`
   - After:
     ```typescript
       await reembedNote(file.id, parsed.data.content);
       await rebuildVaultGraph(vault.id);
     ```

3. Line 334 — inside the PATCH route:
   - Before: `  if (parsed.data.content !== undefined) await reembedNote(existing.id, parsed.data.content);`
   - After:
     ```typescript
       if (parsed.data.content !== undefined) {
         await reembedNote(existing.id, parsed.data.content);
         await rebuildVaultGraph(existing.vault_id);
       }
     ```

4. Line 427 — inside the section-update route:
   - Before: `  await reembedNote(file.id, nextContent);`
   - After:
     ```typescript
       await reembedNote(file.id, nextContent);
       await rebuildVaultGraph(file.vault_id);
     ```

5. Line 488 — inside the append route:
   - Before: `  await reembedNote(file.id, nextContent);`
   - After:
     ```typescript
       await reembedNote(file.id, nextContent);
       await rebuildVaultGraph(file.vault_id);
     ```

- [ ] **Step 4: Wire `server/dump/commit.ts`**

Add this import near the top of `landing/server/dump/commit.ts` (alongside `import { reembedNote } from "../search/embedNote.ts";`):

```typescript
import { rebuildVaultGraph } from "../graph/build.ts";
```

Then add one line after each of these 4 existing calls (all already have `vaultId` in scope as a function parameter):

1. `commitNew`, line 97 — after `  await reembedNote(file.id, content);` add `  await rebuildVaultGraph(vaultId);`
2. `commitUpdate`, line 142 — after `  await reembedNote(old.id, content);` add `  await rebuildVaultGraph(vaultId);`
3. `commitMoc` (existing-MOC branch), line 182 — after `      await reembedNote(old.id, content);` add `      await rebuildVaultGraph(vaultId);`
4. `commitMoc` (new-MOC branch), line 209 — after `  await reembedNote(file.id, content);` add `  await rebuildVaultGraph(vaultId);`

- [ ] **Step 5: Wire boot-time backfill in `server/index.ts`**

Replace:

```typescript
import { warm } from "./search/embedder.ts";
import { backfillEmbeddings } from "./search/semantic.ts";
```

with:

```typescript
import { warm } from "./search/embedder.ts";
import { backfillEmbeddings } from "./search/semantic.ts";
import { rebuildStaleVaultGraphs } from "./graph/build.ts";
```

Replace:

```typescript
  void (async () => {
    try { await backfillEmbeddings(); } catch { /* best-effort; never crash boot */ }
  })();
```

with:

```typescript
  void (async () => {
    try { await backfillEmbeddings(); } catch { /* best-effort; never crash boot */ }
    try { await rebuildStaleVaultGraphs(); } catch { /* best-effort; never crash boot */ }
  })();
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd landing && npx vitest run server/notes/routes.graph.test.ts`
Expected: PASS (1 test)

- [ ] **Step 7: Run the full server test suite to check for regressions**

Run: `cd landing && npx vitest run server`
Expected: PASS — all existing + new tests green

- [ ] **Step 8: Commit**

```bash
git add landing/server/notes/routes.ts landing/server/dump/commit.ts landing/server/index.ts landing/server/notes/routes.graph.test.ts
git commit -m "feat(graph): rebuild vault graph on every note save + boot backfill"
```

---

### Task 8: Benchmark — MiniLM call count before vs. after

**Files:**
- Create: `landing/scripts/benchmark-graph-edges.mts`
- Modify: `landing/package.json` (add a script entry)

- [ ] **Step 1: Write the benchmark script**

```typescript
// landing/scripts/benchmark-graph-edges.mts
/**
 * Benchmark: MiniLM call count + token cost for finding related notes,
 * before (repeated semantic search per query) vs. after (one-time graph
 * rebuild, then free reads via queryVaultGraph).
 *
 * Plan: docs/superpowers/plans/2026-07-06-graph-edges-layer.md
 *
 * Uses a counting fake embedder (not the real ONNX model) so the benchmark is
 * fast and deterministic — it measures call count and token volume of the
 * text passed to embed(), not retrieval quality.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encode } from "gpt-tokenizer/model/gpt-4o";

const dir = mkdtempSync(join(tmpdir(), "noto-bench-graph-"));
process.env.DATABASE_PATH = join(dir, "bench.sqlite");

const { createUser, createVault, createFile } = await import("../server/db.ts");
const { setEmbedder } = await import("../server/search/embedder.ts");
const { rebuildVaultGraph } = await import("../server/graph/build.ts");
const { queryVaultGraph } = await import("../server/graph/query.ts");
const { semanticSearchNotes } = await import("../server/search/semantic.ts");

const NOTE_COUNT = 40;
const QUERY_COUNT = 10;

let embedCalls = 0;
let embedTokens = 0;
setEmbedder({
  ready: () => true,
  embed: async (texts: string[]) => {
    embedCalls += 1;
    for (const t of texts) embedTokens += encode(t).length;
    return texts.map((_, i) => {
      const v = new Float32Array(32);
      v[i % 32] = 1;
      return v;
    });
  },
});

const user = createUser({ email: `bench-${crypto.randomUUID()}@t.local` });
const vault = createVault(user.id, { name: "Bench Vault" });

const TOPICS = ["Photosynthesis", "Mitochondria", "Cold War", "Logarithms", "Enzymes"];
const files: { id: string }[] = [];
for (let i = 0; i < NOTE_COUNT; i += 1) {
  const topic = TOPICS[i % TOPICS.length];
  const linksBack = i > 0 && i % 4 === 0
    ? `\n\nSee [[Note ${i - 1}]] and [[Note ${Math.max(i - 2, 0)}]] and #${topic.toLowerCase()}.`
    : "";
  const file = createFile(vault.id, {
    path: `Note ${i}.md`,
    title: `Note ${i}`,
    content: `${topic} discussion, part ${i}.${linksBack}`,
  });
  files.push(file);
}

// --- BEFORE: every "find related notes" query re-embeds the query text ---
embedCalls = 0;
embedTokens = 0;
for (let i = 0; i < QUERY_COUNT; i += 1) {
  await semanticSearchNotes(user.id, `What relates to ${TOPICS[i % TOPICS.length]}?`, 5);
}
const before = { calls: embedCalls, tokens: embedTokens };

// --- AFTER: one graph rebuild, then free reads via queryVaultGraph ---
embedCalls = 0;
embedTokens = 0;
await rebuildVaultGraph(vault.id);
const rebuildCost = { calls: embedCalls, tokens: embedTokens };

embedCalls = 0;
embedTokens = 0;
for (let i = 0; i < QUERY_COUNT; i += 1) {
  queryVaultGraph(vault.id, files[i % files.length].id, 10);
}
const after = { calls: embedCalls, tokens: embedTokens };

console.log(`Notes in vault:                    ${NOTE_COUNT}`);
console.log(`Before (repeated semantic search): ${before.calls} embed calls, ${before.tokens} tokens across ${QUERY_COUNT} queries`);
console.log(`After  (one-time graph rebuild):    ${rebuildCost.calls} embed calls, ${rebuildCost.tokens} tokens (amortized over the vault's lifetime)`);
console.log(`After  (${QUERY_COUNT} graph reads):          ${after.calls} embed calls, ${after.tokens} tokens`);
console.log(`Query-time embed calls avoided:    ${before.calls - after.calls}`);

rmSync(dir, { recursive: true, force: true });
```

- [ ] **Step 2: Add the npm script**

In `landing/package.json`, add to `"scripts"` (alongside the other `benchmark:*` entries):

```json
    "benchmark:graph-edges": "tsx scripts/benchmark-graph-edges.mts",
```

- [ ] **Step 3: Run it**

Run: `cd landing && npm run benchmark:graph-edges`
Expected: Prints the before/after table; `Query-time embed calls avoided` is a positive number equal to `before.calls` (since `queryVaultGraph` performs zero embed calls at read time).

- [ ] **Step 4: Commit**

```bash
git add landing/scripts/benchmark-graph-edges.mts landing/package.json
git commit -m "test(graph): add MiniLM call-count benchmark for the graph edges layer"
```

---

## Self-Review Notes

- **Spec coverage:** Deliverable 1 (content-hash cache) → Tasks 2 + 5. Deliverable 2 (structural parser) → Task 1. Deliverable 3 (link-density gate) → Task 1. Deliverable 4 (MiniLM reuse, only for under-linked notes) → Task 3. Deliverable 5 (graph builder + persistence) → Tasks 2 + 5. Deliverable 6 (clustering + fallback) → Task 4. Deliverable 7 (budgeted query) → Tasks 1 + 6. Deliverable 8 (benchmark) → Task 8.
- **Type consistency:** `PersistedEdge` is defined once in `src/noto-core/graphEdges.ts` (Task 1) and imported everywhere else (`db.ts`, `similarity.ts`, `cluster.ts`, `build.ts`, `query.ts`) — no parallel/renamed shape.
- **No new HTTP/MCP surface:** confirmed — `queryVaultGraph` has no router wiring in this plan, per the locked scope decision above.
