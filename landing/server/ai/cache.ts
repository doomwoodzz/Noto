import { sha256Hex, floatsToBlob, blobToFloats, getAiCacheByHash, getAiCacheChatBucket, insertAiCache, incrementAiCacheHit, deleteAiCacheRow } from "../db.ts";
import { complete } from "./openai.ts";
import { embedder } from "../search/embedder.ts";
import { dot } from "../search/vec.ts";
import { env } from "../env.ts";

const SEMANTIC_THRESHOLD = 0.92;

export type CacheFeature =
  | "chat"
  | "summarize"
  | "flashcards"
  | "find-links"
  | "lecture-notes";

export async function completeWithCache(opts: {
  feature: CacheFeature;
  system: string;
  user: string;
  maxTokens: number;
  noteTitle?: string;
  noteContent?: string;
  question?: string;
  apiKey?: string;
  model?: string;
}): Promise<string> {
  const contentHash = sha256Hex(opts.feature + opts.system + opts.user);
  const nowSec = Math.floor(Date.now() / 1000);
  const isChatWithContext =
    opts.feature === "chat" &&
    opts.noteTitle !== undefined &&
    opts.noteContent !== undefined &&
    opts.question !== undefined;

  // 1. Content-hash check — fastest path
  try {
    const cached = getAiCacheByHash(contentHash);
    if (cached) {
      if (cached.expires_at > nowSec) {
        incrementAiCacheHit(cached.id);
        return cached.response;
      }
      deleteAiCacheRow(cached.id); // lazy eviction of expired row
    }
  } catch (err) {
    console.error("[ai-cache] read error:", err);
  }

  // 2. Semantic fallback — chat only, when embedder is ready
  let cachedQueryVec: Float32Array | null = null;
  let cachedNoteHash: string | null = null;

  if (isChatWithContext && embedder.ready()) {
    try {
      cachedNoteHash = sha256Hex(opts.noteTitle! + opts.noteContent!);
      [cachedQueryVec] = await embedder.embed([opts.question!]);
      const bucket = getAiCacheChatBucket(cachedNoteHash, nowSec);

      let bestId = -1;
      let bestScore = 0;
      let bestResponse = "";
      for (const row of bucket) {
        if (!row.question_embed) continue;
        const score = dot(cachedQueryVec, blobToFloats(row.question_embed));
        if (score > bestScore) {
          bestScore = score;
          bestId = row.id;
          bestResponse = row.response;
        }
      }
      if (bestScore >= SEMANTIC_THRESHOLD) {
        incrementAiCacheHit(bestId);
        return bestResponse;
      }
    } catch (err) {
      console.debug("[ai-cache] semantic lookup skipped:", err);
      cachedQueryVec = null;
      cachedNoteHash = null;
    }
  }

  // 3. Miss — call OpenAI
  const { text, inputTokens, outputTokens } = await complete({
    system: opts.system,
    user: opts.user,
    maxTokens: opts.maxTokens,
    apiKey: opts.apiKey,
    model: opts.model,
  });

  // 4. Store result (best-effort; write failures never surface to the caller).
  const storeAt = Math.floor(Date.now() / 1000);
  try {
    // Compute chat embedding for storage if not already done during lookup
    if (isChatWithContext && !cachedQueryVec && embedder.ready()) {
      try {
        cachedNoteHash = sha256Hex(opts.noteTitle! + opts.noteContent!);
        [cachedQueryVec] = await embedder.embed([opts.question!]);
      } catch { /* store without embedding */ }
    }
    insertAiCache({
      content_hash: contentHash,
      note_hash: cachedNoteHash,
      question_embed: cachedQueryVec ? floatsToBlob(cachedQueryVec) : null,
      feature: opts.feature,
      response: text,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      created_at: storeAt,
      expires_at: storeAt + env.aiCacheTtlSeconds,
    });
  } catch (err) {
    console.error("[ai-cache] write error:", err);
  }

  return text;
}
