/**
 * Category-level cache savings benchmark.
 *
 * Measures input + output token savings broken down by real-world use-case
 * categories that map to how students actually use Noto:
 *
 *   Active Recall     — Q&A chat about note content (repeated study sessions)
 *   Content Writing   — Summarization for revision notes
 *   Spaced Repetition — Flashcard generation reviewed multiple times
 *   Knowledge Mapping — Link discovery between notes
 *   Lecture Capture   — Turning transcripts into structured notes
 *
 * Two-pass design:
 *   Pass 1 (Session 1) — fresh queries warm the cache
 *   Pass 2 (Session 2) — same queries replayed; cache hits = 0 tokens billed
 *
 * Run: cd landing && npm run benchmark:categories
 */

process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV ??= "development";
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = "stub";

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { encode } from "gpt-tokenizer/model/gpt-4o";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const OUT_DIR = resolve(repoRoot, "docs/benchmarks/categories");

const db = await import("../server/db.ts");
const { NotoData } = await import("../src/noto/mockVault.ts");
const { SYSTEM, buildChatPrompt, buildSummarizePrompt, buildFlashcardsPrompt, buildFindLinksPrompt, buildLecturePrompt } = await import("../server/ai/prompts.ts");
const { MAX_TOKENS } = await import("../server/ai/openai.ts");
const { sha256Hex, insertAiCache, getAiCacheByHash, incrementAiCacheHit } = await import("../server/db.ts");

const IS_STUB = !process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === "stub";
const tok = (s: string) => encode(s).length;
const TTL = 7 * 24 * 60 * 60;

const STUB_OUT: Record<string, number> = {
  chat: 55,
  summarize: 80,
  flashcards: 230,
  "find-links": 25,
  "lecture-notes": 380,
};

// ── seed DB ──────────────────────────────────────────────────────────────────

const user = db.createUser({ email: `bench-cat-${randomUUID()}@example.com` });
const vault = db.createVault(user.id, { name: "Benchmark Vault" });
const files = NotoData.files as { path: string; title: string; content: string }[];
for (const f of files) db.createFile(vault.id, { path: f.path, title: f.title, content: f.content });
const titles = files.map((f) => f.title);

// Use up to 5 notes for variety; fall back to repeating if fewer exist
const n = (i: number) => files[i % files.length];

// ── types ─────────────────────────────────────────────────────────────────────

type Feature = "chat" | "summarize" | "flashcards" | "find-links" | "lecture-notes";
type Category = "Active Recall" | "Content Writing" | "Spaced Repetition" | "Knowledge Mapping" | "Lecture Capture";

interface BenchQuery {
  category: Category;
  label: string;
  feature: Feature;
  system: string;
  user: string;
  maxTokens: number;
}

// ── query definitions ─────────────────────────────────────────────────────────

const QUERIES: BenchQuery[] = [
  // ── Active Recall (chat Q&A — students revisit same questions across sessions)
  { category: "Active Recall", label: "recall: what is this note about", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: n(0).title, noteContent: n(0).content, question: "What is this note about?" }), maxTokens: MAX_TOKENS.chat },
  { category: "Active Recall", label: "recall: key concepts", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: n(0).title, noteContent: n(0).content, question: "What are the key concepts I need to know?" }), maxTokens: MAX_TOKENS.chat },
  { category: "Active Recall", label: "recall: explain in simple terms", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: n(1).title, noteContent: n(1).content, question: "Explain this in simple terms." }), maxTokens: MAX_TOKENS.chat },
  { category: "Active Recall", label: "recall: give an example", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: n(1).title, noteContent: n(1).content, question: "Give me an example of the main idea." }), maxTokens: MAX_TOKENS.chat },
  { category: "Active Recall", label: "recall: study focus", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: n(2).title, noteContent: n(2).content, question: "What should I focus on for the exam?" }), maxTokens: MAX_TOKENS.chat },
  { category: "Active Recall", label: "recall: connections", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: n(2).title, noteContent: n(2).content, question: "How does this topic connect to others?" }), maxTokens: MAX_TOKENS.chat },
  { category: "Active Recall", label: "recall: two-sentence summary", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: n(3).title, noteContent: n(3).content, question: "Give me a two-sentence summary." }), maxTokens: MAX_TOKENS.chat },
  { category: "Active Recall", label: "recall: common mistakes", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: n(3).title, noteContent: n(3).content, question: "What are common mistakes or misconceptions here?" }), maxTokens: MAX_TOKENS.chat },

  // ── Content Writing (summarize — revision notes, students re-summarize same notes)
  { category: "Content Writing", label: "writing: summarize note 1", feature: "summarize", system: SYSTEM.summarize, user: buildSummarizePrompt(n(0).title, n(0).content), maxTokens: MAX_TOKENS.summarize },
  { category: "Content Writing", label: "writing: summarize note 2", feature: "summarize", system: SYSTEM.summarize, user: buildSummarizePrompt(n(1).title, n(1).content), maxTokens: MAX_TOKENS.summarize },
  { category: "Content Writing", label: "writing: summarize note 3", feature: "summarize", system: SYSTEM.summarize, user: buildSummarizePrompt(n(2).title, n(2).content), maxTokens: MAX_TOKENS.summarize },
  { category: "Content Writing", label: "writing: summarize note 4", feature: "summarize", system: SYSTEM.summarize, user: buildSummarizePrompt(n(3).title, n(3).content), maxTokens: MAX_TOKENS.summarize },
  { category: "Content Writing", label: "writing: summarize note 5", feature: "summarize", system: SYSTEM.summarize, user: buildSummarizePrompt(n(4).title, n(4).content), maxTokens: MAX_TOKENS.summarize },

  // ── Spaced Repetition (flashcards — same notes reviewed repeatedly on a schedule)
  { category: "Spaced Repetition", label: "sr: flashcards note 1", feature: "flashcards", system: SYSTEM.flashcards, user: buildFlashcardsPrompt(n(0).title, n(0).content), maxTokens: MAX_TOKENS.flashcards },
  { category: "Spaced Repetition", label: "sr: flashcards note 2", feature: "flashcards", system: SYSTEM.flashcards, user: buildFlashcardsPrompt(n(1).title, n(1).content), maxTokens: MAX_TOKENS.flashcards },
  { category: "Spaced Repetition", label: "sr: flashcards note 3", feature: "flashcards", system: SYSTEM.flashcards, user: buildFlashcardsPrompt(n(2).title, n(2).content), maxTokens: MAX_TOKENS.flashcards },
  { category: "Spaced Repetition", label: "sr: flashcards note 4", feature: "flashcards", system: SYSTEM.flashcards, user: buildFlashcardsPrompt(n(3).title, n(3).content), maxTokens: MAX_TOKENS.flashcards },

  // ── Knowledge Mapping (find-links — discovering connections between notes)
  { category: "Knowledge Mapping", label: "map: find links note 1", feature: "find-links", system: SYSTEM.findLinks, user: buildFindLinksPrompt({ noteTitle: n(0).title, noteContent: n(0).content, titles }), maxTokens: MAX_TOKENS.findLinks },
  { category: "Knowledge Mapping", label: "map: find links note 2", feature: "find-links", system: SYSTEM.findLinks, user: buildFindLinksPrompt({ noteTitle: n(1).title, noteContent: n(1).content, titles }), maxTokens: MAX_TOKENS.findLinks },
  { category: "Knowledge Mapping", label: "map: find links note 3", feature: "find-links", system: SYSTEM.findLinks, user: buildFindLinksPrompt({ noteTitle: n(2).title, noteContent: n(2).content, titles }), maxTokens: MAX_TOKENS.findLinks },

  // ── Lecture Capture (lecture-notes — processing recorded lectures)
  { category: "Lecture Capture", label: "lecture: session 1", feature: "lecture-notes", system: SYSTEM.lecture, user: buildLecturePrompt(n(0).content.slice(0, 2000), titles), maxTokens: MAX_TOKENS.lecture },
  { category: "Lecture Capture", label: "lecture: session 2", feature: "lecture-notes", system: SYSTEM.lecture, user: buildLecturePrompt(n(1).content.slice(0, 2000), titles), maxTokens: MAX_TOKENS.lecture },
  { category: "Lecture Capture", label: "lecture: session 3", feature: "lecture-notes", system: SYSTEM.lecture, user: buildLecturePrompt(n(2).content.slice(0, 2000), titles), maxTokens: MAX_TOKENS.lecture },
];

// ── stub / live call ─────────────────────────────────────────────────────────

interface CallResult { text: string; inputTokens: number; outputTokens: number }

async function callAI(q: BenchQuery): Promise<CallResult> {
  if (IS_STUB) {
    return {
      text: `[stub] ${q.feature}`,
      inputTokens: tok(q.system + q.user),
      outputTokens: STUB_OUT[q.feature] ?? 50,
    };
  }
  const { getOpenAI, TEXT_MODEL } = await import("../server/ai/openai.ts");
  const openai = getOpenAI()!;
  const res = await openai.chat.completions.create({
    model: TEXT_MODEL,
    max_tokens: q.maxTokens,
    temperature: 0,
    messages: [{ role: "system", content: q.system }, { role: "user", content: q.user }],
  });
  return {
    text: res.choices[0]?.message?.content?.trim() ?? "",
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
  };
}

// ── cache helpers ─────────────────────────────────────────────────────────────

function hashKey(q: BenchQuery) { return sha256Hex(q.feature + q.system + q.user); }

function cacheHit(q: BenchQuery): boolean {
  const row = getAiCacheByHash(hashKey(q));
  if (row && row.expires_at > Math.floor(Date.now() / 1000)) {
    incrementAiCacheHit(row.id);
    return true;
  }
  return false;
}

function storeCache(q: BenchQuery, r: CallResult): void {
  const now = Math.floor(Date.now() / 1000);
  try {
    insertAiCache({
      content_hash: hashKey(q),
      note_hash: null,
      question_embed: null,
      feature: q.feature,
      response: r.text,
      input_tokens: r.inputTokens,
      output_tokens: r.outputTokens,
      created_at: now,
      expires_at: now + TTL,
    });
  } catch { /* ignore duplicates */ }
}

// ── pass 1: warm cache ───────────────────────────────────────────────────────

interface RunResult { category: Category; label: string; feature: Feature; inputTokens: number; outputTokens: number; hit: boolean }

console.log(`\n🔄  Pass 1 — Session 1 (${QUERIES.length} queries, all misses)…`);
const pass1: RunResult[] = [];
for (const q of QUERIES) {
  const r = await callAI(q);
  storeCache(q, r);
  pass1.push({ category: q.category, label: q.label, feature: q.feature, inputTokens: r.inputTokens, outputTokens: r.outputTokens, hit: false });
  process.stdout.write(".");
}
console.log();

// ── pass 2: replay ───────────────────────────────────────────────────────────

console.log(`\n🔁  Pass 2 — Session 2 replay (${QUERIES.length} queries)…`);
const pass2: RunResult[] = [];
for (const q of QUERIES) {
  const stored = getAiCacheByHash(hashKey(q));
  const hit = cacheHit(q);
  if (hit && stored) {
    pass2.push({ category: q.category, label: q.label, feature: q.feature, inputTokens: 0, outputTokens: 0, hit: true });
    process.stdout.write("H");
  } else {
    const r = await callAI(q);
    storeCache(q, r);
    pass2.push({ category: q.category, label: q.label, feature: q.feature, inputTokens: r.inputTokens, outputTokens: r.outputTokens, hit: false });
    process.stdout.write("M");
  }
}
console.log();

// ── compute per-category stats ────────────────────────────────────────────────

const CATEGORIES: Category[] = ["Active Recall", "Content Writing", "Spaced Repetition", "Knowledge Mapping", "Lecture Capture"];

interface CategorStat {
  category: Category;
  feature: Feature;
  queries: number;
  p1Input: number;
  p1Output: number;
  p2Input: number;
  p2Output: number;
  savedInput: number;
  savedOutput: number;
  savedTotal: number;
  hits: number;
  hitRate: number;
}

// Map category to feature (for display)
const CATEGORY_FEATURE: Record<Category, Feature> = {
  "Active Recall": "chat",
  "Content Writing": "summarize",
  "Spaced Repetition": "flashcards",
  "Knowledge Mapping": "find-links",
  "Lecture Capture": "lecture-notes",
};

const catStats: CategorStat[] = CATEGORIES.map((cat) => {
  const p1rows = pass1.filter((r) => r.category === cat);
  const p2rows = pass2.filter((r) => r.category === cat);
  const p1Input = p1rows.reduce((s, r) => s + r.inputTokens, 0);
  const p1Output = p1rows.reduce((s, r) => s + r.outputTokens, 0);
  const p2Input = p2rows.reduce((s, r) => s + r.inputTokens, 0);
  const p2Output = p2rows.reduce((s, r) => s + r.outputTokens, 0);
  const hits = p2rows.filter((r) => r.hit).length;
  // Avoided tokens = what pass-2 hits would have cost (from pass-1 rows)
  const savedInput = p1rows.filter((_, i) => p2rows[i]?.hit).reduce((s, r) => s + r.inputTokens, 0);
  const savedOutput = p1rows.filter((_, i) => p2rows[i]?.hit).reduce((s, r) => s + r.outputTokens, 0);
  return {
    category: cat,
    feature: CATEGORY_FEATURE[cat],
    queries: p1rows.length,
    p1Input, p1Output,
    p2Input, p2Output,
    savedInput,
    savedOutput,
    savedTotal: savedInput + savedOutput,
    hits,
    hitRate: p2rows.length > 0 ? (hits / p2rows.length) * 100 : 0,
  };
});

const totalSavedInput = catStats.reduce((s, c) => s + c.savedInput, 0);
const totalSavedOutput = catStats.reduce((s, c) => s + c.savedOutput, 0);
const totalHits = pass2.filter((r) => r.hit).length;
const overallHitRate = (totalHits / pass2.length) * 100;
const p1TotalInput = pass1.reduce((s, r) => s + r.inputTokens, 0);
const p1TotalOutput = pass1.reduce((s, r) => s + r.outputTokens, 0);

// ── print to console ──────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(90)}`);
console.log(`${"Category".padEnd(22)} ${"Feature".padEnd(18)} ${"Queries".padStart(7)} ${"In saved".padStart(10)} ${"Out saved".padStart(10)} ${"Total saved".padStart(12)} ${"Hit rate".padStart(9)}`);
console.log("─".repeat(90));
for (const c of catStats) {
  console.log(`${c.category.padEnd(22)} ${c.feature.padEnd(18)} ${String(c.queries).padStart(7)} ${String(c.savedInput).padStart(10)} ${String(c.savedOutput).padStart(10)} ${String(c.savedTotal).padStart(12)} ${(c.hitRate.toFixed(1) + "%").padStart(9)}`);
}
console.log("─".repeat(90));
console.log(`${"TOTAL".padEnd(22)} ${"".padEnd(18)} ${String(QUERIES.length).padStart(7)} ${String(totalSavedInput).padStart(10)} ${String(totalSavedOutput).padStart(10)} ${String(totalSavedInput + totalSavedOutput).padStart(12)} ${(overallHitRate.toFixed(1) + "%").padStart(9)}`);
console.log(`${"─".repeat(90)}\n`);

// ── write report ──────────────────────────────────────────────────────────────

const stubNote = IS_STUB ? "\n\n> **Stub mode** — no `OPENAI_API_KEY` set. Input tokens via `gpt-tokenizer`; output tokens use per-feature averages. Cache hit logic is real." : "";
const report = `# Category-Level Token Savings Benchmark

_Generated ${new Date().toISOString()} · ${IS_STUB ? "STUB mode" : "real API"} · ${QUERIES.length} queries/session_${stubNote}

## Overview

| Metric | Value |
|---|--:|
| Overall cache hit rate (session 2) | **${overallHitRate.toFixed(1)}%** (${totalHits}/${pass2.length}) |
| Total input tokens saved | **${totalSavedInput}** |
| Total output tokens saved | **${totalSavedOutput}** |
| Combined tokens saved | **${totalSavedInput + totalSavedOutput}** |

## Session 1 Cost (cache cold)

| Metric | Value |
|---|--:|
| Total input tokens | ${p1TotalInput} |
| Total output tokens | ${p1TotalOutput} |
| Total tokens | ${p1TotalInput + p1TotalOutput} |

## Per-Category Savings (Session 2 vs Session 1 baseline)

| Category | Use Case | Queries | Input saved | Output saved | Total saved | Hit rate |
|---|---|--:|--:|--:|--:|--:|
${catStats.map((c) => `| **${c.category}** | \`${c.feature}\` | ${c.queries} | ${c.savedInput} | ${c.savedOutput} | ${c.savedTotal} | ${c.hitRate.toFixed(1)}% |`).join("\n")}
| **TOTAL** | — | **${QUERIES.length}** | **${totalSavedInput}** | **${totalSavedOutput}** | **${totalSavedInput + totalSavedOutput}** | **${overallHitRate.toFixed(1)}%** |

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
${pass2.map((r, i) => `| ${i + 1} | ${r.category} | ${r.label} | ${r.hit ? "✓ exact" : "miss"} | ${r.inputTokens} | ${r.outputTokens} |`).join("\n")}

---

_Regenerate: \`cd landing && npm run benchmark:categories\`_
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, "report.md"), report);
writeFileSync(resolve(OUT_DIR, "results.json"), JSON.stringify({ catStats, pass1, pass2 }, null, 2));
console.log(`📄  Report written to docs/benchmarks/categories/`);
