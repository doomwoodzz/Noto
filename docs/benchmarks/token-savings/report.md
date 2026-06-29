# Noto — Shared-Memory Token-Savings Benchmark

_Generated 2026-06-29T14:43:57.790Z · tokenizer: gpt-tokenizer o200k_base (GPT-4o encoding; provider-neutral proxy) · embedder ready: **true** (real MiniLM semantic retrieval)_

## Headline

| Metric | Value |
|---|--:|
| Mean per-query token reduction | **76.3%** |
| Session-total reduction | **75.8%** |
| Tokens saved across 10 queries | **16,483** |
| Mean tokens / query (baseline → optimized) | 2,176 → 527 |

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
| Mean per-query savings | 76.3% |
| Median per-query savings | 76.8% |
| Min / Max per-query savings | 52.0% / 91.5% |
| Mean baseline tokens / query | 2,176 |
| Mean optimized tokens / query | 527 |
| Session total — baseline | 21,756 tokens |
| Session total — optimized | 5,273 tokens |
| Session total — saved | 16,483 tokens (75.8%) |

## Per-query detail

| # | Query | Scenario | Baseline | Optimized | Saved | % |
|---|---|---|--:|--:|--:|--:|
| Q1 | How do plants convert light into chemical energy? | combined | 3,108 | 959 | 2,149 | **69%** |
| Q2 | What is the role of carbon dioxide in photosynthesis? | notes | 859 | 412 | 447 | **52%** |
| Q3 | Explain how chloroplasts relate to glucose production | combined | 3,108 | 980 | 2,128 | **68%** |
| Q4 | What were the main tensions after World War II? | notes | 859 | 79 | 780 | **91%** |
| Q5 | How should I structure my study sessions? | memory | 2,249 | 522 | 1,727 | **77%** |
| Q6 | What did I decide about summarizing lectures? | memory | 2,249 | 512 | 1,737 | **77%** |
| Q7 | Themes of ambition and guilt in literature | notes | 859 | 76 | 783 | **91%** |
| Q8 | How do enzymes affect chemical reactions in cells? | combined | 3,108 | 947 | 2,161 | **70%** |
| Q9 | What is a logarithm and how does it relate to exponents? | combined | 3,108 | 263 | 2,845 | **92%** |
| Q10 | Remind me of the office hours and exam details | memory | 2,249 | 523 | 1,726 | **77%** |

## Corpus-scaling detail

| Notes in corpus | Mean baseline | Mean optimized | Mean savings |
|--:|--:|--:|--:|
| 11 | 3,115 | 779 | 75.0% |
| 31 | 6,977 | 780 | 88.8% |
| 71 | 14,822 | 785 | 94.7% |
| 151 | 30,443 | 790 | 97.4% |

---

_Corpus: landing/src/noto/mockVault.ts (real fixture) + curated Noto memory fixture (this script). Regenerate with `cd landing && npm run benchmark:tokens`._
