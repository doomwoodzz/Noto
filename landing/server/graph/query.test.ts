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
