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

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const OUT_DIR = resolve(repoRoot, "docs/benchmarks/token-savings");

const db = await import("../server/db.ts");
const { semanticSearchNotes, semanticRecall } = await import("../server/search/semantic.ts");
const { reembedNote, embedMemory } = await import("../server/search/embedNote.ts");
const { embedder } = await import("../server/search/embedder.ts");
const { NotoData } = await import("../src/noto/mockVault.ts");

const tok = (s: string) => encode(s).length;

// MCP defaults (noto-mcp/src/notoClient.ts): search_notes limit=5, recall limit=6.
const NOTES_K = 5;
const RECALL_K = 6;
const RECALL_SCOPES = ["noto-web"]; // getUserMemoryVectors always unions in "global"

// ───────────────────────────────────────────────────────────── memory fixtures
// Realistic accumulated cross-session memory, in the repo's Noto memory shape
// (type ∈ decision | preference | fact | glossary — the server's allowed set).
const MEMORY_FIXTURE: { text: string; type: string }[] = [
  { text: "Prefers studying with the Pomodoro technique — 25 minute focus blocks, 5 minute breaks.", type: "preference" },
  { text: "Exams are graded on a curve; the biology midterm average last year was 72%.", type: "fact" },
  { text: "Decided to summarize every lecture into a single Markdown note within 24 hours of class.", type: "decision" },
  { text: "Finds spaced-repetition flashcards more effective than re-reading notes.", type: "preference" },
  { text: "The Calvin cycle is the light-independent stage of photosynthesis that fixes carbon dioxide into glucose.", type: "glossary" },
  { text: "Chlorophyll absorbs red and blue light most strongly and reflects green.", type: "fact" },
  { text: "Professor Lin's office hours are Tuesdays 2–4pm in the science building.", type: "fact" },
  { text: "Prefers dark mode and a serif font for long reading sessions.", type: "preference" },
  { text: "Decided to use wiki-links between every related note to build a knowledge graph.", type: "decision" },
  { text: "An enzyme is a biological catalyst that lowers the activation energy of a reaction.", type: "glossary" },
  { text: "The Cold War lasted roughly from 1947 to 1991 between the US and the Soviet Union.", type: "fact" },
  { text: "The Industrial Revolution began in Britain in the late 18th century.", type: "fact" },
  { text: "A logarithm is the inverse operation to exponentiation: log_b(x) answers b^? = x.", type: "glossary" },
  { text: "Macbeth's central themes are ambition, guilt, and the corrupting nature of power.", type: "fact" },
  { text: "Decided to record lectures with the AI recorder and review the auto-summary the same evening.", type: "decision" },
  { text: "Prefers concise bullet-point summaries over long prose when reviewing.", type: "preference" },
  { text: "Mitochondria are the organelles responsible for cellular respiration and ATP production.", type: "glossary" },
  { text: "Stomata are pores on leaves that let carbon dioxide in and water vapor out.", type: "glossary" },
  { text: "The history final covers WWII through the end of the Cold War — heavy on causation essays.", type: "fact" },
  { text: "Decided to keep all chemistry notes in the same vault folder as biology for cross-referencing.", type: "decision" },
  { text: "Prefers reviewing flashcards on the commute rather than at the desk.", type: "preference" },
  { text: "Glucose is a six-carbon sugar (C6H12O6) that stores chemical energy.", type: "glossary" },
  { text: "The Treaty of Versailles (1919) ended WWI and imposed reparations on Germany.", type: "fact" },
  { text: "Decided to write essay outlines before drafting, with one paragraph per argument.", type: "decision" },
  { text: "Finds mind-maps helpful for connecting historical causes and effects.", type: "preference" },
  { text: "The derivative of e^x is e^x; the derivative of ln(x) is 1/x.", type: "glossary" },
  { text: "Photosynthesis overall: 6CO2 + 6H2O + light → C6H12O6 + 6O2.", type: "fact" },
  { text: "Prefers to study hardest subjects in the morning when focus is highest.", type: "preference" },
  { text: "Decided to tag every lecture note with #lecture and the subject for fast filtering.", type: "decision" },
  { text: "The mitochondrial electron transport chain produces the bulk of a cell's ATP.", type: "fact" },
];

// ───────────────────────────────────────────────────────────── query set
type Scenario = "notes" | "memory" | "combined";
interface Query { q: string; scenario: Scenario; note: string }
const QUERIES: Query[] = [
  { q: "How do plants convert light into chemical energy?", scenario: "combined", note: "paraphrase of photosynthesis (no keyword overlap)" },
  { q: "What is the role of carbon dioxide in photosynthesis?", scenario: "notes", note: "direct biology lookup" },
  { q: "Explain how chloroplasts relate to glucose production", scenario: "combined", note: "multi-note biology" },
  { q: "What were the main tensions after World War II?", scenario: "notes", note: "paraphrase of Cold War" },
  { q: "How should I structure my study sessions?", scenario: "memory", note: "study-habit preferences" },
  { q: "What did I decide about summarizing lectures?", scenario: "memory", note: "decision recall" },
  { q: "Themes of ambition and guilt in literature", scenario: "notes", note: "Macbeth" },
  { q: "How do enzymes affect chemical reactions in cells?", scenario: "combined", note: "enzymes glossary + note" },
  { q: "What is a logarithm and how does it relate to exponents?", scenario: "combined", note: "math glossary + note" },
  { q: "Remind me of the office hours and exam details", scenario: "memory", note: "logistics facts" },
];

// ───────────────────────────────────────────────────────────── seeding
interface Seeded { userId: string; vaultId: string }

async function seedUser(extraNotes: { path: string; title: string; content: string }[], extraMems: { text: string; type: string }[]): Promise<Seeded> {
  const email = `bench-${randomUUID()}@example.com`;
  const user = db.createUser({ email });
  const vault = db.createVault(user.id, "School Vault");

  const notes = [
    ...NotoData.files.map((f: { path: string; title: string; content: string }) => ({ path: f.path, title: f.title, content: f.content })),
    ...extraNotes,
  ];
  for (const n of notes) {
    const file = db.createFile(vault.id, n);
    await reembedNote(file.id, n.content); // chunk + embed, exactly as the server does on write
  }
  for (const m of [...MEMORY_FIXTURE, ...extraMems]) {
    const { memory } = db.rememberMemory({ userId: user.id, text: m.text, type: m.type, scope: "noto-web" });
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
// Synthetic-but-realistic extra corpus (clearly labeled) to show savings scale
// with corpus size. Optimized stays ~flat (top-K); baseline grows linearly.
const TOPICS = [
  ["Chemistry", "covalent bonds form when atoms share electron pairs to fill their valence shells"],
  ["Physics", "Newton's second law states force equals mass times acceleration"],
  ["Geography", "plate tectonics describes the slow movement of the Earth's lithospheric plates"],
  ["Economics", "supply and demand determine the equilibrium price in a competitive market"],
  ["Psychology", "classical conditioning pairs a neutral stimulus with an unconditioned response"],
  ["Astronomy", "a light-year is the distance light travels in one year, about 9.46 trillion km"],
];
function makeSynthetic(n: number): { notes: { path: string; title: string; content: string }[]; mems: { text: string; type: string }[] } {
  const notes: { path: string; title: string; content: string }[] = [];
  const mems: { text: string; type: string }[] = [];
  for (let i = 0; i < n; i++) {
    const [subject, fact] = TOPICS[i % TOPICS.length];
    notes.push({
      path: `${subject}/Synthetic Note ${i + 1}.md`,
      title: `${subject} Topic ${i + 1}`,
      content: `# ${subject} Topic ${i + 1}\n\n## Key idea\nLecture ${i + 1}: ${fact}. This note explores variation ${i + 1} of the concept with worked examples and review questions.\n\n## Summary\nThe key takeaway for topic ${i + 1} connects to broader ${subject.toLowerCase()} principles.`,
    });
    mems.push({ text: `Synthetic study fact ${i + 1}: ${fact} (variation ${i + 1}).`, type: "glossary" });
  }
  return { notes, mems };
}

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
