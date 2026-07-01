# Noto Output Token Savings — Design

**Date:** 2026-06-30
**Status:** Approved design (brainstorm complete) — ready for `superpowers:writing-plans`
**Depends on:** The web workspace (`landing/`). Extends: `landing/server/ai/openai.ts` (the `complete()` function), `landing/server/ai/routes.ts` (all five AI routes), `landing/server/db.ts` (SQLite schema). Reuses: the MiniLM embedder already present at `landing/public/models/` and used by `landing/server/search/semantic.ts`. Pairs with: the existing input-token-savings benchmark at `docs/benchmarks/token-savings/`. Companion memory: `noto-ai-implementation`.

## 0. What this is

The existing Token Saving system (the `benchmark-token-savings` script and the shared-memory retrieval layer) cuts **input** tokens by ~76% through semantic retrieval. It explicitly does not reduce output tokens — the benchmark confirmed retrieval has zero effect on completion token spend.

This design adds a complementary system that actually reduces output tokens through **response caching**: a `completeWithCache()` function that intercepts every OpenAI text call, serves cached responses when available (0 tokens billed on a hit), and falls back to a live call on a miss. A new benchmark script measures the combined savings (input + output) to give a full-cost picture.

## 1. Scope

**In:**
- `server/ai/cache.ts` — new module exporting `completeWithCache()`. All logic for content-hash lookup, semantic fallback, TTL eviction, and cache writes lives here.
- `server/ai/openai.ts` — `complete()` return type widens from `Promise<string>` to `Promise<{text: string, inputTokens: number, outputTokens: number}>`, reading from `res.usage`.
- `server/ai/routes.ts` — all five routes (`/chat`, `/summarize`, `/flashcards`, `/find-links`, `/lecture-notes`) swap `complete()` for `completeWithCache()`. The text extraction (`reply = result`) is the only other change per route.
- `server/db.ts` — migration adding the `ai_response_cache` table and its two indexes.
- `server/ai/cache.test.ts` — unit tests for the cache layer.
- `landing/scripts/benchmark-output-savings.mts` — new benchmark script.
- `docs/benchmarks/output-savings/` — benchmark output directory (`results.json`, `report.md`, `chart-output.svg`).
- `package.json` — new `benchmark:output-savings` script entry.

**Out:**
- Output caching for the `transcribe` route — audio is always unique; a cache would never hit.
- UI surface for cache stats — purely server-side / benchmark in v1.
- Manual cache invalidation API — TTL covers the use case; no flush endpoint in v1.
- Per-user cache isolation — in v1, the cache is vault-global (same note content → same response for any user). Per-user scoping is deferred.

**v2 stub — `GET /api/ai/cache/stats`:** the schema captures everything needed for an admin stats endpoint (`hit_count`, `input_tokens`, `output_tokens`, `feature`, `created_at`). A future v2 can add this auth-gated route returning aggregate hit rate, tokens saved, and per-feature breakdown without any schema changes. No implementation in v1.

## 2. Database schema

One new table, added as a migration in `server/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS ai_response_cache (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash   TEXT    NOT NULL UNIQUE,  -- sha256(feature+system+user); exact-match key
  note_hash      TEXT,                     -- sha256(noteTitle+noteContent); chat semantic bucket
  question_embed BLOB,                     -- MiniLM F32 embedding of the question; chat only
  feature        TEXT    NOT NULL,         -- 'chat' | 'summarize' | 'flashcards' | 'find-links' | 'lecture-notes'
  response       TEXT    NOT NULL,         -- cached AI reply text
  input_tokens   INTEGER NOT NULL,         -- usage.prompt_tokens at generation time
  output_tokens  INTEGER NOT NULL,         -- usage.completion_tokens at generation time
  hit_count      INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,         -- Unix seconds
  expires_at     INTEGER NOT NULL          -- created_at + TTL; checked on every read
);

CREATE INDEX IF NOT EXISTS ai_response_cache_note
  ON ai_response_cache(note_hash);         -- narrows semantic bucket scan to same note

CREATE INDEX IF NOT EXISTS ai_response_cache_feature
  ON ai_response_cache(feature);           -- benchmark queries
```

TTL defaults to 7 days (`7 * 24 * 60 * 60` seconds). Overridable via `AI_CACHE_TTL_DAYS` in `.env`. Expired rows are evicted lazily on read — when a content-hash lookup finds an expired row, it is deleted before the call falls through to OpenAI. No background sweeper.

**Note content changes:** both the content-hash key and the semantic bucket key (`note_hash`) embed the full note content. Any change to note content produces different keys — old cache entries are never matched, so stale answers are never returned. The old entries become orphaned and are cleaned up naturally when their TTL expires (within 7 days). No explicit invalidation hook into the note write path is needed.

## 3. `openai.ts` changes

`complete()` currently returns `Promise<string>`. It changes to:

```ts
export async function complete(opts: {
  system: string;
  user: string;
  maxTokens: number;
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  // ...
  return {
    text: res.choices[0]?.message?.content?.trim() ?? "",
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
  };
}
```

Any existing direct callers outside of the AI routes (there are none in v1) would need updating, but there are none — all callers are in `routes.ts`, and all of those are being migrated to `completeWithCache()`.

## 4. `server/ai/cache.ts`

```ts
export async function completeWithCache(opts: {
  feature: 'chat' | 'summarize' | 'flashcards' | 'find-links' | 'lecture-notes';
  system: string;
  user: string;
  maxTokens: number;
  // Chat semantic bucket — only needed for the 'chat' feature:
  noteTitle?: string;
  noteContent?: string;
  question?: string;
}): Promise<string>
```

**Lookup flow:**

1. **Content-hash check** — `hash = sha256(feature + system + user)`. Query `ai_response_cache WHERE content_hash = hash AND expires_at > now()`. Hit → increment `hit_count`, return `response`. Expired hit → delete row, fall through.

2. **Semantic fallback (chat only)** — when `feature === 'chat'` and `noteTitle` / `noteContent` / `question` are all present:
   - `noteHash = sha256(noteTitle + noteContent)`
   - `queryEmbed = embed(question)` via the MiniLM embedder
   - Load all non-expired rows WHERE `feature = 'chat' AND note_hash = noteHash`
   - Compute cosine similarity between `queryEmbed` and each row's `question_embed`
   - If `bestSimilarity >= 0.92` → cache hit; increment `hit_count`, return `response`
   - If embedder unavailable → skip this step, fall through (logged at debug level)

3. **Miss** — call `complete(opts)`, receive `{text, inputTokens, outputTokens}`. Insert into `ai_response_cache`:
   - `content_hash`, `feature`, `response`, `input_tokens`, `output_tokens`, `created_at`, `expires_at`
   - For chat: also `note_hash` and `question_embed` (serialised as a `Float32Array` → `Buffer`)
   - Write failure is swallowed and logged; the response is still returned to the caller.

4. Return `text`.

**Error safety:** any SQLite error during read is caught, logged, and the function falls through to a live OpenAI call. The cache is always an optimization, never a correctness dependency.

## 5. `routes.ts` changes

Each route replaces:
```ts
const reply = await complete({ system: SYSTEM.x, user: buildXPrompt(...), maxTokens: MAX_TOKENS.x });
res.json({ reply });
```
with:
```ts
const reply = await completeWithCache({ feature: 'x', system: SYSTEM.x, user: buildXPrompt(...), maxTokens: MAX_TOKENS.x });
res.json({ reply });
```

For the `chat` route only, `noteTitle`, `noteContent`, and `question` are also passed (they are already parsed from the request body at that point).

The `handle()` wrapper and all other route logic remain unchanged.

## 6. Benchmark script

**File:** `landing/scripts/benchmark-output-savings.mts`
**Run:** `cd landing && npm run benchmark:output-savings`

Runs two passes against a fresh `:memory:` SQLite DB seeded with the mock vault fixture:

- **Pass 1 — warm (15 queries):** one call per query across all five features. Each call hits OpenAI (or the tokenizer stub), populates the cache, records `input_tokens` and `output_tokens`. Simulates a user's first session.
- **Pass 2 — replay (20 queries):** the same 15 queries plus 5 paraphrased chat variants. Exact repeats hit the content-hash cache; paraphrases hit the semantic cache or miss. `output_tokens` billed = 0 for hits. For paraphrased queries the "avoided baseline cost" is taken from the `output_tokens` stored in the matching cached row (the original call's recorded cost).

**Report metrics:**

| Metric | Description |
|---|---|
| Cache hit rate | % of pass-2 queries served from cache (exact + semantic, broken out) |
| Output tokens saved | pass-1 total − pass-2 total |
| Input tokens saved | Same subtraction for input side |
| Combined token savings | Headline: both sides together |
| Hit breakdown | Exact-match hits / semantic hits / misses |

**Stub mode:** when `OPENAI_API_KEY` is absent, `input_tokens` and `output_tokens` are estimated from `gpt-tokenizer` (same `o200k_base` encoding used by the existing benchmark). The report notes stub mode clearly — same convention as `benchmark-output-tokens.mts`.

**Output:** `docs/benchmarks/output-savings/{results.json, report.md, chart-output.svg}`

## 7. Testing

`server/ai/cache.test.ts` covers:

- Content-hash hit returns cached `response` without calling `complete()`
- Expired entry (expires_at in the past) is treated as a miss and deleted
- Semantic hit at similarity ≥ 0.92 returns cached response
- Semantic near-miss at 0.85 falls through to a live call
- Cache write stores `input_tokens` + `output_tokens` from the OpenAI response
- SQLite read error → falls through to live call without throwing
- Cache write failure → live response still returned, no throw

`routes.test.ts` stubs are updated to return `{text, inputTokens, outputTokens}` from the `complete()` mock to match the widened return type.

## 8. Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `AI_CACHE_TTL_DAYS` | `7` | Cache entry lifetime in days |

Added to `server/env.ts` alongside the existing `OPENAI_API_KEY` parsing.
