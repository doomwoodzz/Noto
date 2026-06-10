// Faithful port of Sources/NotoCore/Lib/GraphBuilder.swift
import type {
  GraphEdge,
  GraphFilter,
  GraphNode,
  KnowledgeGraph,
  MetadataCache,
  VaultFile,
} from "./types";

const LECTURE_PREFIX = "AI Lecture Notes/";

export function buildGraph(files: VaultFile[], cache: MetadataCache): KnowledgeGraph {
  const nodes: GraphNode[] = files.map((file) => {
    const meta = cache.filesById[file.id];
    const backlinksCount = meta?.backlinks.length ?? 0;
    const outgoingCount = meta?.outgoingLinks.length ?? 0;
    return {
      id: file.id,
      title: file.title,
      path: file.path,
      backlinksCount,
      outgoingCount,
      degree: backlinksCount + outgoingCount,
    };
  });

  const edges: GraphEdge[] = [];
  for (const file of files) {
    const meta = cache.filesById[file.id];
    if (!meta) continue;
    for (const targetTitle of meta.outgoingLinks) {
      const targetId = cache.fileIdByTitle[targetTitle];
      if (targetId === undefined) continue;
      edges.push({
        id: `${file.id}->${targetId}`,
        source: file.id,
        target: targetId,
        weight: 1,
      });
    }
  }

  return { nodes, edges };
}

export function filterGraph(
  graph: KnowledgeGraph,
  mode: GraphFilter,
  activeFileId: string,
): KnowledgeGraph {
  switch (mode) {
    case "all":
      return graph;
    case "local":
      return subgraph(graph, localNodeIds(graph, activeFileId));
    case "lectureOnly": {
      const ids = new Set(
        graph.nodes.filter((n) => n.path.startsWith(LECTURE_PREFIX)).map((n) => n.id),
      );
      return subgraph(graph, ids);
    }
    case "orphans": {
      const connected = new Set<string>();
      for (const e of graph.edges) {
        connected.add(e.source);
        connected.add(e.target);
      }
      const ids = new Set(graph.nodes.filter((n) => !connected.has(n.id)).map((n) => n.id));
      return subgraph(graph, ids);
    }
  }
}

function localNodeIds(graph: KnowledgeGraph, activeFileId: string): Set<string> {
  const ids = new Set<string>([activeFileId]);
  for (const edge of graph.edges) {
    if (edge.source === activeFileId) ids.add(edge.target);
    if (edge.target === activeFileId) ids.add(edge.source);
  }
  return ids;
}

function subgraph(graph: KnowledgeGraph, ids: Set<string>): KnowledgeGraph {
  return {
    nodes: graph.nodes.filter((n) => ids.has(n.id)),
    edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
}
