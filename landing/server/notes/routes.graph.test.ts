// landing/server/notes/routes.graph.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";
import { setEmbedder, realEmbedder, type Embedder } from "../search/embedder.ts";
import { ensureLocalOwner, getVaultsForUser, getVaultEdges } from "../db.ts";

let srv: TestServer;
beforeAll(async () => { srv = await startTestServer(); });
afterAll(() => srv.close());
afterEach(() => setEmbedder(realEmbedder));

describe("note save wires the graph layer", () => {
  it("creating a note that wikilinks another note persists a links_to edge", async () => {
    setEmbedder({ ready: () => false, embed: async () => { throw new Error("model unavailable in this test"); } } as Embedder);
    const cookie = await signup(srv.baseURL, "graph@example.com");
    const token = await mintToken(cookie, ["read", "write"], "G");
    const pat = makePatClient(srv.baseURL, token);

    await pat.req("POST", "/api/notes", { path: "Memory/b.md", title: "B", content: "B note" });
    const aRes = await pat.req("POST", "/api/notes", { path: "Memory/a.md", title: "A", content: "See [[B]]." });
    const a = (await aRes.json()) as { fileId: string };

    // There is one local owner by design (see ensureLocalOwner in db.ts) — no
    // per-account email lookup anymore, so resolve it directly.
    const userId = ensureLocalOwner().id;
    const vaultId = getVaultsForUser(userId)[0].id;
    const edges = getVaultEdges(vaultId);
    expect(edges.some((e) => e.sourceId === a.fileId && e.relation === "links_to")).toBe(true);
  });
});
