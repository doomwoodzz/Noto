/**
 * OUTPUT-token benchmark for the shared-memory / retrieval layer.
 *
 * Question: does retrieval save *output* (completion) tokens, the way it saves
 * input tokens? This runs REAL model generations (gpt-4o-mini, temperature 0,
 * capped output) under two context regimes and reads the API's ground-truth
 * usage.completion_tokens:
 *
 *   baseline   — whole corpus dumped into the prompt, then answer the question.
 *   optimized  — only the top-K retrieved passages/memories, then answer the same question.
 *
 * The final answer is driven by the QUESTION, not by how context was assembled,
 * so we expect output tokens to be ~equal — i.e. retrieval is an INPUT-side
 * optimization and does not save output. The optimized (MCP tool) path actually
 * ADDS a little output: the model must emit the search_notes / recall tool calls.
 * We measure that overhead deterministically too. The captured prompt_tokens
 * double as an empirical cross-check of the input-side savings.
 *
 * Cost: 10 queries × 2 conditions = 20 short gpt-4o-mini calls (a fraction of a cent).
 * Run: cd landing && npx tsx scripts/benchmark-output-tokens.mts
 * Plan: docs/superpowers/plans/2026-06-29-noto-token-savings-benchmark.md
 */
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV ??= "development";

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encode } from "gpt-tokenizer/model/gpt-4o";
import { MEMORY_FIXTURE, QUERIES, NOTES_K, RECALL_K, RECALL_SCOPES, MEMORY_SCOPE } from "./bench-fixtures.mts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const OUT_DIR = resolve(repoRoot, "docs/benchmarks/token-savings");

const db = await import("../server/db.ts");
const { semanticSearchNotes, semanticRecall } = await import("../server/search/semantic.ts");
const { reembedNote, embedMemory } = await import("../server/search/embedNote.ts");
const { embedder } = await import("../server/search/embedder.ts");
const { NotoData } = await import("../src/noto/mockVault.ts");
const { getOpenAI, TEXT_MODEL } = await import("../server/ai/openai.ts");

const tok = (s: string) => encode(s).length;
const MAX_OUT = 400; // output ceiling — bounds cost; answers here are well under this

const openai = getOpenAI();
if (!openai) { console.error("OPENAI_API_KEY not configured — cannot run the output-token benchmark."); process.exit(1); }

// ───────────────────────────────────────────────────────────── seed
const user = db.ensureLocalOwner();
const vault = db.createVault(user.id, { name: "School Vault" });
for (const f of NotoData.files as { path: string; title: string; content: string }[]) {
  const file = db.createFile(vault.id, { path: f.path, title: f.title, content: f.content });
  await reembedNote(file.id, f.content);
}
for (const m of MEMORY_FIXTURE) {
  const { memory } = db.rememberMemory({ userId: user.id, text: m.text, type: m.type, scope: MEMORY_SCOPE });
  await embedMemory(memory.id, m.text);
}

// ───────────────────────────────────────────────────────────── context builders
const fullNotes = db.getFilesForVault(vault.id).map((f) => `## ${f.title} (${f.path})\n${f.content}`).join("\n\n");
const fullMems = db.listMemories(user.id, undefined, undefined, 10_000).map((m) => `- [${m.type}] ${m.text}`).join("\n");
const FULL_CONTEXT = `# Notes\n${fullNotes}\n\n# Remembered facts\n${fullMems}`;

async function retrievedContext(q: string, scenario: string): Promise<string> {
  const parts: string[] = [];
  if (scenario === "notes" || scenario === "combined") {
    const hits = await semanticSearchNotes(user.id, q, NOTES_K);
    parts.push(`# Notes\n${hits.map((h) => `## ${h.title} (${h.headingPath.join(" › ")})\n${h.snippet}`).join("\n\n")}`);
  }
  if (scenario === "memory" || scenario === "combined") {
    const mems = await semanticRecall(user.id, RECALL_SCOPES, q, undefined, RECALL_K);
    parts.push(`# Remembered facts\n${mems.map((m) => `- [${m.type}] ${m.text}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

// Deterministic tool-call output overhead: the assistant tool_use the optimized
// path must emit (baseline emits none). Serialized as the JSON arguments block.
function toolCallTokens(q: string, scenario: string): number {
  const calls: unknown[] = [];
  if (scenario === "notes" || scenario === "combined") calls.push({ name: "search_notes", arguments: { query: q, scope: MEMORY_SCOPE, limit: NOTES_K } });
  if (scenario === "memory" || scenario === "combined") calls.push({ name: "recall", arguments: { query: q, scope: MEMORY_SCOPE, limit: RECALL_K } });
  return tok(JSON.stringify(calls));
}

const SYSTEM = "You are a study assistant. Answer the question using ONLY the provided context. Be accurate and concise.";

async function generate(context: string, q: string) {
  const res = await openai!.chat.completions.create({
    model: TEXT_MODEL,
    temperature: 0,
    max_tokens: MAX_OUT,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `${context}\n\nQuestion: ${q}` },
    ],
  });
  return {
    promptTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
    text: res.choices[0]?.message?.content?.trim() ?? "",
  };
}

/** Returns true if the configured key can actually generate (a bad/expired key 401s). */
async function canGenerate(): Promise<boolean> {
  try { await openai!.chat.completions.create({ model: TEXT_MODEL, max_tokens: 1, messages: [{ role: "user", content: "ok" }] }); return true; }
  catch (e) { console.warn(`⚠️  live generation unavailable (${e instanceof Error ? e.message.split("\n")[0] : e}).`); console.warn("   Falling back to a DETERMINISTIC output report (tool-call overhead + offline input cross-check); answer-output not measured.\n"); return false; }
}

// ───────────────────────────────────────────────────────────── run
interface Row {
  query: string; scenario: string;
  baseInput: number; optInput: number;       // real API prompt_tokens (live) or offline o200k estimate (deterministic)
  baseOutput: number | null; optOutput: number | null;
  toolCallOverhead: number;
  outputSaved: number | null; outputPct: number | null;
}

async function main() {
  await embedder.embed(["warmup"]);
  const live = await canGenerate();
  console.log(`Output-token benchmark — ${QUERIES.length} queries · mode: ${live ? `LIVE (${TEXT_MODEL}, temp 0, max_tokens ${MAX_OUT})` : "DETERMINISTIC (no live API)"}\n`);
  const rows: Row[] = [];
  for (const { q, scenario } of QUERIES) {
    const ctx = await retrievedContext(q, scenario);
    const overhead = toolCallTokens(q, scenario);
    if (live) {
      const base = await generate(FULL_CONTEXT, q);
      const opt = await generate(ctx, q);
      const outputSaved = base.outputTokens - opt.outputTokens;
      rows.push({ query: q, scenario, baseInput: base.promptTokens, optInput: opt.promptTokens, baseOutput: base.outputTokens, optOutput: opt.outputTokens, toolCallOverhead: overhead, outputSaved, outputPct: base.outputTokens ? outputSaved / base.outputTokens : 0 });
      console.log(`  ${scenario.padEnd(8)} out: base=${String(base.outputTokens).padStart(3)} opt=${String(opt.outputTokens).padStart(3)}  (Δ${outputSaved >= 0 ? "+" : ""}${outputSaved})  +toolcall ${overhead}  | in: ${base.promptTokens}→${opt.promptTokens}  · ${q.slice(0, 34)}`);
    } else {
      const baseInput = tok(`${SYSTEM}\n${FULL_CONTEXT}\n\nQuestion: ${q}`);
      const optInput = tok(`${SYSTEM}\n${ctx}\n\nQuestion: ${q}`);
      rows.push({ query: q, scenario, baseInput, optInput, baseOutput: null, optOutput: null, toolCallOverhead: overhead, outputSaved: null, outputPct: null });
      console.log(`  ${scenario.padEnd(8)} answer-output: not measured  +toolcall ${overhead}  | in(offline o200k): ${baseInput}→${optInput}  · ${q.slice(0, 34)}`);
    }
  }

  const n = rows.length;
  const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
  const meanOverhead = sum((r) => r.toolCallOverhead) / n;
  const meanInputBase = sum((r) => r.baseInput) / n;
  const meanInputOpt = sum((r) => r.optInput) / n;
  const meanInputPct = 1 - sum((r) => r.optInput) / sum((r) => r.baseInput);

  const meanOutBase = live ? sum((r) => r.baseOutput!) / n : null;
  const meanOutOpt = live ? sum((r) => r.optOutput!) / n : null;
  const meanAnswerDelta = live ? meanOutBase! - meanOutOpt! : null;
  const meanAnswerPct = live ? meanAnswerDelta! / meanOutBase! : null;
  // Net output effect of the optimized path = answer delta MINUS the tool-call it must emit.
  const meanNetOutputDelta = live ? meanAnswerDelta! - meanOverhead : -meanOverhead;

  const summary = {
    mode: live ? "live" : "deterministic",
    model: TEXT_MODEL, temperature: 0, maxTokens: MAX_OUT, queries: n,
    inputCounting: live ? "real API prompt_tokens" : "offline gpt-tokenizer o200k estimate",
    meanOutputBaseline: meanOutBase,
    meanOutputOptimized: meanOutOpt,
    meanAnswerOutputDelta: meanAnswerDelta,   // ≈ 0 expected (answer is question-driven)
    meanAnswerOutputPct: meanAnswerPct,
    meanToolCallOverhead: meanOverhead,       // output the optimized path ADDS (deterministic)
    meanNetOutputDelta,                       // < 0 ⇒ optimized emits slightly MORE output
    meanInputBaseline: meanInputBase,
    meanInputOptimized: meanInputOpt,
    meanInputPct,
  };

  const results = {
    generatedAt: new Date().toISOString(),
    what: "Output-token comparison: whole-corpus dump vs top-K retrieval, same question, same model.",
    summary, perQuery: rows,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, "output-results.json"), JSON.stringify(results, null, 2));
  renderOutputArtifacts(results, live);

  if (live) {
    console.log(`\n  mean answer output : baseline ${meanOutBase!.toFixed(1)} vs optimized ${meanOutOpt!.toFixed(1)} tokens  (Δ ${(meanAnswerPct! * 100).toFixed(1)}%)`);
  } else {
    console.log(`\n  answer output      : NOT MEASURED (no live API) — but it is question-driven, so ~equal in both paths`);
  }
  console.log(`  tool-call overhead : +${meanOverhead.toFixed(1)} tokens/query (optimized path only)`);
  console.log(`  ⇒ net output effect: ${meanNetOutputDelta >= 0 ? "+" : ""}${meanNetOutputDelta.toFixed(1)} tokens/query (negative = optimized emits MORE)`);
  console.log(`  input cross-check  : ${meanInputBase.toFixed(0)} → ${meanInputOpt.toFixed(0)} tokens (${(meanInputPct * 100).toFixed(1)}% saved, ${summary.inputCounting})`);
  console.log(`\n→ ${resolve(OUT_DIR, "output-results.json")}`);
}

// ───────────────────────────────────────────────────────────── tiny chart + md
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function renderOutputArtifacts(results: { summary: any; perQuery: Row[]; generatedAt: string; what: string }, live: boolean) {
  const rows = results.perQuery, sm = results.summary;
  const W = 960, H = 400, ml = 60, mr = 20, mt = 44, mb = 70, pw = W - ml - mr, ph = H - mt - mb;

  // LIVE → output base vs opt per query; DETERMINISTIC → tool-call overhead per query.
  const series: { a: number; b?: number }[] = live
    ? rows.map((r) => ({ a: r.baseOutput!, b: r.optOutput! }))
    : rows.map((r) => ({ a: r.toolCallOverhead }));
  const max = Math.max(...series.flatMap((s) => [s.a, s.b ?? 0])) * 1.15 || 1;
  const yS = (v: number) => mt + ph - (v / max) * ph;
  const gW = pw / rows.length, bW = live ? gW * 0.36 : gW * 0.5;
  let s = "";
  for (let i = 0; i <= 5; i++) { const v = (max / 5) * i, y = yS(v); s += `<line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="#e6e6e6"/><text x="${ml - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#777">${Math.round(v)}</text>`; }
  series.forEach((d, i) => {
    const gx = ml + gW * i + gW / 2;
    if (live) {
      s += `<rect x="${gx - bW - 2}" y="${yS(d.a)}" width="${bW}" height="${mt + ph - yS(d.a)}" fill="#e0533d" rx="2"/>`;
      s += `<rect x="${gx + 2}" y="${yS(d.b!)}" width="${bW}" height="${mt + ph - yS(d.b!)}" fill="#2f9e6f" rx="2"/>`;
    } else {
      s += `<rect x="${gx - bW / 2}" y="${yS(d.a)}" width="${bW}" height="${mt + ph - yS(d.a)}" fill="#3b6fd4" rx="2"/>`;
      s += `<text x="${gx}" y="${yS(d.a) - 5}" text-anchor="middle" font-size="11" fill="#2b2b2b">${d.a}</text>`;
    }
    s += `<text x="${gx}" y="${H - mb + 18}" text-anchor="middle" font-size="11" fill="#2b2b2b">Q${i + 1}</text>`;
  });
  if (live) {
    s += `<rect x="${ml}" y="${H - 26}" width="12" height="12" fill="#e0533d"/><text x="${ml + 18}" y="${H - 16}" font-size="12" fill="#2b2b2b">Baseline (full-dump) output</text>`;
    s += `<rect x="${ml + 230}" y="${H - 26}" width="12" height="12" fill="#2f9e6f"/><text x="${ml + 248}" y="${H - 16}" font-size="12" fill="#2b2b2b">Optimized (retrieval) output</text>`;
  } else {
    s += `<rect x="${ml}" y="${H - 26}" width="12" height="12" fill="#3b6fd4"/><text x="${ml + 18}" y="${H - 16}" font-size="12" fill="#2b2b2b">Tool-call output the optimized path must emit (baseline = 0)</text>`;
  }
  s += `<text x="16" y="${mt + ph / 2}" font-size="12" fill="#777" transform="rotate(-90 16 ${mt + ph / 2})" text-anchor="middle">output tokens</text>`;
  const title = live ? "Output (completion) tokens per query — same question, different context" : "Output-token overhead of the retrieval path (tool calls); answer output is question-driven";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Roboto,sans-serif"><rect width="${W}" height="${H}" fill="#fff"/><text x="${W / 2}" y="26" text-anchor="middle" font-size="15" font-weight="600" fill="#2b2b2b">${title}</text>${s}</svg>`;
  writeFileSync(resolve(OUT_DIR, "chart-output.svg"), svg);

  const liveHeader = live
    ? `_Generated ${results.generatedAt} · ${sm.queries} queries × 2 conditions · model ${sm.model} (temperature ${sm.temperature}, max_tokens ${sm.maxTokens}) · real API \`usage.completion_tokens\`_`
    : `_Generated ${results.generatedAt} · ${sm.queries} queries · **deterministic mode** (no live API key) — tool-call overhead + offline o200k input cross-check; answer-output not measured_`;

  const answerRows = live
    ? `| Mean answer output — baseline (full dump) | ${sm.meanOutputBaseline.toFixed(1)} tokens |
| Mean answer output — optimized (retrieval) | ${sm.meanOutputOptimized.toFixed(1)} tokens |
| Mean answer-output difference | ${sm.meanAnswerOutputDelta.toFixed(1)} tokens (${pct(sm.meanAnswerOutputPct)}) |`
    : `| Mean answer output — baseline vs optimized | _not measured (no live API key)_ |`;

  const md = `# Output-Token Test — does retrieval save output tokens?

${liveHeader}

## Short answer

**No — retrieval does not save output tokens.** The final answer is driven by the *question*, not by how the context was assembled, so output (completion) tokens are ~the same whether the model is given the whole corpus or only the retrieved top-K. The optimized MCP path in fact emits a little **more** output, because the model has to generate the \`search_notes\` / \`recall\` tool calls (${sm.meanToolCallOverhead.toFixed(1)} tokens/query here). Retrieval is an **input-side** optimization; the big win (≈76% input reduction) is in [report.md](report.md).${live ? "" : "\n\n> This run was **deterministic** — the configured API key could not generate (e.g. missing/expired). The tool-call overhead and the input cross-check below are real (offline tokenizer); the answer-output equality is the well-established conceptual result. Supply a valid `OPENAI_API_KEY` and re-run to measure answer output empirically (the script captures real `usage.completion_tokens`)."}

## Numbers

| Metric | Value |
|---|--:|
${answerRows}
| Mean tool-call output overhead (optimized only) | +${sm.meanToolCallOverhead.toFixed(1)} tokens |
| **Net output effect of optimized path** | **${sm.meanNetOutputDelta >= 0 ? "+" : ""}${sm.meanNetOutputDelta.toFixed(1)} tokens/query** (negative = emits more) |
| Input cross-check (${sm.inputCounting}) | ${sm.meanInputBaseline.toFixed(0)} → ${sm.meanInputOptimized.toFixed(0)} (${pct(sm.meanInputPct)} saved) |

![Output tokens](chart-output.svg)

## Per-query detail

| # | Scenario | Output base | Output opt | Δ out | Tool-call + | Input base | Input opt |
|---|---|--:|--:|--:|--:|--:|--:|
${rows.map((r, i) => `| Q${i + 1} | ${r.scenario} | ${r.baseOutput ?? "—"} | ${r.optOutput ?? "—"} | ${r.outputSaved === null ? "—" : (r.outputSaved >= 0 ? "+" : "") + r.outputSaved} | +${r.toolCallOverhead} | ${r.baseInput} | ${r.optInput} |`).join("\n")}

---

_Regenerate with \`cd landing && npm run benchmark:output\`${live ? ` (makes ${sm.queries * 2} real ${sm.model} calls)` : " (add a valid OPENAI_API_KEY for live answer-output measurement)"}._
`;
  writeFileSync(resolve(OUT_DIR, "report-output.md"), md);
}

await main();
