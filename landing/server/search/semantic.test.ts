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
    setEmbedder(fakeEmbedder((t) => (/deploy|ship|release/i.test(t) ? 1 : 2)));
    const { pat } = await setup("sem-recall@example.com");
    await pat.req("POST", "/api/memory", { text: "we ship releases on fridays", scope: "p" });
    await pat.req("POST", "/api/memory", { text: "the office plants need watering", scope: "p" });
    const r = await pat.req("GET", "/api/memory?q=deployment+cadence&scope=p");
    const { memories } = (await r.json()) as { memories: { text: string }[] };
    expect(memories.length).toBe(1);
    expect(memories[0].text).toBe("we ship releases on fridays");
  });

  it("falls back to lexical FTS when the model isn't ready", async () => {
    setEmbedder({ ready: () => false, embed: async () => { throw new Error("cold"); } });
    const { pat } = await setup("sem-fallback@example.com");
    await pat.req("POST", "/api/memory", { text: "kubernetes ingress notes", scope: "p" });
    const r = await pat.req("GET", "/api/memory?q=kubernetes&scope=p");
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
