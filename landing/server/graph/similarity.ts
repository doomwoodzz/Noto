// landing/server/graph/similarity.ts
import { cosine } from "../search/vec.ts";
import { embedder } from "../search/embedder.ts";
import { getVaultPassageVectors } from "../db.ts";
import { MIN_SEMANTIC_SIMILARITY, TOP_K_SEMANTIC, type PersistedEdge } from "../../src/noto-core/graphEdges.ts";

function pushTo(map: Map<string, Float32Array[]>, key: string, value: Float32Array): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Mean-pool a note's (already L2-normalized) passage vectors into one note-level vector, renormalized. */
export function meanPool(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) throw new Error("meanPool: at least one vector required");
  const dim = vectors[0].length;
  const sum = new Float32Array(dim);
  for (const v of vectors) for (let i = 0; i < dim; i += 1) sum[i] += v[i];
  let norm = 0;
  for (let i = 0; i < dim; i += 1) { sum[i] /= vectors.length; norm += sum[i] * sum[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i += 1) sum[i] /= norm;
  return sum;
}

export interface NoteCandidate {
  fileId: string;
  content: string;
}

/**
 * Compute `semantically_similar_to` edges FROM each under-linked note. Reuses
 * the passage vectors Smart Search already computed (getVaultPassageVectors)
 * — only a note with zero indexed passages gets a fresh embedder.embed() call.
 */
export async function computeSemanticEdges(vaultId: string, underLinked: NoteCandidate[]): Promise<PersistedEdge[]> {
  if (underLinked.length === 0 || !embedder.ready()) return [];

  const byFile = new Map<string, Float32Array[]>();
  for (const row of getVaultPassageVectors(vaultId)) pushTo(byFile, row.fileId, row.vec);

  const noteVectors = new Map<string, Float32Array>();
  for (const [fileId, vecs] of byFile) noteVectors.set(fileId, meanPool(vecs));

  const missing = underLinked.filter((n) => !noteVectors.has(n.fileId));
  if (missing.length > 0) {
    const fresh = await embedder.embed(missing.map((n) => n.content));
    missing.forEach((n, i) => noteVectors.set(n.fileId, fresh[i]));
  }

  const edges: PersistedEdge[] = [];
  for (const note of underLinked) {
    const qvec = noteVectors.get(note.fileId);
    if (!qvec) continue;
    const scored = [...noteVectors.entries()]
      .filter(([id]) => id !== note.fileId)
      .map(([id, vec]) => ({ id, score: cosine(qvec, vec) }))
      .filter((s) => s.score >= MIN_SEMANTIC_SIMILARITY)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K_SEMANTIC);
    for (const { id: targetId, score } of scored) {
      edges.push({
        id: `${note.fileId}->${targetId}:semantically_similar_to`,
        sourceId: note.fileId,
        targetId,
        relation: "semantically_similar_to",
        confidence: "INFERRED",
        confidenceScore: Math.round(score * 1000) / 1000,
      });
    }
  }
  return edges;
}
