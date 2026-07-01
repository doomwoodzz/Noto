# Noto — Shared-Memory Token-Savings Benchmark

_Generated 2026-06-30T14:28:58.830Z · tokenizer: gpt-tokenizer o200k_base (GPT-4o encoding; provider-neutral proxy) · embedder ready: **true** (real MiniLM semantic retrieval)_

## Headline

| Metric | Value |
|---|--:|
| Mean per-query token reduction | **78.7%** |
| Session-total reduction | **77.7%** |
| Tokens saved across 10 queries | **18,146** |
| Mean tokens / query (baseline → optimized) | 2,337 → 522 |

## What this measures

- **Baseline** (naive, no retrieval): dump the whole corpus — all 11 note bodies + the full active-memory store (30 memories) — into the prompt, serialized as the JSON the MCP tool layer hands the model.
- **Optimized** (shared-memory MCP path): the real `semanticSearchNotes` / `semanticRecall` (FTS5 + MiniLM cosine, 0.25 floor) returning only the top-K hits (notes K=5, recall K=6).
- **Token saving** = reduction in input (prompt) tokens.

## Charts

![Input tokens per query](chart-per-query.svg)

![Token reduction per query](chart-savings-pct.svg)

![Savings scale with corpus size](chart-scaling.svg)

> Notes beyond the first 11 are synthetic, in the same shape, used only to plot how savings scale with corpus size.

## Summary statistics

| Statistic | Value |
|---|--:|
| Queries | 10 |
| Mean per-query savings | 78.7% |
| Median per-query savings | 76.8% |
| Min / Max per-query savings | 62.5% / 93.7% |
| Mean baseline tokens / query | 2,337 |
| Mean optimized tokens / query | 522 |
| Session total — baseline | 23,366 tokens |
| Session total — optimized | 5,220 tokens |
| Session total — saved | 18,146 tokens (77.7%) |

## Per-query detail

| # | Query | Scenario | Baseline | Optimized | Saved | % |
|---|---|---|--:|--:|--:|--:|
| Q1 | How do plants convert light into chemical energy? | combined | 3,338 | 950 | 2,388 | **72%** |
| Q2 | What is the role of carbon dioxide in photosynthesis? | notes | 1,104 | 414 | 690 | **63%** |
| Q3 | Explain how chloroplasts relate to glucose production | combined | 3,338 | 973 | 2,365 | **71%** |
| Q4 | What were the main tensions after World War II? | notes | 1,104 | 75 | 1,029 | **93%** |
| Q5 | How should I structure my study sessions? | memory | 2,234 | 520 | 1,714 | **77%** |
| Q6 | What did I decide about summarizing lectures? | memory | 2,234 | 504 | 1,730 | **77%** |
| Q7 | Themes of ambition and guilt in literature | notes | 1,104 | 70 | 1,034 | **94%** |
| Q8 | How do enzymes affect chemical reactions in cells? | combined | 3,338 | 939 | 2,399 | **72%** |
| Q9 | What is a logarithm and how does it relate to exponents? | combined | 3,338 | 259 | 3,079 | **92%** |
| Q10 | Remind me of the office hours and exam details | memory | 2,234 | 516 | 1,718 | **77%** |

## Output tokens?

The savings above are **input-side** (retrieval). Output (completion) tokens are **not** reduced by retrieval — they are driven by the question. Output savings come from a separate mechanism: Noto's write-back primitives (`append_note`, `update_section`, structured `remember()`). The [deep agentic-coding session](#deep-agentic-coding-session--input-and-output) below measures both directions. See also [report-output.md](report-output.md) (AI-response cache, `npm run benchmark:output`).

## Deep agentic-coding session — input *and* output

A 12-turn agent working inside a Noto vault: read context → recall memory → edit a note → record a decision → iterate.

- **Noto** = real semantic top-K retrieval (input) + `append_note`/`update_section` deltas and structured `remember()` (output).
- **Obsidian** = the conservative baseline. Out of the box it has no agent semantic-retrieval and no MCP write-back/patch layer, so an agent driving it re-feeds the whole vault each turn and re-emits whole note bodies on every edit. A raw no-tool agent is equal or worse.

| Direction | Obsidian (baseline) | Noto (optimized) | Saved | % |
|---|--:|--:|--:|--:|
| Input (context per turn) | 43,222 | 8,614 | 34,608 | **80.1%** |
| Output (tokens emitted) | 1,594 | 1,057 | 537 | **33.7%** |
| **Combined** | 44,816 | 9,671 | 35,145 | **78.4%** |

![Noto vs Obsidian](chart-platform-comparison.svg)

![Per-turn cost across the session](chart-agentic-turns.svg)

### Where output savings come from — and where they don't

Retrieval is an **input**-side win; it does not reduce output. The **output** savings come entirely from Noto's write primitives: `append_note` / `update_section` emit only the changed text instead of the whole note, and `remember()` persists a decision as one short structured write instead of restating it inline.

Honesty caveats:
- The output saving is measured against a **whole-file-rewrite** baseline. An agent harness with its own native diff/patch tool already captures part of it; Noto's contribution is providing that primitive over a *remote* notes store where the alternative is a full-body write.
- `create_note` (new files) emits full content in **both** paths — no output saving there.
- On this vault the notes are small (study notes), so the measured session output saving is a modest **33.7%**. The leverage grows with note size:

![Output savings climb with note size](chart-output-scaling.svg)

> A fixed-size edit emitted as a whole-file rewrite vs an update_section delta, over synthetic note bodies of increasing size. The delta stays flat; the rewrite scales with the note, so output savings climb toward 100% on large notes/files (the deep-agentic-coding regime). Bodies are synthetic, labeled here.

| Note size (tokens) | Rewrite (Obsidian) | Delta (Noto) | Output saved |
|--:|--:|--:|--:|
| 211 | 253 | 57 | **77.5%** |
| 500 | 542 | 60 | **88.9%** |
| 1,010 | 1,052 | 60 | **94.3%** |
| 2,013 | 2,055 | 56 | **97.3%** |
| 4,002 | 4,044 | 61 | **98.5%** |

**Assumptions (stated honestly):** Obsidian out of the box has no agent semantic-retrieval and no MCP write-back/patch layer, so an agent driving it uses full-context reads and whole-file writes — identical to the naive baseline. A raw/no-tool agent is equal or worse, so Obsidian is the conservative baseline. Output savings are vs a whole-file-rewrite baseline. An agent harness with its own native diff/patch tool already captures part of this; Noto's contribution is providing append/section-patch primitives over a remote notes store where the alternative is a full-body write. create_note (new files) emits full content in BOTH paths — no output saving there, and the session contains none.

## Corpus-scaling detail

| Notes in corpus | Mean baseline | Mean optimized | Mean savings |
|--:|--:|--:|--:|
| 11 | 3,366 | 785 | 76.7% |
| 31 | 7,252 | 788 | 89.1% |
| 71 | 15,096 | 784 | 94.8% |
| 151 | 30,639 | 779 | 97.5% |

---

_Corpus: landing/src/noto/mockVault.ts (real fixture) + curated Noto memory fixture (this script). Regenerate with `cd landing && npm run benchmark:tokens`._
