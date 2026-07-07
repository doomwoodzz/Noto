import { describe, expect, it } from "vitest";
import { buildWebModel, snippetFor, topFolder } from "./webAdjacency";
import type { KnowledgeGraph, VaultFile } from "../../noto-core";

function file(id: string, path: string, content: string): VaultFile {
  const title = path.split("/").pop()!.replace(/\.md$/, "");
  return { id, path, title, content, pinned: false, createdAt: 0, updatedAt: 0 };
}

describe("topFolder", () => {
  it("returns the first path segment", () => {
    expect(topFolder("Biology/Cell.md")).toBe("Biology");
  });
  it("falls back to Notes for a bare filename", () => {
    expect(topFolder("Cell.md")).toBe("Cell.md");
    expect(topFolder("")).toBe("Notes");
  });
});

describe("snippetFor", () => {
  it("strips markdown and collapses whitespace", () => {
    expect(snippetFor("# Title\n\nHello   world")).toContain("Hello world");
  });
  it("truncates long text with an ellipsis", () => {
    const long = "word ".repeat(100);
    const s = snippetFor(long);
    expect(s.length).toBeLessThanOrEqual(220);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("buildWebModel", () => {
  const files = [
    file("a", "Biology/A.md", "Alpha body"),
    file("b", "Biology/B.md", "Beta body"),
    file("c", "Chemistry/C.md", "Gamma body"),
  ];
  const graph: KnowledgeGraph = {
    nodes: [
      { id: "a", title: "A", path: "Biology/A.md", backlinksCount: 1, outgoingCount: 1, degree: 2 },
      { id: "b", title: "B", path: "Biology/B.md", backlinksCount: 1, outgoingCount: 1, degree: 2 },
      { id: "c", title: "C", path: "Chemistry/C.md", backlinksCount: 0, outgoingCount: 0, degree: 0 },
    ],
    edges: [
      { id: "a->b", source: "a", target: "b", weight: 1 },
      { id: "b->a", source: "b", target: "a", weight: 1 }, // reciprocal — must dedupe
    ],
  };

  it("maps nodes with degree/ins/outs/folder/snippet", () => {
    const m = buildWebModel(graph, files);
    expect(m.nodes[0]).toMatchObject({ id: "a", title: "A", folder: "Biology", deg: 2, ins: 1, outs: 1 });
    expect(m.nodes[0].snippet).toContain("Alpha body");
  });

  it("dedupes reciprocal edges into one undirected link", () => {
    const m = buildWebModel(graph, files);
    expect(m.links).toEqual([[0, 1]]);
  });

  it("builds symmetric neighbor lists without duplicates", () => {
    const m = buildWebModel(graph, files);
    expect(m.nodes[0].nb).toEqual([1]);
    expect(m.nodes[1].nb).toEqual([0]);
    expect(m.nodes[2].nb).toEqual([]);
  });

  it("lists folders in first-seen order and reports maxDeg", () => {
    const m = buildWebModel(graph, files);
    expect(m.folders).toEqual(["Biology", "Chemistry"]);
    expect(m.maxDeg).toBe(2);
  });

  it("ignores self-edges and edges to unknown ids", () => {
    const g2: KnowledgeGraph = {
      nodes: graph.nodes,
      edges: [
        { id: "a->a", source: "a", target: "a", weight: 1 },
        { id: "a->z", source: "a", target: "z", weight: 1 },
      ],
    };
    const m = buildWebModel(g2, files);
    expect(m.links).toEqual([]);
  });
});
