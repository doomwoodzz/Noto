// landing/server/graph/cluster.ts
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { PersistedEdge } from "../../src/noto-core/graphEdges.ts";

/**
 * Assign a community id to every node. Uses Louvain
 * (graphology-communities-louvain); if that throws for any reason, falls back
 * to a deterministic label-propagation pass so clustering degrades gracefully
 * instead of failing the whole graph rebuild.
 */
export function assignCommunities(nodeIds: string[], edges: PersistedEdge[]): Map<string, number> {
  try {
    return louvainCommunities(nodeIds, edges);
  } catch {
    return labelPropagation(nodeIds, edges);
  }
}

function louvainCommunities(nodeIds: string[], edges: PersistedEdge[]): Map<string, number> {
  const graph = new Graph({ type: "undirected", multi: false, allowSelfLoops: false });
  for (const id of nodeIds) graph.mergeNode(id);
  for (const e of edges) {
    if (e.sourceId === e.targetId) continue;
    graph.mergeNode(e.sourceId);
    graph.mergeNode(e.targetId);
    if (!graph.hasEdge(e.sourceId, e.targetId)) graph.addEdge(e.sourceId, e.targetId, { weight: e.confidenceScore });
  }
  const assignment = louvain(graph);
  return new Map(Object.entries(assignment));
}

/** Deterministic fallback: repeatedly adopt the majority neighbor label until stable (capped iterations). */
function labelPropagation(nodeIds: string[], edges: PersistedEdge[]): Map<string, number> {
  const neighbors = new Map<string, string[]>();
  for (const id of nodeIds) neighbors.set(id, []);
  for (const e of edges) {
    if (e.sourceId === e.targetId) continue;
    neighbors.get(e.sourceId)?.push(e.targetId);
    neighbors.get(e.targetId)?.push(e.sourceId);
  }
  const labels = new Map<string, number>(nodeIds.map((id, i) => [id, i]));
  for (let pass = 0; pass < 10; pass += 1) {
    let changed = false;
    for (const id of nodeIds) {
      const ns = neighbors.get(id) ?? [];
      if (ns.length === 0) continue;
      const counts = new Map<number, number>();
      for (const n of ns) {
        const label = labels.get(n)!;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      if (best !== labels.get(id)) {
        labels.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return labels;
}
