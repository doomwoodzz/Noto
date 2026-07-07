// landing/scripts/benchmark-graph-edges.mts
/**
 * Benchmark: MiniLM call count + token cost for finding related notes,
 * before (repeated semantic search per query) vs. after (one-time graph
 * rebuild, then free reads via queryVaultGraph).
 *
 * Plan: docs/superpowers/plans/2026-07-06-graph-edges-layer.md
 *
 * Uses a counting fake embedder (not the real ONNX model) so the benchmark is
 * fast and deterministic — it measures call count and token volume of the
 * text passed to embed(), not retrieval quality.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encode } from "gpt-tokenizer/model/gpt-4o";

const dir = mkdtempSync(join(tmpdir(), "noto-bench-graph-"));
process.env.DATABASE_PATH = join(dir, "bench.sqlite");

const { ensureLocalOwner, createVault, createFile } = await import("../server/db.ts");
const { setEmbedder } = await import("../server/search/embedder.ts");
const { reembedNote } = await import("../server/search/embedNote.ts");
const { rebuildVaultGraph } = await import("../server/graph/build.ts");
const { queryVaultGraph } = await import("../server/graph/query.ts");
const { semanticSearchNotes } = await import("../server/search/semantic.ts");

const NOTE_COUNT = 40;
const QUERY_COUNT = 10;

let embedCalls = 0;
let embedTokens = 0;
setEmbedder({
  ready: () => true,
  embed: async (texts: string[]) => {
    embedCalls += 1;
    for (const t of texts) embedTokens += encode(t).length;
    return texts.map((_, i) => {
      const v = new Float32Array(32);
      v[i % 32] = 1;
      return v;
    });
  },
});

const user = ensureLocalOwner();
const vault = createVault(user.id, { name: "Bench Vault" });

const TOPICS = ["Photosynthesis", "Mitochondria", "Cold War", "Logarithms", "Enzymes"];
const files: { id: string }[] = [];
for (let i = 0; i < NOTE_COUNT; i += 1) {
  const topic = TOPICS[i % TOPICS.length];
  const linksBack = i > 0 && i % 4 === 0
    ? `\n\nSee [[Note ${i - 1}]] and [[Note ${Math.max(i - 2, 0)}]] and #${topic.toLowerCase()}.`
    : "";
  const file = createFile(vault.id, {
    path: `Note ${i}.md`,
    title: `Note ${i}`,
    content: `${topic} discussion, part ${i}.${linksBack}`,
  });
  files.push(file);
}

// Index each note's passages exactly as the real save path does (reembedNote),
// so getUserPassageVectors is populated and semanticSearchNotes actually takes
// its embed-the-query branch — otherwise it short-circuits to lexical search.
for (let i = 0; i < files.length; i += 1) {
  const topic = TOPICS[i % TOPICS.length];
  await reembedNote(files[i].id, `${topic} discussion, part ${i}.`);
}

// --- BEFORE: every "find related notes" query re-embeds the query text ---
embedCalls = 0;
embedTokens = 0;
for (let i = 0; i < QUERY_COUNT; i += 1) {
  await semanticSearchNotes(user.id, `What relates to ${TOPICS[i % TOPICS.length]}?`, 5);
}
const before = { calls: embedCalls, tokens: embedTokens };

// --- AFTER: one graph rebuild, then free reads via queryVaultGraph ---
embedCalls = 0;
embedTokens = 0;
await rebuildVaultGraph(vault.id);
const rebuildCost = { calls: embedCalls, tokens: embedTokens };

embedCalls = 0;
embedTokens = 0;
for (let i = 0; i < QUERY_COUNT; i += 1) {
  queryVaultGraph(vault.id, files[i % files.length].id, 10);
}
const after = { calls: embedCalls, tokens: embedTokens };

console.log(`Notes in vault:                    ${NOTE_COUNT}`);
console.log(`Before (repeated semantic search): ${before.calls} embed calls, ${before.tokens} tokens across ${QUERY_COUNT} queries`);
console.log(`After  (one-time graph rebuild):    ${rebuildCost.calls} embed calls, ${rebuildCost.tokens} tokens (amortized over the vault's lifetime)`);
console.log(`After  (${QUERY_COUNT} graph reads):          ${after.calls} embed calls, ${after.tokens} tokens`);
console.log(`Query-time embed calls avoided:    ${before.calls - after.calls}`);

rmSync(dir, { recursive: true, force: true });
