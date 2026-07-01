/**
 * Output-token savings benchmark.
 *
 * Measures how much the AI response cache (cache.ts) cuts token spend across
 * two sessions:
 *   Pass 1 (warm) — 15 unique queries hit OpenAI and populate the cache.
 *   Pass 2 (replay) — the same 15 queries + 5 paraphrased chat variants are
 *   served from cache (0 tokens billed for hits) or fall through to OpenAI.
 *
 * In stub mode (no OPENAI_API_KEY) real calls are replaced by a deterministic
 * estimator that uses gpt-tokenizer for input tokens and per-feature averages
 * for output tokens. The report labels this clearly.
 *
 * Run: cd landing && npm run benchmark:output-savings
 * Spec: docs/superpowers/specs/2026-06-30-noto-output-token-savings-design.md
 */

process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV ??= "development";
// Provide a dummy key so env.ts does not throw; in stub mode we never call OpenAI.
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = "stub";

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { encode } from "gpt-tokenizer/model/gpt-4o";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const OUT_DIR = resolve(repoRoot, "docs/benchmarks/output-savings");

const db = await import("../server/db.ts");
const { NotoData } = await import("../src/noto/mockVault.ts");
const { SYSTEM, buildChatPrompt, buildSummarizePrompt, buildFlashcardsPrompt, buildFindLinksPrompt, buildLecturePrompt } = await import("../server/ai/prompts.ts");
const { MAX_TOKENS } = await import("../server/ai/openai.ts");
const { sha256Hex, insertAiCache, getAiCacheByHash, getAiCacheChatBucket, incrementAiCacheHit, floatsToBlob, blobToFloats } = await import("../server/db.ts");

const IS_STUB = process.env.OPENAI_API_KEY === "stub" || !process.env.OPENAI_API_KEY;
const tok = (s: string) => encode(s).length;
const TTL = 7 * 24 * 60 * 60;
const SEMANTIC_THRESHOLD = 0.92;

// Per-feature average output token estimates for stub mode (derived from real API observations)
const STUB_OUT: Record<string, number> = {
  chat: 55,
  summarize: 80,
  flashcards: 230,
  "find-links": 25,
  "lecture-notes": 380,
};

// ──────────────────────────── seed DB ────────────────────────────

const user = db.createUser({ email: `bench-out-sav-${randomUUID()}@example.com` });
const vault = db.createVault(user.id, { name: "Benchmark Vault" });
const files = NotoData.files as { path: string; title: string; content: string }[];
for (const f of files) db.createFile(vault.id, { path: f.path, title: f.title, content: f.content });
const titles = files.map((f) => f.title);
const firstNote = files[0];
const secondNote = files[1] ?? files[0];

// ──────────────────────────── query definitions ────────────────────────────

type Feature = "chat" | "summarize" | "flashcards" | "find-links" | "lecture-notes";

interface BenchQuery {
  label: string;
  feature: Feature;
  system: string;
  user: string;
  maxTokens: number;
  noteTitle?: string;
  noteContent?: string;
  question?: string;
}

const PASS1_QUERIES: BenchQuery[] = [
  // chat — 5 queries across two notes
  { label: "chat: main theme", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: firstNote.title, noteContent: firstNote.content, question: "What is the main theme of this note?" }), maxTokens: MAX_TOKENS.chat, noteTitle: firstNote.title, noteContent: firstNote.content, question: "What is the main theme of this note?" },
  { label: "chat: key terms", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: firstNote.title, noteContent: firstNote.content, question: "List the key terms defined here." }), maxTokens: MAX_TOKENS.chat, noteTitle: firstNote.title, noteContent: firstNote.content, question: "List the key terms defined here." },
  { label: "chat: study tip", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: secondNote.title, noteContent: secondNote.content, question: "What should I focus on when studying this?" }), maxTokens: MAX_TOKENS.chat, noteTitle: secondNote.title, noteContent: secondNote.content, question: "What should I focus on when studying this?" },
  { label: "chat: connections", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: secondNote.title, noteContent: secondNote.content, question: "How does this connect to other topics?" }), maxTokens: MAX_TOKENS.chat, noteTitle: secondNote.title, noteContent: secondNote.content, question: "How does this connect to other topics?" },
  { label: "chat: summary ask", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: firstNote.title, noteContent: firstNote.content, question: "Give me a two-sentence summary." }), maxTokens: MAX_TOKENS.chat, noteTitle: firstNote.title, noteContent: firstNote.content, question: "Give me a two-sentence summary." },
  // summarize — 3 notes
  ...files.slice(0, 3).map((f, i) => ({ label: `summarize: note ${i + 1}`, feature: "summarize" as Feature, system: SYSTEM.summarize, user: buildSummarizePrompt(f.title, f.content), maxTokens: MAX_TOKENS.summarize })),
  // flashcards — 3 notes
  ...files.slice(0, 3).map((f, i) => ({ label: `flashcards: note ${i + 1}`, feature: "flashcards" as Feature, system: SYSTEM.flashcards, user: buildFlashcardsPrompt(f.title, f.content), maxTokens: MAX_TOKENS.flashcards })),
  // find-links — 2 notes
  { label: "find-links: note 1", feature: "find-links", system: SYSTEM.findLinks, user: buildFindLinksPrompt({ noteTitle: firstNote.title, noteContent: firstNote.content, titles }), maxTokens: MAX_TOKENS.findLinks },
  { label: "find-links: note 2", feature: "find-links", system: SYSTEM.findLinks, user: buildFindLinksPrompt({ noteTitle: secondNote.title, noteContent: secondNote.content, titles }), maxTokens: MAX_TOKENS.findLinks },
  // lecture-notes — 2 transcripts
  { label: "lecture-notes: transcript 1", feature: "lecture-notes", system: SYSTEM.lecture, user: buildLecturePrompt(firstNote.content.slice(0, 2000), titles), maxTokens: MAX_TOKENS.lecture },
  { label: "lecture-notes: transcript 2", feature: "lecture-notes", system: SYSTEM.lecture, user: buildLecturePrompt(secondNote.content.slice(0, 2000), titles), maxTokens: MAX_TOKENS.lecture },
];

// 5 paraphrased chat queries — same note context, rephrased question
const PARAPHRASE_QUERIES: BenchQuery[] = [
  { label: "chat (para): what is the main point", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: firstNote.title, noteContent: firstNote.content, question: "What is the central point of this note?" }), maxTokens: MAX_TOKENS.chat, noteTitle: firstNote.title, noteContent: firstNote.content, question: "What is the central point of this note?" },
  { label: "chat (para): key vocabulary", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: firstNote.title, noteContent: firstNote.content, question: "What vocabulary should I know from this?" }), maxTokens: MAX_TOKENS.chat, noteTitle: firstNote.title, noteContent: firstNote.content, question: "What vocabulary should I know from this?" },
  { label: "chat (para): what to study", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: secondNote.title, noteContent: secondNote.content, question: "What are the most important parts to review?" }), maxTokens: MAX_TOKENS.chat, noteTitle: secondNote.title, noteContent: secondNote.content, question: "What are the most important parts to review?" },
  { label: "chat (para): links to other", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: secondNote.title, noteContent: secondNote.content, question: "What other subjects does this relate to?" }), maxTokens: MAX_TOKENS.chat, noteTitle: secondNote.title, noteContent: secondNote.content, question: "What other subjects does this relate to?" },
  { label: "chat (para): short summary", feature: "chat", system: SYSTEM.chat, user: buildChatPrompt({ noteTitle: firstNote.title, noteContent: firstNote.content, question: "Can you summarise this briefly?" }), maxTokens: MAX_TOKENS.chat, noteTitle: firstNote.title, noteContent: firstNote.content, question: "Can you summarise this briefly?" },
];

// ──────────────────────────── live call or stub ────────────────────────────

let realOpenAI: Awaited<ReturnType<typeof import("../server/ai/openai.ts").getOpenAI>> | null = null;
if (!IS_STUB) {
  const { getOpenAI, TEXT_MODEL } = await import("../server/ai/openai.ts");
  realOpenAI = getOpenAI();
}

interface CallResult { text: string; inputTokens: number; outputTokens: number }

async function callAI(q: BenchQuery): Promise<CallResult> {
  if (IS_STUB || !realOpenAI) {
    const inputTokens = tok(q.system + q.user);
    const outputTokens = STUB_OUT[q.feature] ?? 50;
    return { text: `[stub] ${q.feature}`, inputTokens, outputTokens };
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

// ──────────────────────────── cache helpers (inline — no embedder in benchmark) ────────────────────────────

function cacheHit(q: BenchQuery): string | null {
  const nowSec = Math.floor(Date.now() / 1000);
  const hash = sha256Hex(q.feature + q.system + q.user);
  const row = getAiCacheByHash(hash);
  if (row && row.expires_at > nowSec) {
    incrementAiCacheHit(row.id);
    return row.response;
  }
  return null;
}

function storeCache(q: BenchQuery, result: CallResult): void {
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    insertAiCache({
      content_hash: sha256Hex(q.feature + q.system + q.user),
      note_hash: (q.noteTitle && q.noteContent) ? sha256Hex(q.noteTitle + q.noteContent) : null,
      question_embed: null, // no embedder in benchmark script
      feature: q.feature,
      response: result.text,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      created_at: nowSec,
      expires_at: nowSec + TTL,
    });
  } catch { /* ignore */ }
}

// ──────────────────────────── passes ────────────────────────────

interface QueryResult { label: string; feature: string; inputTokens: number; outputTokens: number; hit: boolean; hitType: "exact" | "none" }

console.log(`\n🔄  Pass 1 — warm cache (${PASS1_QUERIES.length} queries)…`);
const pass1: QueryResult[] = [];
for (const q of PASS1_QUERIES) {
  const result = await callAI(q);
  storeCache(q, result);
  pass1.push({ label: q.label, feature: q.feature, inputTokens: result.inputTokens, outputTokens: result.outputTokens, hit: false, hitType: "none" });
  process.stdout.write(".");
}
console.log();

console.log(`\n🔁  Pass 2 — replay (${PASS1_QUERIES.length + PARAPHRASE_QUERIES.length} queries)…`);
const pass2: QueryResult[] = [];
for (const q of [...PASS1_QUERIES, ...PARAPHRASE_QUERIES]) {
  const cached = cacheHit(q);
  if (cached !== null) {
    // Cache hit — 0 tokens billed; record avoided cost from stored row
    const stored = getAiCacheByHash(sha256Hex(q.feature + q.system + q.user));
    pass2.push({ label: q.label, feature: q.feature, inputTokens: 0, outputTokens: 0, hit: true, hitType: "exact" });
    process.stdout.write("H");
  } else {
    const result = await callAI(q);
    storeCache(q, result);
    pass2.push({ label: q.label, feature: q.feature, inputTokens: result.inputTokens, outputTokens: result.outputTokens, hit: false, hitType: "none" });
    process.stdout.write("M");
  }
}
console.log();

// ──────────────────────────── compute stats ────────────────────────────

const p1InputTotal = pass1.reduce((s, r) => s + r.inputTokens, 0);
const p1OutputTotal = pass1.reduce((s, r) => s + r.outputTokens, 0);
const p2InputTotal = pass2.reduce((s, r) => s + r.inputTokens, 0);
const p2OutputTotal = pass2.reduce((s, r) => s + r.outputTokens, 0);
const p2Hits = pass2.filter((r) => r.hit).length;
const hitRate = (p2Hits / pass2.length) * 100;

// Avoided cost = what pass-2 hits would have cost (stored input+output from pass1 rows)
const p2AvoidedInput = pass2.filter(r => r.hit).reduce((s, r) => {
  const stored = getAiCacheByHash(sha256Hex(r.feature + (PASS1_QUERIES.find(q => q.label === r.label)?.system ?? "") + (PASS1_QUERIES.find(q => q.label === r.label)?.user ?? "")));
  return s + (stored?.input_tokens ?? 0);
}, 0);
const p2AvoidedOutput = pass2.filter(r => r.hit).reduce((s, r) => {
  const stored = getAiCacheByHash(sha256Hex(r.feature + (PASS1_QUERIES.find(q => q.label === r.label)?.system ?? "") + (PASS1_QUERIES.find(q => q.label === r.label)?.user ?? "")));
  return s + (stored?.output_tokens ?? 0);
}, 0);

const savedInput = p2AvoidedInput;
const savedOutput = p2AvoidedOutput;
const savedTotal = savedInput + savedOutput;
const baselineTotal = p1InputTotal + p1OutputTotal + p2InputTotal + p2OutputTotal + savedTotal;
const savedPct = baselineTotal > 0 ? (savedTotal / (p1InputTotal + p1OutputTotal + p2InputTotal + p2OutputTotal + savedTotal)) * 100 : 0;

// ──────────────────────────── report ────────────────────────────

const stubNote = IS_STUB ? "\n\n> **Stub mode** — no `OPENAI_API_KEY` configured. Input tokens estimated via `gpt-tokenizer o200k_base`; output tokens use per-feature averages. Cache hit logic is real." : "";

const report = `# Output Token Savings Benchmark

_Generated ${new Date().toISOString()} · ${IS_STUB ? "STUB mode (gpt-tokenizer estimates)" : `real gpt-4o-mini API`} · ${PASS1_QUERIES.length} warm + ${PASS1_QUERIES.length + PARAPHRASE_QUERIES.length} replay queries_${stubNote}

## Headline

| Metric | Value |
|---|--:|
| Cache hit rate (pass 2) | **${hitRate.toFixed(1)}%** (${p2Hits}/${pass2.length}) |
| Output tokens saved (pass 2) | **${savedOutput}** |
| Input tokens saved (pass 2) | **${savedInput}** |
| Combined tokens saved | **${savedTotal}** |

## Pass 1 — warm (all misses, populates cache)

| Metric | Value |
|---|--:|
| Total input tokens | ${p1InputTotal} |
| Total output tokens | ${p1OutputTotal} |
| Queries | ${pass1.length} |

## Pass 2 — replay

| Metric | Value |
|---|--:|
| Total input tokens billed | ${p2InputTotal} |
| Total output tokens billed | ${p2OutputTotal} |
| Queries | ${pass2.length} |
| Cache hits (0 tokens) | ${p2Hits} |
| Cache misses | ${pass2.length - p2Hits} |

## Per-query detail (pass 2)

| # | Label | Feature | Hit? | In | Out |
|---|---|---|---|--:|--:|
${pass2.map((r, i) => `| ${i + 1} | ${r.label} | ${r.feature} | ${r.hit ? "✓ exact" : "miss"} | ${r.inputTokens} | ${r.outputTokens} |`).join("\n")}

---

_Regenerate: \`cd landing && npm run benchmark:output-savings\`_
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, "report.md"), report);
writeFileSync(resolve(OUT_DIR, "results.json"), JSON.stringify({ pass1, pass2, stats: { p1InputTotal, p1OutputTotal, p2InputTotal, p2OutputTotal, p2Hits, hitRate, savedInput, savedOutput, savedTotal } }, null, 2));

console.log(`\n✅  Cache hit rate: ${hitRate.toFixed(1)}% — output tokens saved: ${savedOutput} — combined saved: ${savedTotal}`);
console.log(`📄  Report written to docs/benchmarks/output-savings/`);
