# Output Token Savings Benchmark

_Generated 2026-06-30T10:56:34.870Z · STUB mode (gpt-tokenizer estimates) · 15 warm + 20 replay queries_

> **Stub mode** — no `OPENAI_API_KEY` configured. Input tokens estimated via `gpt-tokenizer o200k_base`; output tokens use per-feature averages. Cache hit logic is real.

## Headline

| Metric | Value |
|---|--:|
| Cache hit rate (pass 2) | **75.0%** (15/20) |
| Output tokens saved (pass 2) | **2015** |
| Input tokens saved (pass 2) | **2870** |
| Combined tokens saved | **4885** |

## Pass 1 — warm (all misses, populates cache)

| Metric | Value |
|---|--:|
| Total input tokens | 2870 |
| Total output tokens | 2015 |
| Queries | 15 |

## Pass 2 — replay

| Metric | Value |
|---|--:|
| Total input tokens billed | 817 |
| Total output tokens billed | 275 |
| Queries | 20 |
| Cache hits (0 tokens) | 15 |
| Cache misses | 5 |

## Per-query detail (pass 2)

| # | Label | Feature | Hit? | In | Out |
|---|---|---|---|--:|--:|
| 1 | chat: main theme | chat | ✓ exact | 0 | 0 |
| 2 | chat: key terms | chat | ✓ exact | 0 | 0 |
| 3 | chat: study tip | chat | ✓ exact | 0 | 0 |
| 4 | chat: connections | chat | ✓ exact | 0 | 0 |
| 5 | chat: summary ask | chat | ✓ exact | 0 | 0 |
| 6 | summarize: note 1 | summarize | ✓ exact | 0 | 0 |
| 7 | summarize: note 2 | summarize | ✓ exact | 0 | 0 |
| 8 | summarize: note 3 | summarize | ✓ exact | 0 | 0 |
| 9 | flashcards: note 1 | flashcards | ✓ exact | 0 | 0 |
| 10 | flashcards: note 2 | flashcards | ✓ exact | 0 | 0 |
| 11 | flashcards: note 3 | flashcards | ✓ exact | 0 | 0 |
| 12 | find-links: note 1 | find-links | ✓ exact | 0 | 0 |
| 13 | find-links: note 2 | find-links | ✓ exact | 0 | 0 |
| 14 | lecture-notes: transcript 1 | lecture-notes | ✓ exact | 0 | 0 |
| 15 | lecture-notes: transcript 2 | lecture-notes | ✓ exact | 0 | 0 |
| 16 | chat (para): what is the main point | chat | miss | 195 | 55 |
| 17 | chat (para): key vocabulary | chat | miss | 194 | 55 |
| 18 | chat (para): what to study | chat | miss | 118 | 55 |
| 19 | chat (para): links to other | chat | miss | 117 | 55 |
| 20 | chat (para): short summary | chat | miss | 193 | 55 |

---

_Regenerate: `cd landing && npm run benchmark:output-savings`_
