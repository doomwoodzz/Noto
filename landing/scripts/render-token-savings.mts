/**
 * Renders the token-savings report from docs/benchmarks/token-savings/results.json:
 * three SVG charts + an HTML report (charts inlined) + a Markdown report.
 *
 * Run (after the benchmark): cd landing && npx tsx scripts/render-token-savings.mts
 * Plan: docs/superpowers/plans/2026-06-29-noto-token-savings-benchmark.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, "../..", "docs/benchmarks/token-savings");
const results = JSON.parse(readFileSync(resolve(OUT_DIR, "results.json"), "utf8"));

// palette
const C = { base: "#e0533d", opt: "#2f9e6f", grid: "#e6e6e6", axis: "#8a8a8a", text: "#2b2b2b", muted: "#777", line2: "#3b6fd4" };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n: number) => Math.round(n).toLocaleString();
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

// ───────────────────────────────────────────── chart 1: grouped bars per query
function chartPerQuery(): string {
  const rows = results.perQuery as { baseline: number; optimized: number }[];
  const W = 960, H = 440, ml = 70, mr = 20, mt = 40, mb = 70;
  const pw = W - ml - mr, ph = H - mt - mb;
  const max = Math.max(...rows.map((r) => r.baseline)) * 1.08;
  const yScale = (v: number) => mt + ph - (v / max) * ph;
  const groupW = pw / rows.length, barW = groupW * 0.36;

  let s = "";
  // gridlines + y labels
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i, y = yScale(v);
    s += `<line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="${C.grid}"/>`;
    s += `<text x="${ml - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="${C.muted}">${fmt(v)}</text>`;
  }
  rows.forEach((r, i) => {
    const gx = ml + groupW * i + groupW / 2;
    const bx = gx - barW - 2, ox = gx + 2;
    s += `<rect x="${bx}" y="${yScale(r.baseline)}" width="${barW}" height="${mt + ph - yScale(r.baseline)}" fill="${C.base}" rx="2"/>`;
    s += `<rect x="${ox}" y="${yScale(r.optimized)}" width="${barW}" height="${mt + ph - yScale(r.optimized)}" fill="${C.opt}" rx="2"/>`;
    s += `<text x="${gx}" y="${H - mb + 18}" text-anchor="middle" font-size="11" fill="${C.text}">Q${i + 1}</text>`;
  });
  // legend + axes
  s += `<rect x="${ml}" y="${H - 26}" width="12" height="12" fill="${C.base}"/><text x="${ml + 18}" y="${H - 16}" font-size="12" fill="${C.text}">Baseline (dump all)</text>`;
  s += `<rect x="${ml + 170}" y="${H - 26}" width="12" height="12" fill="${C.opt}"/><text x="${ml + 188}" y="${H - 16}" font-size="12" fill="${C.text}">Optimized (top-K retrieval)</text>`;
  s += `<text x="16" y="${mt + ph / 2}" font-size="12" fill="${C.muted}" transform="rotate(-90 16 ${mt + ph / 2})" text-anchor="middle">input tokens</text>`;
  return svg(W, H, "Input tokens per query — baseline vs optimized", s);
}

// ───────────────────────────────────────────── chart 2: % savings per query
function chartSavingsPct(): string {
  const rows = results.perQuery as { pct: number }[];
  const W = 960, H = 380, ml = 50, mr = 20, mt = 40, mb = 70;
  const pw = W - ml - mr, ph = H - mt - mb;
  const yScale = (v: number) => mt + ph - v * ph; // 0..1
  const groupW = pw / rows.length, barW = groupW * 0.55;

  let s = "";
  for (let i = 0; i <= 5; i++) {
    const v = i / 5, y = yScale(v);
    s += `<line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="${C.grid}"/>`;
    s += `<text x="${ml - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="${C.muted}">${v * 100}%</text>`;
  }
  rows.forEach((r, i) => {
    const gx = ml + groupW * i + groupW / 2;
    s += `<rect x="${gx - barW / 2}" y="${yScale(r.pct)}" width="${barW}" height="${mt + ph - yScale(r.pct)}" fill="${C.opt}" rx="2"/>`;
    s += `<text x="${gx}" y="${yScale(r.pct) - 6}" text-anchor="middle" font-size="11" fill="${C.text}">${(r.pct * 100).toFixed(0)}%</text>`;
    s += `<text x="${gx}" y="${H - mb + 18}" text-anchor="middle" font-size="11" fill="${C.text}">Q${i + 1}</text>`;
  });
  return svg(W, H, "Token reduction per query (%)", s);
}

// ───────────────────────────────────────────── chart 3: scaling line chart
function chartScaling(): string {
  const pts = results.scaling as { totalNotes: number; meanBaseline: number; meanOptimized: number; meanPct: number }[];
  const W = 960, H = 440, ml = 70, mr = 60, mt = 64, mb = 60;
  const pw = W - ml - mr, ph = H - mt - mb;
  const maxN = Math.max(...pts.map((p) => p.totalNotes));
  const maxT = Math.max(...pts.map((p) => p.meanBaseline)) * 1.08;
  const xScale = (n: number) => ml + (n / maxN) * pw;
  const yT = (v: number) => mt + ph - (v / maxT) * ph;
  const yPct = (v: number) => mt + ph - v * ph;

  let s = "";
  for (let i = 0; i <= 5; i++) {
    const v = (maxT / 5) * i, y = yT(v);
    s += `<line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="${C.grid}"/>`;
    s += `<text x="${ml - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="${C.muted}">${fmt(v)}</text>`;
    s += `<text x="${W - mr + 8}" y="${yPct(i / 5) + 4}" text-anchor="start" font-size="11" fill="${C.line2}">${i * 20}%</text>`;
  }
  const path = (sel: (p: typeof pts[number]) => number, y: (v: number) => number) =>
    pts.map((p, i) => `${i ? "L" : "M"}${xScale(p.totalNotes).toFixed(1)},${y(sel(p)).toFixed(1)}`).join(" ");
  s += `<path d="${path((p) => p.meanBaseline, yT)}" fill="none" stroke="${C.base}" stroke-width="2.5"/>`;
  s += `<path d="${path((p) => p.meanOptimized, yT)}" fill="none" stroke="${C.opt}" stroke-width="2.5"/>`;
  s += `<path d="${path((p) => p.meanPct, yPct)}" fill="none" stroke="${C.line2}" stroke-width="2" stroke-dasharray="5 4"/>`;
  pts.forEach((p) => {
    s += `<circle cx="${xScale(p.totalNotes)}" cy="${yT(p.meanBaseline)}" r="3.5" fill="${C.base}"/>`;
    s += `<circle cx="${xScale(p.totalNotes)}" cy="${yT(p.meanOptimized)}" r="3.5" fill="${C.opt}"/>`;
    s += `<circle cx="${xScale(p.totalNotes)}" cy="${yPct(p.meanPct)}" r="3.5" fill="${C.line2}"/>`;
    s += `<text x="${xScale(p.totalNotes)}" y="${yPct(p.meanPct) - 8}" text-anchor="middle" font-size="11" fill="${C.line2}">${pct(p.meanPct)}</text>`;
    s += `<text x="${xScale(p.totalNotes)}" y="${H - mb + 18}" text-anchor="middle" font-size="11" fill="${C.text}">${p.totalNotes}</text>`;
  });
  s += `<text x="${ml + pw / 2}" y="${H - 14}" text-anchor="middle" font-size="12" fill="${C.muted}">notes in corpus (11 real + synthetic)</text>`;
  const ly = 44;
  s += `<rect x="${ml}" y="${ly - 10}" width="12" height="12" fill="${C.base}"/><text x="${ml + 18}" y="${ly}" font-size="12" fill="${C.text}">Baseline tokens</text>`;
  s += `<rect x="${ml + 150}" y="${ly - 10}" width="12" height="12" fill="${C.opt}"/><text x="${ml + 168}" y="${ly}" font-size="12" fill="${C.text}">Optimized tokens</text>`;
  s += `<line x1="${ml + 320}" y1="${ly - 4}" x2="${ml + 332}" y2="${ly - 4}" stroke="${C.line2}" stroke-width="2" stroke-dasharray="5 4"/><text x="${ml + 338}" y="${ly}" font-size="12" fill="${C.text}">% savings (right axis)</text>`;
  return svg(W, H, "Savings scale with corpus size (combined-scenario mean)", s);
}

function svg(w: number, h: number, title: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" font-family="-apple-system,Segoe UI,Roboto,sans-serif">
<rect width="${w}" height="${h}" fill="#ffffff"/>
<text x="${w / 2}" y="24" text-anchor="middle" font-size="15" font-weight="600" fill="${C.text}">${esc(title)}</text>
${body}
</svg>`;
}

// ───────────────────────────────────────────── stats table
const sm = results.summary;
const statRows: [string, string][] = [
  ["Queries", String(sm.queries)],
  ["Mean per-query savings", pct(sm.meanPct)],
  ["Median per-query savings", pct(sm.medianPct)],
  ["Min / Max per-query savings", `${pct(sm.minPct)} / ${pct(sm.maxPct)}`],
  ["Mean baseline tokens / query", fmt(sm.meanBaseline)],
  ["Mean optimized tokens / query", fmt(sm.meanOptimized)],
  ["Session total — baseline", `${fmt(sm.totalBaseline)} tokens`],
  ["Session total — optimized", `${fmt(sm.totalOptimized)} tokens`],
  ["Session total — saved", `${fmt(sm.totalSaved)} tokens (${pct(sm.sessionPct)})`],
];

// ───────────────────────────────────────────── write charts
const charts = {
  "chart-per-query.svg": chartPerQuery(),
  "chart-savings-pct.svg": chartSavingsPct(),
  "chart-scaling.svg": chartScaling(),
};
for (const [name, content] of Object.entries(charts)) writeFileSync(resolve(OUT_DIR, name), content);

// ───────────────────────────────────────────── HTML report
const perQueryTableRows = (results.perQuery as any[]).map((r, i) =>
  `<tr><td>Q${i + 1}</td><td class="q">${esc(r.query)}</td><td>${r.scenario}</td><td class="n">${fmt(r.baseline)}</td><td class="n">${fmt(r.optimized)}</td><td class="n">${fmt(r.saved)}</td><td class="n strong">${(r.pct * 100).toFixed(0)}%</td></tr>`,
).join("\n");

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Noto — Token-Savings Benchmark</title>
<style>
:root{--fg:#2b2b2b;--muted:#777;--line:#eaeaea;--accent:#2f9e6f}
*{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,sans-serif;color:var(--fg);max-width:1000px;margin:0 auto;padding:40px 24px;line-height:1.55}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:36px 0 12px;border-bottom:1px solid var(--line);padding-bottom:6px}
.sub{color:var(--muted);margin:0 0 24px;font-size:14px}
.cards{display:flex;gap:14px;flex-wrap:wrap;margin:20px 0}
.card{flex:1;min-width:170px;border:1px solid var(--line);border-radius:10px;padding:16px}
.card .big{font-size:30px;font-weight:700;color:var(--accent)}.card .lbl{color:var(--muted);font-size:13px;margin-top:4px}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:600}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}td.strong{font-weight:700;color:var(--accent)}td.q{max-width:380px}
.svgwrap{border:1px solid var(--line);border-radius:10px;padding:8px;margin:12px 0;background:#fff}
.svgwrap svg{width:100%;height:auto;display:block}
.foot{color:var(--muted);font-size:12px;margin-top:40px;border-top:1px solid var(--line);padding-top:14px}
code{background:#f4f4f4;padding:1px 5px;border-radius:4px;font-size:12px}
</style></head><body>
<h1>Noto — Shared-Memory Token-Savings Benchmark</h1>
<p class="sub">Generated ${esc(results.generatedAt)} · tokenizer: ${esc(results.tokenizer)} · embedder ready: <strong>${results.embedderReady}</strong> (real MiniLM semantic retrieval)</p>

<div class="cards">
  <div class="card"><div class="big">${pct(sm.meanPct)}</div><div class="lbl">mean per-query token reduction</div></div>
  <div class="card"><div class="big">${pct(sm.sessionPct)}</div><div class="lbl">session-total reduction</div></div>
  <div class="card"><div class="big">${fmt(sm.totalSaved)}</div><div class="lbl">tokens saved across ${sm.queries} queries</div></div>
  <div class="card"><div class="big">${fmt(sm.meanBaseline)}→${fmt(sm.meanOptimized)}</div><div class="lbl">mean tokens / query (base→opt)</div></div>
</div>

<h2>What this measures</h2>
<p><strong>Baseline</strong> = the naive "no retrieval" integration: paste the whole corpus (all ${results.corpus.notes} note bodies + the full active-memory store of ${results.corpus.memories} memories) into the prompt, serialized as the JSON the MCP tool layer hands the model. <strong>Optimized</strong> = the shared-memory MCP path: the real <code>semanticSearchNotes</code> / <code>semanticRecall</code> (FTS5 + MiniLM cosine, 0.25 floor) returning only the top-K hits (notes K=${results.config.notesK}, recall K=${results.config.recallK}). Token saving = the reduction in input tokens.</p>

<h2>Input tokens per query</h2>
<div class="svgwrap">${charts["chart-per-query.svg"]}</div>

<h2>Token reduction per query</h2>
<div class="svgwrap">${charts["chart-savings-pct.svg"]}</div>

<h2>Savings scale with corpus size</h2>
<p class="sub">Optimized context stays flat (top-K) while the naive baseline grows linearly with the vault. ${esc(results.scalingNote)}</p>
<div class="svgwrap">${charts["chart-scaling.svg"]}</div>

<h2>Summary statistics</h2>
<table><tbody>
${statRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td class="n strong">${esc(v)}</td></tr>`).join("\n")}
</tbody></table>

<h2>Per-query detail</h2>
<table><thead><tr><th>#</th><th>Query</th><th>Scenario</th><th class="n">Baseline</th><th class="n">Optimized</th><th class="n">Saved</th><th class="n">%</th></tr></thead>
<tbody>${perQueryTableRows}</tbody></table>

<h2>Output tokens?</h2>
<p>These savings are <strong>input-side</strong>. Output (completion) tokens are driven by the question, not by how context is assembled, so retrieval does not reduce them — the MCP path even emits a little <em>more</em> output (the tool calls). See <a href="report-output.md">report-output.md</a> (regenerate with <code>npm run benchmark:output</code>).</p>

<p class="foot">Corpus: ${esc(results.corpus.notesSource)} + ${esc(results.corpus.memoriesSource)}.
Regenerate with <code>cd landing && npm run benchmark:tokens</code>.</p>
</body></html>`;
writeFileSync(resolve(OUT_DIR, "report.html"), html);

// ───────────────────────────────────────────── Markdown report
const md = `# Noto — Shared-Memory Token-Savings Benchmark

_Generated ${results.generatedAt} · tokenizer: ${results.tokenizer} · embedder ready: **${results.embedderReady}** (real MiniLM semantic retrieval)_

## Headline

| Metric | Value |
|---|--:|
| Mean per-query token reduction | **${pct(sm.meanPct)}** |
| Session-total reduction | **${pct(sm.sessionPct)}** |
| Tokens saved across ${sm.queries} queries | **${fmt(sm.totalSaved)}** |
| Mean tokens / query (baseline → optimized) | ${fmt(sm.meanBaseline)} → ${fmt(sm.meanOptimized)} |

## What this measures

- **Baseline** (naive, no retrieval): dump the whole corpus — all ${results.corpus.notes} note bodies + the full active-memory store (${results.corpus.memories} memories) — into the prompt, serialized as the JSON the MCP tool layer hands the model.
- **Optimized** (shared-memory MCP path): the real \`semanticSearchNotes\` / \`semanticRecall\` (FTS5 + MiniLM cosine, 0.25 floor) returning only the top-K hits (notes K=${results.config.notesK}, recall K=${results.config.recallK}).
- **Token saving** = reduction in input (prompt) tokens.

## Charts

![Input tokens per query](chart-per-query.svg)

![Token reduction per query](chart-savings-pct.svg)

![Savings scale with corpus size](chart-scaling.svg)

> ${results.scalingNote}

## Summary statistics

| Statistic | Value |
|---|--:|
${statRows.map(([k, v]) => `| ${k} | ${v} |`).join("\n")}

## Per-query detail

| # | Query | Scenario | Baseline | Optimized | Saved | % |
|---|---|---|--:|--:|--:|--:|
${(results.perQuery as any[]).map((r, i) => `| Q${i + 1} | ${r.query} | ${r.scenario} | ${fmt(r.baseline)} | ${fmt(r.optimized)} | ${fmt(r.saved)} | **${(r.pct * 100).toFixed(0)}%** |`).join("\n")}

## Output tokens?

These savings are **input-side**. Output (completion) tokens are driven by the question, not by how context is assembled, so retrieval does not reduce them — the MCP path even emits slightly *more* output (the tool calls). See [report-output.md](report-output.md) (\`npm run benchmark:output\`).

## Corpus-scaling detail

| Notes in corpus | Mean baseline | Mean optimized | Mean savings |
|--:|--:|--:|--:|
${(results.scaling as any[]).map((p) => `| ${p.totalNotes} | ${fmt(p.meanBaseline)} | ${fmt(p.meanOptimized)} | ${pct(p.meanPct)} |`).join("\n")}

---

_Corpus: ${results.corpus.notesSource} + ${results.corpus.memoriesSource}. Regenerate with \`cd landing && npm run benchmark:tokens\`._
`;
writeFileSync(resolve(OUT_DIR, "report.md"), md);

console.log("Wrote charts + report to", OUT_DIR);
for (const f of [...Object.keys(charts), "report.html", "report.md"]) console.log("  •", f);
