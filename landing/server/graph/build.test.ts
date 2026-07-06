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
