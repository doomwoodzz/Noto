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
