# Category-Level Token Savings Benchmark

_Generated 2026-06-30T13:46:52.550Z · STUB mode · 23 queries/session_

> **Stub mode** — no `OPENAI_API_KEY` set. Input tokens via `gpt-tokenizer`; output tokens use per-feature averages. Cache hit logic is real.

## Overview

| Metric | Value |
|---|--:|
| Overall cache hit rate (session 2) | **100.0%** (23/23) |
| Total input tokens saved | **3976** |
| Total output tokens saved | **2975** |
| Combined tokens saved | **6951** |

## Session 1 Cost (cache cold)

| Metric | Value |
|---|--:|
| Total input tokens | 3976 |
| Total output tokens | 2975 |
| Total tokens | 6951 |

## Per-Category Savings (Session 2 vs Session 1 baseline)

| Category | Use Case | Queries | Input saved | Output saved | Total saved | Hit rate |
|---|---|--:|--:|--:|--:|--:|
| **Active Recall** | `chat` | 8 | 1084 | 440 | 1524 | 100.0% |
| **Content Writing** | `summarize` | 5 | 685 | 400 | 1085 | 100.0% |
| **Spaced Repetition** | `flashcards` | 4 | 633 | 920 | 1553 | 100.0% |
| **Knowledge Mapping** | `find-links` | 3 | 732 | 75 | 807 | 100.0% |
| **Lecture Capture** | `lecture-notes` | 3 | 842 | 1140 | 1982 | 100.0% |
| **TOTAL** | — | **23** | **3976** | **2975** | **6951** | **100.0%** |

## Category Notes

| Category | Why caching works here |
|---|---|
| **Active Recall** | Students ask the same questions about notes across multiple study sessions — same note + same question = exact cache hit |
| **Content Writing** | Revision summaries are generated repeatedly for the same notes during exam prep |
| **Spaced Repetition** | Flashcards for the same notes are fetched on every review interval (daily/weekly) |
| **Knowledge Mapping** | Link suggestions for a note are stable until the note's content changes |
| **Lecture Capture** | The same lecture recording may be re-processed if notes are exported or re-structured |

## Per-Query Detail (Session 2)

| # | Category | Label | Hit? | In billed | Out billed |
|---|---|---|---|--:|--:|
| 1 | Active Recall | recall: what is this note about | ✓ exact | 0 | 0 |
| 2 | Active Recall | recall: key concepts | ✓ exact | 0 | 0 |
| 3 | Active Recall | recall: explain in simple terms | ✓ exact | 0 | 0 |
| 4 | Active Recall | recall: give an example | ✓ exact | 0 | 0 |
| 5 | Active Recall | recall: study focus | ✓ exact | 0 | 0 |
| 6 | Active Recall | recall: connections | ✓ exact | 0 | 0 |
| 7 | Active Recall | recall: two-sentence summary | ✓ exact | 0 | 0 |
| 8 | Active Recall | recall: common mistakes | ✓ exact | 0 | 0 |
| 9 | Content Writing | writing: summarize note 1 | ✓ exact | 0 | 0 |
| 10 | Content Writing | writing: summarize note 2 | ✓ exact | 0 | 0 |
| 11 | Content Writing | writing: summarize note 3 | ✓ exact | 0 | 0 |
| 12 | Content Writing | writing: summarize note 4 | ✓ exact | 0 | 0 |
| 13 | Content Writing | writing: summarize note 5 | ✓ exact | 0 | 0 |
| 14 | Spaced Repetition | sr: flashcards note 1 | ✓ exact | 0 | 0 |
| 15 | Spaced Repetition | sr: flashcards note 2 | ✓ exact | 0 | 0 |
| 16 | Spaced Repetition | sr: flashcards note 3 | ✓ exact | 0 | 0 |
| 17 | Spaced Repetition | sr: flashcards note 4 | ✓ exact | 0 | 0 |
| 18 | Knowledge Mapping | map: find links note 1 | ✓ exact | 0 | 0 |
| 19 | Knowledge Mapping | map: find links note 2 | ✓ exact | 0 | 0 |
| 20 | Knowledge Mapping | map: find links note 3 | ✓ exact | 0 | 0 |
| 21 | Lecture Capture | lecture: session 1 | ✓ exact | 0 | 0 |
| 22 | Lecture Capture | lecture: session 2 | ✓ exact | 0 | 0 |
| 23 | Lecture Capture | lecture: session 3 | ✓ exact | 0 | 0 |

---

_Regenerate: `cd landing && npm run benchmark:categories`_
