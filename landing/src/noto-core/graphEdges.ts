// landing/src/noto-core/graphEdges.ts
// Structural + semantic edge model shared by the graph rebuild (server/graph/*)
// and the budgeted query. Structural edges are free (already-parsed wikilinks
// and tags); semantic edges cost a MiniLM call and are computed server-side —
// this module only owns the shared edge shape, the link-density gate, and the
// traversal, so both producers speak the same language.
import type { FileMetadata, MetadataCache, VaultFile } from "./types";

export type EdgeRelation = "links_to" | "tagged_with" | "semantically_similar_to";
export type EdgeConfidence = "EXTRACTED" | "INFERRED";

export interface PersistedEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: EdgeRelation;
  confidence: EdgeConfidence;
  confidenceScore: number;
}

/** A note with 3+ explicit links/tags doesn't need a MiniLM call to place it in the graph. */
export const LINK_DENSITY_THRESHOLD = 3;

/** Below this cosine similarity, a semantic edge isn't worth storing. */
export const MIN_SEMANTIC_SIMILARITY = 0.55;

/** Max semantic neighbors kept per under-linked note. */
export const TOP_K_SEMANTIC = 5;

export function isWellLinked(meta: FileMetadata): boolean {
  return meta.outgoingLinks.length + meta.tags.length >= LINK_DENSITY_THRESHOLD;
}

/** Build EXTRACTED edges (links_to + tagged_with) for one file from the metadata cache. */
export function buildStructuralEdges(file: VaultFile, cache: MetadataCache): PersistedEdge[] {
  const meta = cache.filesById[file.id];
  if (!meta) return [];
  const edges: PersistedEdge[] = [];
  for (const targetTitle of meta.outgoingLinks) {
    const targetId = cache.fileIdByTitle[targetTitle];
    if (targetId === undefined || targetId === file.id) continue;
    edges.push({
      id: `${file.id}->${targetId}:links_to`,
      sourceId: file.id,
      targetId,
      relation: "links_to",
      confidence: "EXTRACTED",
      confidenceScore: 1,
    });
  }
  for (const tag of meta.tags) {
    edges.push({
      id: `${file.id}->tag:${tag}:tagged_with`,
      sourceId: file.id,
      targetId: `tag:${tag}`,
      relation: "tagged_with",
      confidence: "EXTRACTED",
      confidenceScore: 1,
    });
  }
  return edges;
}

export interface GraphQueryResult {
  nodeIds: string[];
  edges: PersistedEdge[];
}

function pushTo(byNode: Map<string, PersistedEdge[]>, node: string, edge: PersistedEdge): void {
  const list = byNode.get(node);
  if (list) list.push(edge);
  else byNode.set(node, [edge]);
}

/**
 * BFS from `startId` over `edges` (treated as undirected), expanding EXTRACTED
 * edges before INFERRED ones (ties broken by confidenceScore desc), capped at
 * `budget` visited nodes.
 */
export function budgetedQuery(edges: PersistedEdge[], startId: string, budget: number): GraphQueryResult {
  const byNode = new Map<string, PersistedEdge[]>();
  for (const e of edges) {
    pushTo(byNode, e.sourceId, e);
    if (e.targetId !== e.sourceId) pushTo(byNode, e.targetId, e);
  }

  const visited = new Set<string>([startId]);
  const frontier: string[] = [startId];
  const resultEdges: PersistedEdge[] = [];
  const seenEdgeIds = new Set<string>();

  while (frontier.length > 0 && visited.size < budget) {
    const current = frontier.shift()!;
    const neighbors = [...(byNode.get(current) ?? [])].sort((a, b) => {
      if (a.confidence !== b.confidence) return a.confidence === "EXTRACTED" ? -1 : 1;
      return b.confidenceScore - a.confidenceScore;
    });
    for (const edge of neighbors) {
      if (visited.size >= budget) break;
      const other = edge.sourceId === current ? edge.targetId : edge.sourceId;
      if (!seenEdgeIds.has(edge.id)) {
        seenEdgeIds.add(edge.id);
        resultEdges.push(edge);
      }
      if (!visited.has(other)) {
        visited.add(other);
        frontier.push(other);
      }
    }
  }
  return { nodeIds: [...visited], edges: resultEdges };
}
