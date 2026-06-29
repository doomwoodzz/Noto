# Output-Token Test — does retrieval save output tokens?

_Generated 2026-06-29T19:14:28.349Z · 10 queries · **deterministic mode** (no live API key) — tool-call overhead + offline o200k input cross-check; answer-output not measured_

## Short answer

**No — retrieval does not save output tokens.** The final answer is driven by the *question*, not by how the context was assembled, so output (completion) tokens are ~the same whether the model is given the whole corpus or only the retrieved top-K. The optimized MCP path in fact emits a little **more** output, because the model has to generate the `search_notes` / `recall` tool calls (45.1 tokens/query here). Retrieval is an **input-side** optimization; the big win (≈76% input reduction) is in [report.md](report.md).

> This run was **deterministic** — the configured API key could not generate (e.g. missing/expired). The tool-call overhead and the input cross-check below are real (offline tokenizer); the answer-output equality is the well-established conceptual result. Supply a valid `OPENAI_API_KEY` and re-run to measure answer output empirically (the script captures real `usage.completion_tokens`).

## Numbers

| Metric | Value |
|---|--:|
| Mean answer output — baseline vs optimized | _not measured (no live API key)_ |
| Mean tool-call output overhead (optimized only) | +45.1 tokens |
| **Net output effect of optimized path** | **-45.1 tokens/query** (negative = emits more) |
| Input cross-check (offline gpt-tokenizer o200k estimate) | 1156 → 183 (84.2% saved) |

![Output tokens](chart-output.svg)

## Per-query detail

| # | Scenario | Output base | Output opt | Δ out | Tool-call + | Input base | Input opt |
|---|---|--:|--:|--:|--:|--:|--:|
| Q1 | combined | — | — | — | +62 | 1155 | 323 |
| Q2 | notes | — | — | — | +34 | 1157 | 164 |
| Q3 | combined | — | — | — | +62 | 1155 | 330 |
| Q4 | notes | — | — | — | +33 | 1156 | 52 |
| Q5 | memory | — | — | — | +31 | 1154 | 164 |
| Q6 | memory | — | — | — | +32 | 1155 | 162 |
| Q7 | notes | — | — | — | +30 | 1153 | 45 |
| Q8 | combined | — | — | — | +62 | 1155 | 305 |
| Q9 | combined | — | — | — | +72 | 1160 | 112 |
| Q10 | memory | — | — | — | +33 | 1156 | 168 |

---

_Regenerate with `cd landing && npm run benchmark:output` (add a valid OPENAI_API_KEY for live answer-output measurement)._
