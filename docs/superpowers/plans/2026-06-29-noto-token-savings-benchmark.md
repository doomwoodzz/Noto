# Token-Savings Benchmark — Plan

> **For agentic workers:** this is a measurement task, not a feature build. Steps use checkbox (`- [ ]`) syntax for tracking. There is no UI and no TDD red/green loop — the deliverable is a runnable script plus a report.

**Goal:** Quantify and visualize the input-token savings the Noto shared-memory / semantic-retrieval layer (SP1–SP5a + the one-click MCP Connect work) delivers, versus a naive "stuff everything into context" baseline, using a real tokenizer over the repo's own fixture data.

**Architecture:** A standalone script (`landing/scripts/benchmark-token-savings.mts`, run via `tsx`) imports the *real* server retrieval modules — `db.ts`, `search/semantic.ts`, `search/embedNote.ts`, the vendored MiniLM `embedder` — against a fresh `:memory:` SQLite DB. It seeds a user with the repo's mock vault notes plus a realistic accumulated-memory corpus, backfills embeddings exactly as the server does on write, then runs a set of representative queries. For each query it tokenizes (a) the **baseline** context and (b) the **optimized** context, computes savings, writes `results.json`, renders SVG charts, and assembles HTML + Markdown reports.

**Tech Stack:** `tsx` (already a dev dep); `node:sqlite` in-memory DB; `@huggingface/transformers` vendored model (already present at `landing/public/models/`); `gpt-tokenizer` (added, dev dep — `o200k_base`, the GPT-4o/`o200k` encoding, used as a provider-neutral token proxy); hand-rolled SVG charts (no native canvas dep).

---

## Definitions

**"Token saving"** = the reduction in **input (prompt) tokens** an LLM agent must consume to have the relevant context for a query, when context is assembled by semantic retrieval (top-K) instead of by dumping the whole corpus.

We measure **input tokens only** — that is where retrieval acts. Output tokens are unaffected by retrieval and are out of scope.

**Baseline (naive, no retrieval):** the agent has no index, so on every turn it pastes the *entire* corpus into the prompt to be safe — all note bodies + the full active-memory store, serialized the way an agent would receive them (JSON, matching the MCP tool-result envelope). This is the honest worst-case for a "no retrieval" integration and the strongest motivation for the layer.

**Optimized (shared-memory MCP path):** for each query we call the *actual* `semanticSearchNotes()` and `semanticRecall()` functions — FTS5 + MiniLM cosine, 0.25 floor, top-K — and serialize only the returned hits, exactly as the `noto-mcp` `search_notes` / `recall` tools return them to the model. K defaults to the MCP defaults.

Per query: `saved = baseline − optimized`; `pct = saved / baseline`. We also report the **session total** (sum over all queries — the realistic compounding effect, since a naive agent re-dumps the corpus every turn).

---

## Scenarios compared

1. **Notes retrieval** — query → relevant note passages. Baseline = all note bodies; optimized = `semanticSearchNotes` top-K.
2. **Memory recall** — query → relevant remembered facts. Baseline = full active-memory store; optimized = `semanticRecall` top-K.
3. **Combined** — a turn needing both notes + memory (the real agent case). Baseline = everything; optimized = both top-K sets.
4. **Corpus-scaling projection** — re-run scenario 3 as the corpus grows (the real fixture, then progressively extended) to show savings scale with corpus size. Extended entries are clearly flagged as synthetic in the report.

Queries: a fixed, representative set covering biology / history / study-habit / project topics present in the fixtures, plus a couple of paraphrase queries (no keyword overlap) to exercise semantic — not lexical — matching.

---

## Fixtures (from the repo)

- **Notes:** the mock vault (`landing/src/noto/mockVault.ts`) — 11 real Noto notes across Biology / History / Mathematics / Literature / AI Lecture Notes.
- **Memories:** a curated corpus modeled on the repo's own memory style (`type` ∈ user/feedback/project/reference) — study preferences, course facts, project constraints. Real fixture for scenarios 1–3.
- **Extended corpus (scenario 4 only):** programmatically generated extra notes/memories in the same shape, labeled synthetic, used solely to plot the scaling curve.

---

## Output

All under `docs/benchmarks/token-savings/`:
- `results.json` — raw per-query + summary numbers (committed, so the report is reproducible/diffable).
- `chart-per-query.svg` — grouped bars: baseline vs optimized input tokens per query.
- `chart-savings-pct.svg` — bars: % token reduction per query.
- `chart-scaling.svg` — line: % savings vs corpus size.
- `report.html` — embeds the charts + the summary-statistics table.
- `report.md` — same content in Markdown for in-repo viewing.

Summary statistics table: mean / median / min / max / total for baseline, optimized, saved, and % savings.

---

## Tasks

- [ ] **Task 1 — Plan doc** (this file).
- [ ] **Task 2 — Benchmark script.** Seed `:memory:` DB with mock vault + memory corpus; backfill embeddings; warm the embedder; define query set + scenarios; tokenize baseline vs optimized with `gpt-tokenizer`; compute per-query + summary stats; write `results.json`.
- [ ] **Task 3 — Charts + report.** Render the three SVGs from `results.json`; assemble `report.html` + `report.md` with embedded charts and the stats table.
- [ ] **Task 4 — Wire + run.** Add `npm run benchmark:tokens` (script → charts → report). Run it; capture headline numbers.
- [ ] **Task 5 — Commit.** Plan + script + generated report/charts/json, local commit on `feat/noto-web-app`. No push, no PR.

## How to regenerate

```bash
cd landing
npm run benchmark:tokens
# → writes docs/benchmarks/token-savings/{results.json, *.svg, report.html, report.md}
```
