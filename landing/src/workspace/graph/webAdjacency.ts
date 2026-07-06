// Builds the engine's immutable WebModel from the real KnowledgeGraph + files:
// undirected deduped links, symmetric neighbor lists, and plain-text snippets.

import { plainText, type KnowledgeGraph, type VaultFile } from "../../noto-core";
import type { WebModel, WebNode } from "./webTypes";

const SNIPPET_MAX = 220;

/** First path segment, e.g. "Biology/Cell.md" -> "Biology"; "" -> "Notes". */
export function topFolder(path: string): string {
  return path.split("/")[0] || "Notes";
}

/** Plain-text, whitespace-collapsed, ellipsis-truncated preview of note content. */
export function snippetFor(content: string): string {
  const t = plainText(content).replace(/\s+/g, " ").trim();
  return t.length > SNIPPET_MAX ? t.slice(0, SNIPPET_MAX - 1) + "…" : t;
}

export function buildWebModel(graph: KnowledgeGraph, files: VaultFile[]): WebModel {
  const contentById = new Map(files.map((f) => [f.id, f.content]));
  const indexById = new Map<string, number>();

  const nodes: WebNode[] = graph.nodes.map((n, i) => {
    indexById.set(n.id, i);
    return {
      id: n.id,
      title: n.title,
      folder: topFolder(n.path),
      path: n.path,
      deg: n.degree,
      ins: n.backlinksCount,
      outs: n.outgoingCount,
      snippet: snippetFor(contentById.get(n.id) ?? ""),
      nb: [],
    };
  });

  const seen = new Set<string>();
  const links: [number, number][] = [];
  for (const e of graph.edges) {
    const a = indexById.get(e.source);
    const b = indexById.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? a + "-" + b : b + "-" + a;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push([a, b]);
    nodes[a].nb.push(b);
    nodes[b].nb.push(a);
  }

  const folders: string[] = [];
  const fseen = new Set<string>();
  for (const n of nodes) {
    if (!fseen.has(n.folder)) {
      fseen.add(n.folder);
      folders.push(n.folder);
    }
  }

  const maxDeg = nodes.reduce((m, n) => Math.max(m, n.deg), 1);
  return { nodes, links, folders, maxDeg };
}
