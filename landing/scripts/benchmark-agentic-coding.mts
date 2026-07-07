/**
 * Agentic-coding token benchmark — measures BOTH input and output tokens across a
 * realistic multi-turn agent session that uses a Noto vault as its working memory.
 *
 * Plan: docs/superpowers/plans/2026-06-29-noto-token-savings-benchmark.md (extension)
 *
 * The agent loop, per turn: read context → recall memory → edit a note → maybe
 * record a decision → iterate. We measure two directions, two platforms:
 *
 *   INPUT (context the model must consume each turn)
 *     baseline  (Obsidian / no-MCP agent): re-feed the WHOLE vault + full memory
 *               store every turn — it has no semantic retrieval layer.
 *     optimized (Noto MCP): the REAL semanticSearchNotes() + semanticRecall()
 *               (FTS5 + MiniLM cosine, top-K) — only the relevant hits.
 *
 *   OUTPUT (tokens the model must EMIT to land its change each turn)
 *     baseline  (Obsidian / no-MCP agent): the only remote write primitive is a
 *               whole-file write, so the agent must re-emit the ENTIRE updated
 *               note body; and with no memory store it must restate any decision
 *               inline so it survives.
 *     optimized (Noto MCP): append_note / update_section emit only the DELTA
 *               ({fileId, text} or {fileId, heading, content}); remember() persists
 *               a decision as one short structured write.
 *
 * Platforms compared:
 *   Noto     = optimized input + optimized output.
 *   Obsidian = baseline input + baseline output. Out of the box Obsidian has no
 *              agent semantic-retrieval and no MCP write-back/patch layer, so an
 *              agent driving it falls back to full-context reads and whole-file
 *              writes — i.e. the naive baseline. A raw/no-tool agent is equal or
 *              worse, so Obsidian is the *conservative* (competitor-favorable)
 *              baseline. Stated honestly in the report.
 *
 * Output (write) tokens are the only direction where Noto's write primitives act;
 * input savings come from retrieval (consistent with benchmark-token-savings.mts).
 * Tokens are counted with gpt-tokenizer (o200k_base) as a provider-neutral proxy.
 * Fully deterministic — no live API. Writes docs/benchmarks/token-savings/agentic-results.json.
 *
 * Run: cd landing && npx tsx scripts/benchmark-agentic-coding.mts
 */

process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV ??= "development";

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { encode } from "gpt-tokenizer/model/gpt-4o"; // o200k_base
import { MEMORY_FIXTURE, NOTES_K, RECALL_K, RECALL_SCOPES, MEMORY_SCOPE } from "./bench-fixtures.mts";
import { SESSION, type Turn } from "./bench-agentic-fixtures.mts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const OUT_DIR = resolve(repoRoot, "docs/benchmarks/token-savings");

const db = await import("../server/db.ts");
const { semanticSearchNotes, semanticRecall } = await import("../server/search/semantic.ts");
const { reembedNote, embedMemory } = await import("../server/search/embedNote.ts");
const { embedder } = await import("../server/search/embedder.ts");
const { NotoData } = await import("../src/noto/mockVault.ts");

const tok = (s: string) => encode(s).length;

// ───────────────────────────────────────────── seeding (mirrors benchmark-token-savings.mts)
interface FileState { id: string; path: string; title: string; content: string }

const user = db.ensureLocalOwner();
const vault = db.createVault(user.id, { name: "School Vault" });

const files = new Map<string, FileState>(); // keyed by title
await embedder.embed(["warmup"]); // flip embedder.ready() before any retrieval
for (const f of NotoData.files as FileState[]) {
  const file = db.createFile(vault.id, { path: f.path, title: f.title, content: f.content });
  await reembedNote(file.id, f.content);
  files.set(f.title, { id: file.id, path: f.path, title: f.title, content: f.content });
}
for (const m of MEMORY_FIXTURE) {
  const { memory } = db.rememberMemory({ userId: user.id, text: m.text, type: m.type, scope: MEMORY_SCOPE });
  await embedMemory(memory.id, m.text);
}

// ───────────────────────────────────────────── INPUT context costs
/** Baseline input: re-feed every note body + the full memory store (grows as the agent edits). */
function baselineInputTokens(): number {
  const notes = [...files.values()].map((f) => ({ id: f.id, path: f.path, title: f.title, content: f.content }));
  const memories = db.listMemories(user.id, undefined, undefined, 10_000);
  return tok(JSON.stringify({ notes, memories }));
}
/** Optimized input: real top-K retrieval envelopes (search_notes + recall), as the MCP tools return them. */
async function optimizedInputTokens(query: string): Promise<number> {
  const results = await semanticSearchNotes(user.id, query, NOTES_K);
  const memories = await semanticRecall(user.id, RECALL_SCOPES, query, undefined, RECALL_K);
  return tok(JSON.stringify({ results, memories }));
}

// ───────────────────────────────────────────── OUTPUT (write) costs + body mutation
/** Apply an edit to the running body and return the new full body (for the rewrite baseline). */
function applyEdit(body: string, turn: Turn): string {
  const { kind, heading, delta } = turn.edit;
  if (kind === "section" && heading) {
    const re = new RegExp(`(^|\\n)#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*\\n`, "i");
    const m = body.match(re);
    if (m && m.index !== undefined) {
      const start = m.index + m[0].length;
      const rest = body.slice(start);
      const next = rest.search(/\n#{1,6}\s/);
      const end = next === -1 ? body.length : start + next;
      return body.slice(0, start) + delta + "\n" + body.slice(end);
    }
    return `${body}\n\n## ${heading}\n${delta}`; // heading absent → add it
  }
  return `${body}\n\n${delta}`; // append
}

/** Baseline output: whole-file rewrite payload + (if any) an inline restated-decision block. */
function baselineOutputTokens(turn: Turn, newBody: string, f: FileState): number {
  const rewrite = tok(JSON.stringify({ path: f.path, title: f.title, content: newBody }));
  const restate = turn.memory
    ? tok(`For future reference (${turn.editTitle}): ${turn.memory.text} Recording this inline so it carries into later turns, since there is no shared memory store.`)
    : 0;
  return rewrite + restate;
}
/** Optimized output: delta-only write primitive + (if any) one short structured remember(). */
function optimizedOutputTokens(turn: Turn, f: FileState): number {
  const { kind, heading, delta } = turn.edit;
  const write = kind === "section"
    ? tok(JSON.stringify({ fileId: f.id, heading, content: delta }))      // update_section args
    : tok(JSON.stringify({ fileId: f.id, text: delta, underHeading: heading })); // append_note args
  const remember = turn.memory ? tok(JSON.stringify({ text: turn.memory.text, type: turn.memory.type })) : 0;
  return write + remember;
}

// ───────────────────────────────────────────── run the session
interface TurnRow {
  turn: number; query: string; editTitle: string; editKind: string; hasMemory: boolean;
  inBaseline: number; inOptimized: number; outBaseline: number; outOptimized: number;
}

const rows: TurnRow[] = [];
for (let i = 0; i < SESSION.length; i++) {
  const turn = SESSION[i];
  const f = files.get(turn.editTitle);
  if (!f) throw new Error(`Session turn ${i + 1} edits unknown note "${turn.editTitle}"`);

  const inBaseline = baselineInputTokens();           // measured against the CURRENT (grown) vault
  const inOptimized = await optimizedInputTokens(turn.query);

  const newBody = applyEdit(f.content, turn);
  const outBaseline = baselineOutputTokens(turn, newBody, f);
  const outOptimized = optimizedOutputTokens(turn, f);

  // commit the edit + memory to the running state so later turns see a larger vault
  f.content = newBody;
  if (turn.memory) db.rememberMemory({ userId: user.id, text: turn.memory.text, type: turn.memory.type, scope: MEMORY_SCOPE });

  rows.push({
    turn: i + 1, query: turn.query, editTitle: turn.editTitle, editKind: turn.edit.kind, hasMemory: !!turn.memory,
    inBaseline, inOptimized, outBaseline, outOptimized,
  });
}

// ───────────────────────────────────────────── aggregate
const sum = (f: (r: TurnRow) => number) => rows.reduce((a, r) => a + f(r), 0);
const inB = sum((r) => r.inBaseline), inO = sum((r) => r.inOptimized);
const outB = sum((r) => r.outBaseline), outO = sum((r) => r.outOptimized);
const totB = inB + outB, totO = inO + outO;

const pct = (saved: number, base: number) => (base > 0 ? saved / base : 0);
const summary = {
  turns: rows.length,
  input: { baseline: inB, optimized: inO, saved: inB - inO, pct: pct(inB - inO, inB) },
  output: { baseline: outB, optimized: outO, saved: outB - outO, pct: pct(outB - outO, outB) },
  combined: { baseline: totB, optimized: totO, saved: totB - totO, pct: pct(totB - totO, totB) },
};

// Platform totals (Obsidian == baseline both directions; raw no-tool agent ≥ this cost).
const platforms = {
  noto: { input: inO, output: outO, total: totO },
  obsidian: { input: inB, output: outB, total: totB },
};

// ───────────────────────────────────────────── output note-size sensitivity
// The delta a section/append edit emits is roughly fixed; the whole-file-rewrite
// baseline scales with note size. So output savings climb toward 100% as notes
// grow. Sweep a representative edit over increasingly large synthetic note bodies.
const SAMPLE_DELTA =
  "Reviewed this section and added a worked example plus two cross-links to related notes; flagged one item for a flashcard.";
function bodyOfTokens(approxTokens: number): string {
  const unit = "The note records a concept, a worked example, and review questions for the topic. ";
  let s = "# Note\n\n## Section\n";
  while (tok(s) < approxTokens) s += unit;
  return s;
}
const outputScaling = [200, 500, 1000, 2000, 4000].map((noteTokens) => {
  const body = bodyOfTokens(noteTokens);
  const rewriteOut = tok(JSON.stringify({ path: "Subject/Note.md", title: "Note", content: `${body}\n\n${SAMPLE_DELTA}` }));
  const deltaOut = tok(JSON.stringify({ fileId: randomUUID(), heading: "Section", content: SAMPLE_DELTA }));
  return { noteTokens: tok(body), rewriteOut, deltaOut, pct: pct(rewriteOut - deltaOut, rewriteOut) };
});

const results = {
  generatedAt: new Date().toISOString(),
  tokenizer: "gpt-tokenizer o200k_base (GPT-4o encoding; provider-neutral proxy)",
  embedderReady: embedder.ready(),
  model: {
    description: "Multi-turn agent editing a Noto vault. INPUT = context re-fed per turn (baseline: whole vault + full memory; optimized: real semantic top-K). OUTPUT = tokens emitted to land each change (baseline: whole-file rewrite + inline restated decisions; optimized: append_note/update_section deltas + structured remember()).",
    obsidianAssumption: "Obsidian out of the box has no agent semantic-retrieval and no MCP write-back/patch layer, so an agent driving it uses full-context reads and whole-file writes — identical to the naive baseline. A raw/no-tool agent is equal or worse, so Obsidian is the conservative baseline.",
    inputCaveat: "Input optimized = real semanticSearchNotes + semanticRecall top-K, same as benchmark-token-savings.mts.",
    outputCaveat: "Output savings are vs a whole-file-rewrite baseline. An agent harness with its own native diff/patch tool already captures part of this; Noto's contribution is providing append/section-patch primitives over a remote notes store where the alternative is a full-body write. create_note (new files) emits full content in BOTH paths — no output saving there, and the session contains none.",
    config: { notesK: NOTES_K, recallK: RECALL_K },
  },
  perTurn: rows,
  summary,
  platforms,
  outputScaling,
  outputScalingNote: "A fixed-size edit emitted as a whole-file rewrite vs an update_section delta, over synthetic note bodies of increasing size. The delta stays flat; the rewrite scales with the note, so output savings climb toward 100% on large notes/files (the deep-agentic-coding regime). Bodies are synthetic, labeled here.",
};

mkdirSync(OUT_DIR, { recursive: true });
const path = resolve(OUT_DIR, "agentic-results.json");
writeFileSync(path, JSON.stringify(results, null, 2));

const f1 = (n: number) => (n * 100).toFixed(1) + "%";
console.log(`\nAgentic-coding benchmark — ${rows.length} turns, embedder ready: ${embedder.ready()}`);
console.log(`  INPUT   baseline → optimized : ${inB.toLocaleString()} → ${inO.toLocaleString()}  (saved ${f1(summary.input.pct)})`);
console.log(`  OUTPUT  baseline → optimized : ${outB.toLocaleString()} → ${outO.toLocaleString()}  (saved ${f1(summary.output.pct)})`);
console.log(`  COMBINED                     : ${totB.toLocaleString()} → ${totO.toLocaleString()}  (saved ${f1(summary.combined.pct)})`);
console.log(`\n→ ${path}`);
