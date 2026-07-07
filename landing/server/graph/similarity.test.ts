// landing/server/graph/similarity.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { ensureLocalOwner, createVault, createFile, replaceNotePassages } from "../db.ts";
import { setEmbedder, realEmbedder, type Embedder } from "../search/embedder.ts";
import { computeSemanticEdges, meanPool } from "./similarity.ts";

afterEach(() => setEmbedder(realEmbedder));

function freshVault(): string {
  const u = ensureLocalOwner();
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
