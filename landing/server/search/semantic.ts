import { embedder } from "./embedder.ts";
import { dot } from "./vec.ts";
import {
  getUserPassageVectors, getUserMemoryVectors, bumpMemoryUsage,
  searchFiles, recallMemories, type PublicMemory,
  getMemoriesMissingEmbedding, getFileIdsMissingPassages, getFileContent,
} from "../db.ts";
import { bestSnippet } from "./snippet.ts";
import { reembedNote, embedMemory } from "./embedNote.ts";

const FLOOR = 0.25; // mirrors the client's EMBED_SCORE_FLOOR

export interface NoteSearchResult { fileId: string; title: string; path: string; headingPath: string[]; snippet: string; score: number }

export async function semanticSearchNotes(userId: string, query: string, limit: number): Promise<NoteSearchResult[]> {
  const q = query.trim();
  if (q && embedder.ready()) {
    try {
      const rows = getUserPassageVectors(userId);
      if (rows.length > 0) {
        const [qv] = await embedder.embed([q]);
        return rows
          .map((r) => ({ r, score: dot(qv, r.vec) }))
          .filter((s) => s.score >= FLOOR)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((s) => ({ fileId: s.r.fileId, title: s.r.title, path: s.r.path, headingPath: s.r.headingPath, snippet: s.r.text.slice(0, 160), score: s.score }));
      }
    } catch { /* fall through to lexical */ }
  }
  return searchFiles(userId, q, limit).map((h) => {
    const { headingPath, snippet } = bestSnippet(h.content, q);
    return { fileId: h.fileId, title: h.title, path: h.path, headingPath, snippet, score: h.score };
  });
}

export async function semanticRecall(userId: string, scopes: string[], query: string, type: string | undefined, limit: number): Promise<(PublicMemory & { score: number })[]> {
  const q = query.trim();
  if (q && embedder.ready()) {
    try {
      const rows = getUserMemoryVectors(userId, scopes, type);
      if (rows.length > 0) {
        const [qv] = await embedder.embed([q]);
        const scored = rows
          .map((r) => ({ r, score: dot(qv, r.vec) }))
          .filter((s) => s.score >= FLOOR)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        bumpMemoryUsage(scored.map((s) => s.r.mem.id));
        return scored.map((s) => ({ ...s.r.mem, score: s.score }));
      }
    } catch { /* fall through to lexical */ }
  }
  return recallMemories(userId, scopes, query, type, limit);
}

/** One-shot, best-effort: embed any content lacking vectors. Call after the model warms; never throws. */
export async function backfillEmbeddings(): Promise<void> {
  try {
    for (const m of getMemoriesMissingEmbedding()) await embedMemory(m.id, m.text);
    for (const fileId of getFileIdsMissingPassages()) {
      const f = getFileContent(fileId);
      if (f) await reembedNote(f.id, f.content);
    }
  } catch { /* best-effort */ }
}
