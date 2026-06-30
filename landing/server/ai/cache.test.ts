import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex, insertAiCache, getAiCacheByHash, floatsToBlob } from "../db.ts";

vi.mock("./openai.ts", () => ({
  complete: vi.fn(async () => ({ text: "LIVE_REPLY", inputTokens: 30, outputTokens: 15 })),
  AINotConfiguredError: class extends Error {},
}));

vi.mock("../search/embedder.ts", () => ({
  embedder: {
    ready: vi.fn(() => false),
    embed: vi.fn(async () => [new Float32Array(384).fill(0)]),
  },
}));

import { complete } from "./openai.ts";
import { embedder } from "../search/embedder.ts";
import { completeWithCache } from "./cache.ts";

const FEATURE = "summarize" as const;
const SYSTEM = "You are a study assistant.";
const USER = "Note: Biology\n\nPhotosynthesis converts light to glucose.";
const MAX = 500;

function nowSec() { return Math.floor(Date.now() / 1000); }

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(embedder.ready).mockReturnValue(false);
});

describe("completeWithCache — content-hash hit", () => {
  it("returns cached response without calling complete()", async () => {
    const hash = sha256Hex(FEATURE + SYSTEM + USER);
    insertAiCache({
      content_hash: hash,
      note_hash: null,
      question_embed: null,
      feature: FEATURE,
      response: "CACHED_REPLY",
      input_tokens: 40,
      output_tokens: 20,
      created_at: nowSec(),
      expires_at: nowSec() + 3600,
    });

    const result = await completeWithCache({ feature: FEATURE, system: SYSTEM, user: USER, maxTokens: MAX });

    expect(result).toBe("CACHED_REPLY");
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("completeWithCache — expired entry", () => {
  it("treats expired entry as miss, deletes it, and calls complete()", async () => {
    const hash = sha256Hex(FEATURE + SYSTEM + USER);
    insertAiCache({
      content_hash: hash,
      note_hash: null,
      question_embed: null,
      feature: FEATURE,
      response: "STALE_REPLY",
      input_tokens: 40,
      output_tokens: 20,
      created_at: nowSec() - 100,
      expires_at: nowSec() - 1, // already expired
    });

    const result = await completeWithCache({ feature: FEATURE, system: SYSTEM, user: USER, maxTokens: MAX });

    expect(result).toBe("LIVE_REPLY");
    expect(complete).toHaveBeenCalledOnce();
    // Expired row must be gone
    expect(getAiCacheByHash(hash)).toBeUndefined();
  });
});

describe("completeWithCache — semantic hit", () => {
  it("returns cached chat response when embedding similarity >= 0.92", async () => {
    const noteTitle = "Biology";
    const noteContent = "Chloroplasts make glucose.";
    const question = "How is glucose made?";
    const noteHash = sha256Hex(noteTitle + noteContent);

    // A unit vector — dot product with itself = 1.0
    const vec = new Float32Array(384);
    vec[0] = 1;
    const embed = floatsToBlob(vec);

    insertAiCache({
      content_hash: sha256Hex("chat" + SYSTEM + "different exact prompt"),
      note_hash: noteHash,
      question_embed: embed,
      feature: "chat",
      response: "SEMANTIC_REPLY",
      input_tokens: 30,
      output_tokens: 12,
      created_at: nowSec(),
      expires_at: nowSec() + 3600,
    });

    // Embedder returns the SAME vector — dot product = 1.0, well above 0.92
    vi.mocked(embedder.ready).mockReturnValue(true);
    vi.mocked(embedder.embed).mockResolvedValue([vec]);

    const result = await completeWithCache({
      feature: "chat",
      system: SYSTEM,
      user: "rephrased prompt",
      maxTokens: 700,
      noteTitle,
      noteContent,
      question,
    });

    expect(result).toBe("SEMANTIC_REPLY");
    expect(complete).not.toHaveBeenCalled();
  });

  it("falls through when similarity is below 0.92", async () => {
    const noteTitle = "Biology";
    const noteContent = "Chloroplasts make glucose.";
    const question = "Unrelated question?";
    const noteHash = sha256Hex(noteTitle + noteContent);

    // Stored vector: unit in dimension 0
    const storedVec = new Float32Array(384);
    storedVec[0] = 1;
    insertAiCache({
      content_hash: sha256Hex("chat" + SYSTEM + "another distinct prompt"),
      note_hash: noteHash,
      question_embed: floatsToBlob(storedVec),
      feature: "chat",
      response: "SHOULD_NOT_RETURN",
      input_tokens: 30,
      output_tokens: 12,
      created_at: nowSec(),
      expires_at: nowSec() + 3600,
    });

    // Query vector: unit in dimension 1 — dot product with storedVec = 0
    const queryVec = new Float32Array(384);
    queryVec[1] = 1;
    vi.mocked(embedder.ready).mockReturnValue(true);
    vi.mocked(embedder.embed).mockResolvedValue([queryVec]);

    const result = await completeWithCache({
      feature: "chat",
      system: SYSTEM,
      user: "yet another distinct prompt",
      maxTokens: 700,
      noteTitle,
      noteContent,
      question,
    });

    expect(result).toBe("LIVE_REPLY");
    expect(complete).toHaveBeenCalledOnce();
  });
});

describe("completeWithCache — cache write on miss", () => {
  it("stores input_tokens and output_tokens from the OpenAI response", async () => {
    vi.mocked(complete).mockResolvedValueOnce({ text: "FRESH", inputTokens: 42, outputTokens: 17 });

    const sys = "system-unique-write-test";
    const usr = "user-unique-write-test";
    await completeWithCache({ feature: FEATURE, system: sys, user: usr, maxTokens: MAX });

    const stored = getAiCacheByHash(sha256Hex(FEATURE + sys + usr));
    expect(stored).toBeDefined();
    expect(stored!.input_tokens).toBe(42);
    expect(stored!.output_tokens).toBe(17);
    expect(stored!.response).toBe("FRESH");
  });
});

describe("completeWithCache — error resilience", () => {
  it("still returns live reply when cache write fails", async () => {
    const spy = vi.spyOn(await import("../db.ts"), "insertAiCache").mockImplementation(() => { throw new Error("disk full"); });

    const result = await completeWithCache({
      feature: "summarize",
      system: "sys-resilience",
      user: "usr-resilience",
      maxTokens: 500,
    }).catch(() => "THREW");

    expect(result).not.toBe("THREW");
    spy.mockRestore();
  });
});
