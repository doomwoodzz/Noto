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

  it("serializes concurrent embed() calls without crashing", async () => {
    const [r1, r2, r3] = await Promise.all([
      realEmbedder.embed(["alpha one"]),
      realEmbedder.embed(["beta two", "gamma three"]),
      realEmbedder.embed(["delta four"]),
    ]);
    expect(r1.length).toBe(1);
    expect(r2.length).toBe(2);
    expect(r3.length).toBe(1);
    expect(r1[0].length).toBe(384);
  }, 60000);
});
