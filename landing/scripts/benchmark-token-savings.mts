/**
 * Token-savings benchmark for the Noto shared-memory / semantic-retrieval layer.
 *
 * Plan: docs/superpowers/plans/2026-06-29-noto-token-savings-benchmark.md
 *
 * Measures input (prompt) tokens for two ways of giving an LLM agent the context
 * it needs to answer a query over a Noto vault + memory store:
 *
 *   baseline   — naive "no retrieval": dump the WHOLE corpus into the prompt
 *                (all note bodies + the full active-memory store), serialized as
 *                the JSON the MCP tool layer would hand the model.
 *   optimized  — the shared-memory MCP path: call the REAL semanticSearchNotes()
 *                / semanticRecall() (FTS5 + MiniLM cosine, 0.25 floor, top-K) and
 *                serialize only the returned hits — exactly what search_notes /
 *                recall return to the model.
 *
 * Tokens are counted with gpt-tokenizer (o200k_base) as a provider-neutral proxy.
 * Writes docs/benchmarks/token-savings/results.json; render-token-savings.mts
 * turns that into charts + an HTML/Markdown report.
 *
 * Run: cd landing && npx tsx scripts/benchmark-token-savings.mts
 */

// node:sqlite opens the DB at db.ts import time from env.DATABASE_PATH, so set it
// (and a benign NODE_ENV) BEFORE the dynamic imports below — ESM evaluates imports
// before top-level code, hence import() rather than a static import.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV ??= "development";

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { encode } from "gpt-tokenizer/model/gpt-4o"; // o200k_base
import { MEMORY_FIXTURE, QUERIES, makeSynthetic, NOTES_K, RECALL_K, RECALL_SCOPES, MEMORY_SCOPE, type Scenario } from "./bench-fixtures.mts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const OUT_DIR = resolve(repoRoot, "docs/benchmarks/token-savings");

const db = await import("../server/db.ts");
const { semanticSearchNotes, semanticRecall } = await import("../server/search/semantic.ts");
const { reembedNote, embedMemory } = await import("../server/search/embedNote.ts");
const { embedder } = await import("../server/search/embedder.ts");
const { NotoData } = await import("../src/noto/mockVault.ts");

const tok = (s: string) => encode(s).length;

// ───────────────────────────────────────────────────────────── seeding
interface Seeded { userId: string; vaultId: string }

async function seedUser(extraNotes: { path: string; title: string; content: string }[], extraMems: { text: string; type: string }[]): Promise<Seeded> {
  const email = `bench-${randomUUID()}@example.com`;
  const user = db.createUser({ email });
  const vault = db.createVault(user.id, { name: "School Vault" });

  const notes = [
    ...NotoData.files.map((f: { path: string; title: string; content: string }) => ({ path: f.path, title: f.title, content: f.content })),
    ...extraNotes,
  ];
  for (const n of notes) {
    const file = db.createFile(vault.id, n);
    await reembedNote(file.id, n.content); // chunk + embed, exactly as the server does on write
  }
  for (const m of [...MEMORY_FIXTURE, ...extraMems]) {
    const { memory } = db.rememberMemory({ userId: user.id, text: m.text, type: m.type, scope: MEMORY_SCOPE });
    await embedMemory(memory.id, m.text);
  }
  return { userId: user.id, vaultId: vault.id };
}

// ───────────────────────────────────────────────────────────── measurement
/** Baseline note context: every note body, serialized like a list_notes-with-bodies dump. */
function baselineNotesTokens(vaultId: string): number {
  const notes = db.getFilesForVault(vaultId).map((f) => ({ id: f.id, path: f.path, title: f.title, content: f.content }));
  return tok(JSON.stringify({ notes }));
}
/** Baseline memory context: the full active-memory store. */
function baselineMemoryTokens(userId: string): number {
  const memories = db.listMemories(userId, undefined, undefined, 10_000);
  return tok(JSON.stringify({ memories }));
}
/** Optimized note context: search_notes top-K result envelope. */
async function optimizedNotesTokens(userId: string, q: string): Promise<number> {
  const results = await semanticSearchNotes(userId, q, NOTES_K);
  return tok(JSON.stringify({ results }));
}
/** Optimized memory context: recall top-K result envelope. */
async function optimizedMemoryTokens(userId: string, q: string): Promise<number> {
  const memories = await semanticRecall(userId, RECALL_SCOPES, q, undefined, RECALL_K);
  return tok(JSON.stringify({ memories }));
}

interface QueryResult {
  query: string; scenario: Scenario; note: string;
  baseline: number; optimized: number; saved: number; pct: number;
  notesHits: number; memoryHits: number;
}

async function runQueries(seed: Seeded): Promise<QueryResult[]> {
  const baseNotes = baselineNotesTokens(seed.vaultId);
  const baseMem = baselineMemoryTokens(seed.userId);
  const out: QueryResult[] = [];
  for (const { q, scenario, note } of QUERIES) {
    const wantNotes = scenario === "notes" || scenario === "combined";
    const wantMem = scenario === "memory" || scenario === "combined";

    const optNotesHits = wantNotes ? await semanticSearchNotes(seed.userId, q, NOTES_K) : [];
    const optMemHits = wantMem ? await semanticRecall(seed.userId, RECALL_SCOPES, q, undefined, RECALL_K) : [];

    const baseline = (wantNotes ? baseNotes : 0) + (wantMem ? baseMem : 0);
    const optimized =
      (wantNotes ? tok(JSON.stringify({ results: optNotesHits })) : 0) +
      (wantMem ? tok(JSON.stringify({ memories: optMemHits })) : 0);

    const saved = baseline - optimized;
    out.push({
      query: q, scenario, note,
      baseline, optimized, saved, pct: saved / baseline,
      notesHits: optNotesHits.length, memoryHits: optMemHits.length,
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────── stats
function summarize(rows: QueryResult[]) {
  const pcts = rows.map((r) => r.pct).sort((a, b) => a - b);
  const median = pcts.length % 2 ? pcts[(pcts.length - 1) / 2] : (pcts[pcts.length / 2 - 1] + pcts[pcts.length / 2]) / 2;
  const sum = (f: (r: QueryResult) => number) => rows.reduce((a, r) => a + f(r), 0);
  const totalBaseline = sum((r) => r.baseline);
  const totalOptimized = sum((r) => r.optimized);
  const totalSaved = totalBaseline - totalOptimized;
  return {
    queries: rows.length,
    meanPct: sum((r) => r.pct) / rows.length,
    medianPct: median,
    minPct: Math.min(...pcts),
    maxPct: Math.max(...pcts),
    totalBaseline, totalOptimized, totalSaved,
    sessionPct: totalSaved / totalBaseline, // compounding effect across the session
    meanBaseline: totalBaseline / rows.length,
    meanOptimized: totalOptimized / rows.length,
  };
}

// ───────────────────────────────────────────────────────────── scaling sweep
// Optimized stays ~flat (top-K); baseline grows linearly with the corpus.
async function runScaling() {
  const sizes = [0, 20, 60, 140]; // extra notes added on top of the 11 real notes
  const points: { totalNotes: number; meanBaseline: number; meanOptimized: number; meanPct: number }[] = [];
  for (const extra of sizes) {
    const { notes, mems } = makeSynthetic(extra);
    const seed = await seedUser(notes, mems);
    const rows = (await runQueries(seed)).filter((r) => r.scenario === "combined");
    const s = summarize(rows);
    points.push({ totalNotes: NotoData.files.length + extra, meanBaseline: s.meanBaseline, meanOptimized: s.meanOptimized, meanPct: s.meanPct });
  }
  return points;
}

// ───────────────────────────────────────────────────────────── main
async function main() {
  await embedder.embed(["warmup"]); // flip embedder.ready() before any retrieval
  if (!embedder.ready()) console.warn("⚠️  embedder not ready — falling back to lexical FTS (still a valid optimized path)");

  const seed = await seedUser([], []);
  const rows = await runQueries(seed);
  const summary = summarize(rows);
  const scaling = await runScaling();

  const results = {
    generatedAt: new Date().toISOString(),
    tokenizer: "gpt-tokenizer o200k_base (GPT-4o encoding; provider-neutral proxy)",
    embedderReady: embedder.ready(),
    corpus: {
      notes: NotoData.files.length,
      memories: MEMORY_FIXTURE.length,
      notesSource: "landing/src/noto/mockVault.ts (real fixture)",
      memoriesSource: "curated Noto memory fixture (this script)",
    },
    config: { notesK: NOTES_K, recallK: RECALL_K, recallScopes: RECALL_SCOPES },
    perQuery: rows,
    summary,
    scaling,
    scalingNote: "Notes beyond the first 11 are synthetic, in the same shape, used only to plot how savings scale with corpus size.",
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, "results.json");
  writeFileSync(path, JSON.stringify(results, null, 2));

  console.log(`\nToken-savings benchmark — ${rows.length} queries, embedder ready: ${embedder.ready()}`);
  console.log(`  mean per-query savings : ${(summary.meanPct * 100).toFixed(1)}%`);
  console.log(`  median per-query       : ${(summary.medianPct * 100).toFixed(1)}%`);
  console.log(`  session total saved    : ${summary.totalSaved.toLocaleString()} tokens (${(summary.sessionPct * 100).toFixed(1)}%)`);
  console.log(`  baseline → optimized   : ${summary.totalBaseline.toLocaleString()} → ${summary.totalOptimized.toLocaleString()} tokens`);
  console.log(`\n→ ${path}`);
}

await main();
