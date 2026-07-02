import { describe, it, expect } from "vitest";
import { enrichNote, __setEnrichComplete, __resetEnrichComplete } from "./enrich.ts";
import { AINotConfiguredError } from "../ai/openai.ts";

type FakeComplete = (opts: { system: string; user: string; maxTokens: number; apiKey?: string; model?: string }) =>
  Promise<{ text: string; inputTokens: number; outputTokens: number }>;

function withComplete(fn: FakeComplete) {
  __setEnrichComplete(fn as unknown as typeof import("../ai/openai.ts").complete);
}

describe("enrichNote", () => {
  const base = { userId: "u1", vaultId: "v1", title: "Photosynthesis", body: "Plants convert light.", candidateTitles: ["Cellular Respiration", "Chlorophyll", "Mitochondria"] };

  it("parses strict JSON, clamps tags ≤5 and allow-lists links", async () => {
    withComplete(async () => ({
      text: JSON.stringify({
        title: "Photosynthesis Basics",
        summary: "How plants turn light into energy.",
        tags: ["#biology", "plants", "#light", "energy", "cells", "extra-sixth"],
        links: ["Chlorophyll", "Cellular Respiration", "Not A Candidate"],
      }),
      inputTokens: 1, outputTokens: 1,
    }));
    try {
      const out = await enrichNote(base);
      expect(out.title).toBe("Photosynthesis Basics");
      expect(out.summary).toBe("How plants turn light into energy.");
      expect(out.tags).toEqual(["biology", "plants", "light", "energy", "cells"]); // ≤5, no leading '#'
      expect(out.links).toEqual(["Chlorophyll", "Cellular Respiration"]); // allow-listed, "Not A Candidate" dropped
    } finally {
      __resetEnrichComplete();
    }
  });

  it("tolerates code fences and surrounding prose", async () => {
    withComplete(async () => ({
      text: "Here you go:\n```json\n{\"title\":\"X\",\"summary\":\"s\",\"tags\":[\"t\"],\"links\":[]}\n```\nDone.",
      inputTokens: 1, outputTokens: 1,
    }));
    try {
      const out = await enrichNote(base);
      expect(out.title).toBe("X");
      expect(out.tags).toEqual(["t"]);
      expect(out.links).toEqual([]);
    } finally {
      __resetEnrichComplete();
    }
  });

  it("falls back deterministically on unparseable output", async () => {
    withComplete(async () => ({ text: "sorry, I cannot do that", inputTokens: 1, outputTokens: 1 }));
    try {
      const out = await enrichNote(base);
      expect(out).toEqual({ title: "Photosynthesis", summary: "", tags: [], links: [] });
    } finally {
      __resetEnrichComplete();
    }
  });

  it("falls back deterministically when AI is not configured", async () => {
    withComplete(async () => { throw new AINotConfiguredError(); });
    try {
      const out = await enrichNote(base);
      expect(out).toEqual({ title: "Photosynthesis", summary: "", tags: [], links: [] });
    } finally {
      __resetEnrichComplete();
    }
  });

  it("falls back to the title hint when the model returns an empty title", async () => {
    withComplete(async () => ({ text: JSON.stringify({ title: "  ", summary: "s", tags: [], links: [] }), inputTokens: 1, outputTokens: 1 }));
    try {
      const out = await enrichNote(base);
      expect(out.title).toBe("Photosynthesis");
      expect(out.summary).toBe("s");
    } finally {
      __resetEnrichComplete();
    }
  });
});
