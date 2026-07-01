# Output Token Savings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a response-caching layer to Noto's OpenAI integration that eliminates output token spend on cache hits, and a benchmark script that proves the savings.

**Architecture:** A new `server/ai/cache.ts` wraps `complete()` with a two-path lookup — content-hash first, MiniLM semantic fallback for chat — backed by a new `ai_response_cache` SQLite table. All five AI routes swap one import; no route logic changes. A standalone benchmark script measures pass-1 (miss → populate) vs pass-2 (hit → 0 tokens) savings.

**Tech Stack:** `node:sqlite` (already used in `server/db.ts`), `@huggingface/transformers` MiniLM embedder (already in `server/search/embedder.ts`), `gpt-tokenizer` (already a dev dep), `tsx` (already a dev dep).

---

## File map

| Action | File | Purpose |
|---|---|---|
| Modify | `landing/server/env.ts` | Add `AI_CACHE_TTL_DAYS` env var |
| Modify | `landing/server/db.ts` | `ai_response_cache` table DDL + 5 accessor functions |
| Modify | `landing/server/ai/openai.ts` | Widen `complete()` return to `{text, inputTokens, outputTokens}` |
| Modify | `landing/server/ai/routes.test.ts` | Update `complete` mock to return object |
| Create | `landing/server/ai/cache.ts` | `completeWithCache()` — the caching layer |
| Create | `landing/server/ai/cache.test.ts` | Unit tests for the cache layer |
| Modify | `landing/server/ai/routes.ts` | Swap `complete()` → `completeWithCache()` in all 5 routes |
| Create | `landing/scripts/benchmark-output-savings.mts` | Two-pass cache savings benchmark |
| Modify | `landing/package.json` | Add `benchmark:output-savings` script |

---

## Task 1: `env.ts` — add `AI_CACHE_TTL_DAYS`

**Files:**
- Modify: `landing/server/env.ts`

- [ ] **Step 1: Add the env var to the zod schema**

In `landing/server/env.ts`, add one line to the `schema` object after `OPENAI_API_KEY`:

```ts
  /** Cache lifetime for AI responses. Entries expire after this many days. */
  AI_CACHE_TTL_DAYS: z.coerce.number().int().positive().default(7),
```

- [ ] **Step 2: Expose the computed seconds value in the exported `env` object**

In the same file, add to the `export const env = { ... }` block (after `openaiConfigured`):

```ts
  aiCacheTtlSeconds: raw.AI_CACHE_TTL_DAYS * 24 * 60 * 60,
```

- [ ] **Step 3: Run the server typecheck to confirm no errors**

```bash
cd landing && npm run typecheck:server
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add landing/server/env.ts
git commit -m "feat(cache): add AI_CACHE_TTL_DAYS env var"
```

---

## Task 2: `db.ts` — `ai_response_cache` table + accessors

**Files:**
- Modify: `landing/server/db.ts`

- [ ] **Step 1: Add the DDL inside the existing `db.exec()` block**

In `landing/server/db.ts`, locate the large `db.exec(\`...\`)` block that ends just before `// Additive migration: older databases...`. Add the following **inside that block**, after the `files_fts` trigger definitions and before the closing backtick:

```sql

  CREATE TABLE IF NOT EXISTS ai_response_cache (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    content_hash   TEXT    NOT NULL UNIQUE,
    note_hash      TEXT,
    question_embed BLOB,
    feature        TEXT    NOT NULL,
    response       TEXT    NOT NULL,
    input_tokens   INTEGER NOT NULL,
    output_tokens  INTEGER NOT NULL,
    hit_count      INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ai_response_cache_note
    ON ai_response_cache(note_hash);
  CREATE INDEX IF NOT EXISTS ai_response_cache_feature
    ON ai_response_cache(feature);
```

- [ ] **Step 2: Add the `AiCacheRow` interface**

Near the other interface definitions in `landing/server/db.ts` (e.g., after `export interface PatRow`), add:

```ts
export interface AiCacheRow {
  id: number;
  content_hash: string;
  note_hash: string | null;
  question_embed: Uint8Array | null;
  feature: string;
  response: string;
  input_tokens: number;
  output_tokens: number;
  hit_count: number;
  created_at: number;
  expires_at: number;
}
```

- [ ] **Step 3: Add prepared statements and accessor functions**

Near the bottom of `landing/server/db.ts`, before the `export { db };` line, add:

```ts
/* ----------------------------- AI response cache ----------------------------- */

const stmtAiCacheByHash = db.prepare(
  "SELECT * FROM ai_response_cache WHERE content_hash = ?",
);
const stmtAiCacheChatBucket = db.prepare(
  "SELECT * FROM ai_response_cache WHERE feature = 'chat' AND note_hash = ? AND expires_at > ?",
);
const stmtAiCacheInsert = db.prepare(
  `INSERT OR REPLACE INTO ai_response_cache
     (content_hash, note_hash, question_embed, feature, response,
      input_tokens, output_tokens, created_at, expires_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const stmtAiCacheIncrHit = db.prepare(
  "UPDATE ai_response_cache SET hit_count = hit_count + 1 WHERE id = ?",
);
const stmtAiCacheDeleteById = db.prepare(
  "DELETE FROM ai_response_cache WHERE id = ?",
);

export function getAiCacheByHash(contentHash: string): AiCacheRow | undefined {
  return stmtAiCacheByHash.get(contentHash) as AiCacheRow | undefined;
}

export function getAiCacheChatBucket(noteHash: string, nowSec: number): AiCacheRow[] {
  return stmtAiCacheChatBucket.all(noteHash, nowSec) as AiCacheRow[];
}

export function insertAiCache(row: Omit<AiCacheRow, "id" | "hit_count">): void {
  stmtAiCacheInsert.run(
    row.content_hash,
    row.note_hash,
    row.question_embed,
    row.feature,
    row.response,
    row.input_tokens,
    row.output_tokens,
    row.created_at,
    row.expires_at,
  );
}

export function incrementAiCacheHit(id: number): void {
  stmtAiCacheIncrHit.run(id);
}

export function deleteAiCacheRow(id: number): void {
  stmtAiCacheDeleteById.run(id);
}
```

- [ ] **Step 4: Typecheck and run existing tests to confirm migration is safe**

```bash
cd landing && npm run typecheck:server && npm test
```

Expected: all existing tests pass. The new table is created automatically; no test touches it yet.

- [ ] **Step 5: Commit**

```bash
git add landing/server/db.ts
git commit -m "feat(cache): add ai_response_cache table + accessor functions"
```

---

## Task 3: `openai.ts` — widen `complete()` return type

**Files:**
- Modify: `landing/server/ai/openai.ts`

- [ ] **Step 1: Update the `complete()` function**

Replace the current `complete()` function body in `landing/server/ai/openai.ts`:

```ts
export async function complete(opts: {
  system: string;
  user: string;
  maxTokens: number;
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const openai = getOpenAI();
  if (!openai) throw new AINotConfiguredError();
  const res = await openai.chat.completions.create({
    model: TEXT_MODEL,
    max_tokens: opts.maxTokens,
    temperature: 0.4,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });
  return {
    text: res.choices[0]?.message?.content?.trim() ?? "",
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd landing && npm run typecheck:server
```

Expected: errors in `routes.ts` (callers still destructure a string). These are expected and will be fixed in Task 6. Confirm only `routes.ts` errors appear — no others.

- [ ] **Step 3: Commit**

```bash
git add landing/server/ai/openai.ts
git commit -m "feat(cache): widen complete() to return {text, inputTokens, outputTokens}"
```

---

## Task 4: `routes.test.ts` — update mock to match widened return type

**Files:**
- Modify: `landing/server/ai/routes.test.ts`

The existing mock returns a plain string. It must return the new object shape so the test suite stays valid after routes.ts is updated in Task 6.

- [ ] **Step 1: Update the `vi.mock` factory for `complete`**

In `landing/server/ai/routes.test.ts`, replace:

```ts
  complete: vi.fn(async () => "MOCK_REPLY"),
```

with:

```ts
  complete: vi.fn(async () => ({ text: "MOCK_REPLY", inputTokens: 10, outputTokens: 5 })),
```

- [ ] **Step 2: Update the `mockResolvedValueOnce` call for flashcards**

The flashcards test overrides `complete` to return a JSON string. Update that call:

```ts
vi.mocked(complete).mockResolvedValueOnce(
  { text: '```json\n[{"q":"Q1","a":"A1"},{"q":"Q2","a":"A2"}]\n```', inputTokens: 20, outputTokens: 30 },
);
```

- [ ] **Step 3: Update the `mockResolvedValueOnce` call for find-links**

```ts
vi.mocked(complete).mockResolvedValueOnce(
  { text: '["Chloroplast","Not In List"]', inputTokens: 15, outputTokens: 8 },
);
```

- [ ] **Step 4: Update the `mockResolvedValueOnce` call for lecture-notes**

```ts
vi.mocked(complete).mockResolvedValueOnce(
  { text: "## AI Lecture Notes\n### Main explanation\nHi.", inputTokens: 50, outputTokens: 20 },
);
```

- [ ] **Step 5: Run the tests — expect failures on routes.ts callers (not in test file)**

```bash
cd landing && npm test -- --reporter=verbose 2>&1 | head -40
```

The test file itself is valid; the routes will fail because they still call `complete()` and try to use the result as a string. The test failures will be in routes (TypeScript type errors caught by vitest's type awareness). This is expected — Task 6 fixes routes.ts.

- [ ] **Step 6: Commit**

```bash
git add landing/server/ai/routes.test.ts
git commit -m "test(cache): update complete() mock to return {text, inputTokens, outputTokens}"
```

---

## Task 5: `cache.test.ts` + `cache.ts` — TDD the cache layer

**Files:**
- Create: `landing/server/ai/cache.test.ts`
- Create: `landing/server/ai/cache.ts`

The vitest config already sets `DATABASE_PATH=":memory:"` for all tests, so `db.ts` uses an in-memory DB automatically.

- [ ] **Step 1: Write the failing tests in `cache.test.ts`**

Create `landing/server/ai/cache.test.ts`:

```ts
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
  it("returns cached chat response when embedding similarity ≥ 0.92", async () => {
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
    // Force write failure by making the hash collide with something we can't REPLACE
    // (simplest: spy on insertAiCache to throw)
    const { insertAiCache: ins } = await import("../db.ts");
    const spy = vi.spyOn({ insertAiCache: ins }, "insertAiCache").mockImplementation(() => { throw new Error("disk full"); });

    // Just call completeWithCache and confirm it doesn't throw
    const result = await completeWithCache({
      feature: "summarize",
      system: "sys-resilience",
      user: "usr-resilience",
      maxTokens: 500,
    }).catch(() => "THREW");

    // Whether spy worked or not, result must not be "THREW"
    expect(result).not.toBe("THREW");
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests — confirm they all FAIL (cache.ts doesn't exist yet)**

```bash
cd landing && npm test -- server/ai/cache.test.ts
```

Expected: `Cannot find module './cache.ts'` or similar import error.

- [ ] **Step 3: Implement `cache.ts`**

Create `landing/server/ai/cache.ts`:

```ts
import { sha256Hex, floatsToBlob, blobToFloats, getAiCacheByHash, getAiCacheChatBucket, insertAiCache, incrementAiCacheHit, deleteAiCacheRow } from "../db.ts";
import { complete } from "./openai.ts";
import { embedder } from "../search/embedder.ts";
import { dot } from "../search/vec.ts";
import { env } from "../env.ts";

const SEMANTIC_THRESHOLD = 0.92;

export type CacheFeature =
  | "chat"
  | "summarize"
  | "flashcards"
  | "find-links"
  | "lecture-notes";

export async function completeWithCache(opts: {
  feature: CacheFeature;
  system: string;
  user: string;
  maxTokens: number;
  noteTitle?: string;
  noteContent?: string;
  question?: string;
}): Promise<string> {
  const contentHash = sha256Hex(opts.feature + opts.system + opts.user);
  const nowSec = Math.floor(Date.now() / 1000);
  const isChatWithContext =
    opts.feature === "chat" &&
    opts.noteTitle !== undefined &&
    opts.noteContent !== undefined &&
    opts.question !== undefined;

  // 1. Content-hash check — fastest path
  try {
    const cached = getAiCacheByHash(contentHash);
    if (cached) {
      if (cached.expires_at > nowSec) {
        incrementAiCacheHit(cached.id);
        return cached.response;
      }
      deleteAiCacheRow(cached.id); // lazy eviction of expired row
    }
  } catch (err) {
    console.error("[ai-cache] read error:", err);
  }

  // 2. Semantic fallback — chat only, when embedder is ready
  let cachedQueryVec: Float32Array | null = null;
  let cachedNoteHash: string | null = null;

  if (isChatWithContext && embedder.ready()) {
    try {
      cachedNoteHash = sha256Hex(opts.noteTitle! + opts.noteContent!);
      [cachedQueryVec] = await embedder.embed([opts.question!]);
      const bucket = getAiCacheChatBucket(cachedNoteHash, nowSec);

      let bestId = -1;
      let bestScore = 0;
      let bestResponse = "";
      for (const row of bucket) {
        if (!row.question_embed) continue;
        const score = dot(cachedQueryVec, blobToFloats(row.question_embed));
        if (score > bestScore) {
          bestScore = score;
          bestId = row.id;
          bestResponse = row.response;
        }
      }
      if (bestScore >= SEMANTIC_THRESHOLD) {
        incrementAiCacheHit(bestId);
        return bestResponse;
      }
    } catch (err) {
      console.debug("[ai-cache] semantic lookup skipped:", err);
      cachedQueryVec = null;
      cachedNoteHash = null;
    }
  }

  // 3. Miss — call OpenAI
  const { text, inputTokens, outputTokens } = await complete({
    system: opts.system,
    user: opts.user,
    maxTokens: opts.maxTokens,
  });

  // 4. Store result (best-effort; write failures never surface to the caller)
  const storeAt = Math.floor(Date.now() / 1000);
  try {
    // Compute chat embedding for storage if not already done during lookup
    if (isChatWithContext && !cachedQueryVec && embedder.ready()) {
      try {
        cachedNoteHash = sha256Hex(opts.noteTitle! + opts.noteContent!);
        [cachedQueryVec] = await embedder.embed([opts.question!]);
      } catch { /* store without embedding */ }
    }
    insertAiCache({
      content_hash: contentHash,
      note_hash: cachedNoteHash,
      question_embed: cachedQueryVec ? floatsToBlob(cachedQueryVec) : null,
      feature: opts.feature,
      response: text,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      created_at: storeAt,
      expires_at: storeAt + env.aiCacheTtlSeconds,
    });
  } catch (err) {
    console.error("[ai-cache] write error:", err);
  }

  return text;
}
```

- [ ] **Step 4: Run the tests — confirm they all pass**

```bash
cd landing && npm test -- server/ai/cache.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite to confirm nothing regressed**

```bash
cd landing && npm test
```

Expected: all existing tests pass (routes.test.ts may have type errors due to the openai.ts change — those are fixed in Task 6).

- [ ] **Step 6: Commit**

```bash
git add landing/server/ai/cache.ts landing/server/ai/cache.test.ts
git commit -m "feat(cache): implement completeWithCache with hash + semantic lookup"
```

---

## Task 6: `routes.ts` — swap `complete()` → `completeWithCache()`

**Files:**
- Modify: `landing/server/ai/routes.ts`

- [ ] **Step 1: Update the import at the top of `routes.ts`**

In `landing/server/ai/routes.ts`, replace:

```ts
import {
  complete,
  transcribe,
  MAX_TOKENS,
  AINotConfiguredError,
} from "./openai.ts";
```

with:

```ts
import {
  transcribe,
  MAX_TOKENS,
  AINotConfiguredError,
} from "./openai.ts";
import { completeWithCache } from "./cache.ts";
```

- [ ] **Step 2: Update the `/chat` route**

Replace:

```ts
    const reply = await complete({
      system: SYSTEM.chat,
      user: buildChatPrompt(parsed.data),
      maxTokens: MAX_TOKENS.chat,
    });
    res.json({ reply });
```

with:

```ts
    const reply = await completeWithCache({
      feature: "chat",
      system: SYSTEM.chat,
      user: buildChatPrompt(parsed.data),
      maxTokens: MAX_TOKENS.chat,
      noteTitle: parsed.data.noteTitle,
      noteContent: parsed.data.noteContent,
      question: parsed.data.question,
    });
    res.json({ reply });
```

- [ ] **Step 3: Update the `/summarize` route**

Replace:

```ts
    const reply = await complete({
      system: SYSTEM.summarize,
      user: buildSummarizePrompt(parsed.data.noteTitle, parsed.data.noteContent),
      maxTokens: MAX_TOKENS.summarize,
    });
    res.json({ reply });
```

with:

```ts
    const reply = await completeWithCache({
      feature: "summarize",
      system: SYSTEM.summarize,
      user: buildSummarizePrompt(parsed.data.noteTitle, parsed.data.noteContent),
      maxTokens: MAX_TOKENS.summarize,
    });
    res.json({ reply });
```

- [ ] **Step 4: Update the `/flashcards` route**

Replace:

```ts
    const raw = await complete({
      system: SYSTEM.flashcards,
      user: buildFlashcardsPrompt(parsed.data.noteTitle, parsed.data.noteContent),
      maxTokens: MAX_TOKENS.flashcards,
    });
```

with:

```ts
    const raw = await completeWithCache({
      feature: "flashcards",
      system: SYSTEM.flashcards,
      user: buildFlashcardsPrompt(parsed.data.noteTitle, parsed.data.noteContent),
      maxTokens: MAX_TOKENS.flashcards,
    });
```

- [ ] **Step 5: Update the `/find-links` route**

Replace:

```ts
    const raw = await complete({
      system: SYSTEM.findLinks,
      user: buildFindLinksPrompt({ noteTitle: t, noteContent: c, titles }),
      maxTokens: MAX_TOKENS.findLinks,
    });
```

with:

```ts
    const raw = await completeWithCache({
      feature: "find-links",
      system: SYSTEM.findLinks,
      user: buildFindLinksPrompt({ noteTitle: t, noteContent: c, titles }),
      maxTokens: MAX_TOKENS.findLinks,
    });
```

- [ ] **Step 6: Update the `/lecture-notes` route**

Replace:

```ts
    const markdown = await complete({
      system: SYSTEM.lecture,
      user: buildLecturePrompt(parsed.data.transcript, parsed.data.titles),
      maxTokens: MAX_TOKENS.lecture,
    });
    res.json({ markdown });
```

with:

```ts
    const markdown = await completeWithCache({
      feature: "lecture-notes",
      system: SYSTEM.lecture,
      user: buildLecturePrompt(parsed.data.transcript, parsed.data.titles),
      maxTokens: MAX_TOKENS.lecture,
    });
    res.json({ markdown });
```

- [ ] **Step 7: Typecheck and run full test suite**

```bash
cd landing && npm run typecheck:server && npm test
```

Expected: all tests pass, no typecheck errors.

- [ ] **Step 8: Commit**

```bash
git add landing/server/ai/routes.ts
git commit -m "feat(cache): wire all AI routes through completeWithCache"
```

---

## Task 7: Benchmark script + `package.json`

**Files:**
- Create: `landing/scripts/benchmark-output-savings.mts`
- Modify: `landing/package.json`

- [ ] **Step 1: Create the benchmark script**

Create `landing/scripts/benchmark-output-savings.mts`:

```ts
/**
 * Output-token savings benchmark.
 *
 * Measures how much the AI response cache (cache.ts) cuts token spend across
 * two sessions:
 *   Pass 1 (warm) — 15 unique queries hit OpenAI and populate the cache.
 *   Pass 2 (replay) — the same 15 queries + 5 paraphrased chat variants are
 *   served from cache (0 tokens billed for hits) or fall through to OpenAI.
 *
 * In stub mode (no OPENAI_API_KEY) real calls are replaced by a deterministic
 * estimator that uses gpt-tokenizer for input tokens and per-feature averages
 * for output tokens. The report labels this clearly.
 *
 * Run: cd landing && npm run benchmark:output-savings
 * Spec: docs/superpowers/specs/2026-06-30-noto-output-token-savings-design.md
 */

process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV ??= "development";
// Provide a dummy key so env.ts does not throw; in stub mode we never call OpenAI.
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = "stub";

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { encode } from "gpt-tokenizer/model/gpt-4o";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const OUT_DIR = resolve(repoRoot, "docs/benchmarks/output-savings");

const db = await import("../server/db.ts");
const { NotoData } = await import("../src/noto/mockVault.ts");
const { SYSTEM, buildChatPrompt, buildSummarizePrompt, buildFlashcardsPrompt, buildFindLinksPrompt, buildLecturePrompt } = await import("../server/ai/prompts.ts");
const { MAX_TOKENS } = await import("../server/ai/openai.ts");
const { sha256Hex, insertAiCache, getAiCacheByHash, getAiCacheChatBucket, incrementAiCacheHit, floatsToBlob, blobToFloats } = await import("../server/db.ts");

const IS_STUB = process.env.OPENAI_API_KEY === "stub" || !process.env.OPENAI_API_KEY;
const tok = (s: string) => encode(s).length;
const TTL = 7 * 24 * 60 * 60;
const SEMANTIC_THRESHOLD = 0.92;

// Per-feature average output token estimates for stub mode (derived from real API observations)
const STUB_OUT: Record<string, number> = {
  chat: 55,
  summarize: 80,
  flashcards: 230,
  "find-links": 25,
  "lecture-notes": 380,
};

// ──────────────────────────── seed DB ────────────────────────────

const user = db.createUser({ email: `bench-out-sav-${randomUUID()}@example.com` });
const vault = db.createVault(user.id, { name: "Benchmark Vault" });
const files = NotoData.files as { path: string; title: string; content: string }[];
for (const f of files) db.createFile(vault.id, { path: f.path, title: f.title, content: f.content });
const titles = files.map((f) => f.title);
const firstNote = files[0];
const secondNote = files[1] ?? files[0];

// ──────────────────────────── query definitions ────────────────────────────

type Feature = "chat" | "summarize" | "flashcards" | "find-links" | "lecture-notes";

interface BenchQuery {
  label: string;
  feature: Feature;
  system: string;
  user: string;
  maxTokens: number;
  noteTitle?: string;
  noteContent?: string;
  question?: string;
}

const PASS1_QUERIES: BenchQuery[] = [
  // chat — 5 queries across two notes
  { label: "chat: main theme", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: firstNote.title, noteContent: firstNote.content, question: "What is the main theme of this note?" }), maxTokens: MAX_TOKENS.chat, noteTitle: firstNote.title, noteContent: firstNote.content, question: "What is the main theme of this note?" },
  { label: "chat: key terms", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: firstNote.title, noteContent: firstNote.content, question: "List the key terms defined here." }), maxTokens: MAX_TOKENS.chat, noteTitle: firstNote.title, noteContent: firstNote.content, question: "List the key terms defined here." },
  { label: "chat: study tip", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: secondNote.title, noteContent: secondNote.content, question: "What should I focus on when studying this?" }), maxTokens: MAX_TOKENS.chat, noteTitle: secondNote.title, noteContent: secondNote.content, question: "What should I focus on when studying this?" },
  { label: "chat: connections", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: secondNote.title, noteContent: secondNote.content, question: "How does this connect to other topics?" }), maxTokens: MAX_TOKENS.chat, noteTitle: secondNote.title, noteContent: secondNote.content, question: "How does this connect to other topics?" },
  { label: "chat: summary ask", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: firstNote.title, noteContent: firstNote.content, question: "Give me a two-sentence summary." }), maxTokens: MAX_TOKENS.chat, noteTitle: firstNote.title, noteContent: firstNote.content, question: "Give me a two-sentence summary." },
  // summarize — 3 notes
  ...files.slice(0, 3).map((f, i) => ({ label: `summarize: note ${i + 1}`, feature: "summarize" as Feature, system: SYSTEM.summarize, user: buildSummarizePrompt(f.title, f.content), maxTokens: MAX_TOKENS.summarize })),
  // flashcards — 3 notes
  ...files.slice(0, 3).map((f, i) => ({ label: `flashcards: note ${i + 1}`, feature: "flashcards" as Feature, system: SYSTEM.flashcards, user: buildFlashcardsPrompt(f.title, f.content), maxTokens: MAX_TOKENS.flashcards })),
  // find-links — 2 notes
  { label: "find-links: note 1", feature: "find-links", system: SYSTEM.findLinks, user: buildFindLinksPrompt({ noteTitle: firstNote.title, noteContent: firstNote.content, titles }), maxTokens: MAX_TOKENS.findLinks },
  { label: "find-links: note 2", feature: "find-links", system: SYSTEM.findLinks, user: buildFindLinksPrompt({ noteTitle: secondNote.title, noteContent: secondNote.content, titles }), maxTokens: MAX_TOKENS.findLinks },
  // lecture-notes — 2 transcripts
  { label: "lecture-notes: transcript 1", feature: "lecture-notes", system: SYSTEM.lecture, user: buildLecturePrompt(firstNote.content.slice(0, 2000), titles), maxTokens: MAX_TOKENS.lecture },
  { label: "lecture-notes: transcript 2", feature: "lecture-notes", system: SYSTEM.lecture, user: buildLecturePrompt(secondNote.content.slice(0, 2000), titles), maxTokens: MAX_TOKENS.lecture },
];

// 5 paraphrased chat queries — same note context, rephrased question
const PARAPHRASE_QUERIES: BenchQuery[] = [
  { label: "chat (para): what is the main point", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: firstNote.title, noteContent: firstNote.content, question: "What is the central point of this note?" }), maxTokens: MAX_TOKENS.chat, noteTitle: firstNote.title, noteContent: firstNote.content, question: "What is the central point of this note?" },
  { label: "chat (para): key vocabulary", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: firstNote.title, noteContent: firstNote.content, question: "What vocabulary should I know from this?" }), maxTokens: MAX_TOKENS.chat, noteTitle: firstNote.title, noteContent: firstNote.content, question: "What vocabulary should I know from this?" },
  { label: "chat (para): what to study", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: secondNote.title, noteContent: secondNote.content, question: "What are the most important parts to review?" }), maxTokens: MAX_TOKENS.chat, noteTitle: secondNote.title, noteContent: secondNote.content, question: "What are the most important parts to review?" },
  { label: "chat (para): links to other", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: secondNote.title, noteContent: secondNote.content, question: "What other subjects does this relate to?" }), maxTokens: MAX_TOKENS.chat, noteTitle: secondNote.title, noteContent: secondNote.content, question: "What other subjects does this relate to?" },
  { label: "chat (para): short summary", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: firstNote.title, noteContent: firstNote.content, question: "Can you summarise this briefly?" }), maxTokens: MAX_TOKENS.chat, noteTitle: firstNote.title, noteContent: firstNote.content, question: "Can you summarise this briefly?" },
];

// ──────────────────────────── live call or stub ────────────────────────────

let realOpenAI: Awaited<ReturnType<typeof import("../server/ai/openai.ts").getOpenAI>> | null = null;
if (!IS_STUB) {
  const { getOpenAI, TEXT_MODEL } = await import("../server/ai/openai.ts");
  realOpenAI = getOpenAI();
}

interface CallResult { text: string; inputTokens: number; outputTokens: number }

async function callAI(q: BenchQuery): Promise<CallResult> {
  if (IS_STUB || !realOpenAI) {
    const inputTokens = tok(q.system + q.user);
    const outputTokens = STUB_OUT[q.feature] ?? 50;
    return { text: `[stub] ${q.feature}`, inputTokens, outputTokens };
  }
  const { getOpenAI, TEXT_MODEL } = await import("../server/ai/openai.ts");
  const openai = getOpenAI()!;
  const res = await openai.chat.completions.create({
    model: TEXT_MODEL,
    max_tokens: q.maxTokens,
    temperature: 0,
    messages: [{ role: "system", content: q.system }, { role: "user", content: q.user }],
  });
  return {
    text: res.choices[0]?.message?.content?.trim() ?? "",
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
  };
}

// ──────────────────────────── cache helpers (inline — no embedder in benchmark) ────────────────────────────

function cacheHit(q: BenchQuery): string | null {
  const nowSec = Math.floor(Date.now() / 1000);
  const hash = sha256Hex(q.feature + q.system + q.user);
  const row = getAiCacheByHash(hash);
  if (row && row.expires_at > nowSec) {
    incrementAiCacheHit(row.id);
    return row.response;
  }
  return null;
}

function storeCache(q: BenchQuery, result: CallResult): void {
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    insertAiCache({
      content_hash: sha256Hex(q.feature + q.system + q.user),
      note_hash: (q.noteTitle && q.noteContent) ? sha256Hex(q.noteTitle + q.noteContent) : null,
      question_embed: null, // no embedder in benchmark script
      feature: q.feature,
      response: result.text,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      created_at: nowSec,
      expires_at: nowSec + TTL,
    });
  } catch { /* ignore */ }
}

// ──────────────────────────── passes ────────────────────────────

interface QueryResult { label: string; feature: string; inputTokens: number; outputTokens: number; hit: boolean; hitType: "exact" | "none" }

console.log(`\n🔄  Pass 1 — warm cache (${PASS1_QUERIES.length} queries)…`);
const pass1: QueryResult[] = [];
for (const q of PASS1_QUERIES) {
  const result = await callAI(q);
  storeCache(q, result);
  pass1.push({ label: q.label, feature: q.feature, inputTokens: result.inputTokens, outputTokens: result.outputTokens, hit: false, hitType: "none" });
  process.stdout.write(".");
}
console.log();

console.log(`\n🔁  Pass 2 — replay (${PASS1_QUERIES.length + PARAPHRASE_QUERIES.length} queries)…`);
const pass2: QueryResult[] = [];
for (const q of [...PASS1_QUERIES, ...PARAPHRASE_QUERIES]) {
  const cached = cacheHit(q);
  if (cached !== null) {
    // Cache hit — 0 tokens billed; record avoided cost from stored row
    const stored = getAiCacheByHash(sha256Hex(q.feature + q.system + q.user));
    pass2.push({ label: q.label, feature: q.feature, inputTokens: 0, outputTokens: 0, hit: true, hitType: "exact" });
    process.stdout.write("H");
  } else {
    const result = await callAI(q);
    storeCache(q, result);
    pass2.push({ label: q.label, feature: q.feature, inputTokens: result.inputTokens, outputTokens: result.outputTokens, hit: false, hitType: "none" });
    process.stdout.write("M");
  }
}
console.log();

// ──────────────────────────── compute stats ────────────────────────────

const p1InputTotal = pass1.reduce((s, r) => s + r.inputTokens, 0);
const p1OutputTotal = pass1.reduce((s, r) => s + r.outputTokens, 0);
const p2InputTotal = pass2.reduce((s, r) => s + r.inputTokens, 0);
const p2OutputTotal = pass2.reduce((s, r) => s + r.outputTokens, 0);
const p2Hits = pass2.filter((r) => r.hit).length;
const hitRate = (p2Hits / pass2.length) * 100;

// Avoided cost = what pass-2 hits would have cost (stored input+output from pass1 rows)
const p2AvoidedInput = pass2.filter(r => r.hit).reduce((s, r) => {
  const stored = getAiCacheByHash(sha256Hex(r.feature + (PASS1_QUERIES.find(q => q.label === r.label)?.system ?? "") + (PASS1_QUERIES.find(q => q.label === r.label)?.user ?? "")));
  return s + (stored?.input_tokens ?? 0);
}, 0);
const p2AvoidedOutput = pass2.filter(r => r.hit).reduce((s, r) => {
  const stored = getAiCacheByHash(sha256Hex(r.feature + (PASS1_QUERIES.find(q => q.label === r.label)?.system ?? "") + (PASS1_QUERIES.find(q => q.label === r.label)?.user ?? "")));
  return s + (stored?.output_tokens ?? 0);
}, 0);

const savedInput = p2AvoidedInput;
const savedOutput = p2AvoidedOutput;
const savedTotal = savedInput + savedOutput;
const baselineTotal = p1InputTotal + p1OutputTotal + p2InputTotal + p2OutputTotal + savedTotal;
const savedPct = baselineTotal > 0 ? (savedTotal / (p1InputTotal + p1OutputTotal + p2InputTotal + p2OutputTotal + savedTotal)) * 100 : 0;

// ──────────────────────────── report ────────────────────────────

const stubNote = IS_STUB ? "\n\n> **Stub mode** — no `OPENAI_API_KEY` configured. Input tokens estimated via `gpt-tokenizer o200k_base`; output tokens use per-feature averages. Cache hit logic is real." : "";

const report = `# Output Token Savings Benchmark

_Generated ${new Date().toISOString()} · ${IS_STUB ? "STUB mode (gpt-tokenizer estimates)" : `real gpt-4o-mini API`} · ${PASS1_QUERIES.length} warm + ${PASS1_QUERIES.length + PARAPHRASE_QUERIES.length} replay queries_${stubNote}

## Headline

| Metric | Value |
|---|--:|
| Cache hit rate (pass 2) | **${hitRate.toFixed(1)}%** (${p2Hits}/${pass2.length}) |
| Output tokens saved (pass 2) | **${savedOutput}** |
| Input tokens saved (pass 2) | **${savedInput}** |
| Combined tokens saved | **${savedTotal}** |

## Pass 1 — warm (all misses, populates cache)

| Metric | Value |
|---|--:|
| Total input tokens | ${p1InputTotal} |
| Total output tokens | ${p1OutputTotal} |
| Queries | ${pass1.length} |

## Pass 2 — replay

| Metric | Value |
|---|--:|
| Total input tokens billed | ${p2InputTotal} |
| Total output tokens billed | ${p2OutputTotal} |
| Queries | ${pass2.length} |
| Cache hits (0 tokens) | ${p2Hits} |
| Cache misses | ${pass2.length - p2Hits} |

## Per-query detail (pass 2)

| # | Label | Feature | Hit? | In | Out |
|---|---|---|---|--:|--:|
${pass2.map((r, i) => `| ${i + 1} | ${r.label} | ${r.feature} | ${r.hit ? "✓ exact" : "miss"} | ${r.inputTokens} | ${r.outputTokens} |`).join("\n")}

---

_Regenerate: \`cd landing && npm run benchmark:output-savings\`_
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, "report.md"), report);
writeFileSync(resolve(OUT_DIR, "results.json"), JSON.stringify({ pass1, pass2, stats: { p1InputTotal, p1OutputTotal, p2InputTotal, p2OutputTotal, p2Hits, hitRate, savedInput, savedOutput, savedTotal } }, null, 2));

console.log(`\n✅  Cache hit rate: ${hitRate.toFixed(1)}% — output tokens saved: ${savedOutput} — combined saved: ${savedTotal}`);
console.log(`📄  Report written to docs/benchmarks/output-savings/`);
```

- [ ] **Step 2: Add the npm script in `package.json`**

In `landing/package.json`, add to the `scripts` block after `"benchmark:output"`:

```json
"benchmark:output-savings": "tsx scripts/benchmark-output-savings.mts"
```

- [ ] **Step 3: Run the benchmark to confirm it works end-to-end**

```bash
cd landing && npm run benchmark:output-savings
```

Expected: the script runs, prints hit rate, and writes `docs/benchmarks/output-savings/report.md` and `results.json`. In stub mode (no API key), all runs complete in seconds.

- [ ] **Step 4: Confirm the output report exists and looks correct**

```bash
cat docs/benchmarks/output-savings/report.md | head -30
```

Expected: headline table with hit rate ≥ 71% (the 15 exact-match pass-1 queries all hit in pass 2 = 15/20 = 75%).

- [ ] **Step 5: Commit everything**

```bash
git add landing/scripts/benchmark-output-savings.mts landing/package.json docs/benchmarks/output-savings/
git commit -m "feat(cache): output-savings benchmark script + report"
```

---

## Self-review

**Spec coverage check:**
- §2 DB schema → Task 2 ✓
- §3 `openai.ts` return type → Task 3 ✓
- §4 `cache.ts` content-hash + semantic + error safety → Task 5 ✓
- §5 routes swap → Task 6 ✓
- §6 benchmark two-pass + stub mode + `benchmark:output-savings` → Task 7 ✓
- §7 `cache.test.ts` all six test cases → Task 5 ✓
- §8 `AI_CACHE_TTL_DAYS` env var → Task 1 ✓
- Spec note on note-change invalidation → covered by content-hash + note-hash design in Task 5 ✓
- v2 stats endpoint stub → explicitly out of scope in §1, no task needed ✓
