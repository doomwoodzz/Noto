// landing/src/noto-core/graphEdges.test.ts
import { describe, expect, it } from "vitest";
import { buildMetadataCache } from "./metadata";
import type { VaultFile } from "./types";
import {
  isWellLinked,
  buildStructuralEdges,
  budgetedQuery,
  LINK_DENSITY_THRESHOLD,
} from "./graphEdges";

function file(id: string, content: string): VaultFile {
  return { id, path: `${id}.md`, title: id, content, pinned: false, createdAt: 0, updatedAt: 0 };
}

describe("isWellLinked", () => {
  it("is false with zero links/tags", () => {
    const cache = buildMetadataCache([file("a", "no links here")]);
    expect(isWellLinked(cache.filesById.a)).toBe(false);
  });

  it("is false one below the threshold", () => {
    const cache = buildMetadataCache([file("a", "[[b]] #x"), file("b", "")]);
    expect(cache.filesById.a.outgoingLinks.length + cache.filesById.a.tags.length).toBe(2);
    expect(isWellLinked(cache.filesById.a)).toBe(false);
  });

  it("is true exactly at the threshold", () => {
    const cache = buildMetadataCache([file("a", "[[b]] [[c]] #x"), file("b", ""), file("c", "")]);
    expect(cache.filesById.a.outgoingLinks.length + cache.filesById.a.tags.length).toBe(LINK_DENSITY_THRESHOLD);
    expect(isWellLinked(cache.filesById.a)).toBe(true);
  });

  it("is true well above the threshold", () => {
    const cache = buildMetadataCache([file("a", "[[b]] [[c]] [[d]] #x #y"), file("b", ""), file("c", ""), file("d", "")]);
    expect(isWellLinked(cache.filesById.a)).toBe(true);
  });
});

describe("buildStructuralEdges", () => {
  it("emits an EXTRACTED links_to edge for a resolved wikilink", () => {
    const files = [file("a", "See [[b]]."), file("b", "B note")];
    const cache = buildMetadataCache(files);
    const edges = buildStructuralEdges(files[0], cache);
    expect(edges).toContainEqual({
      id: "a->b:links_to",
      sourceId: "a",
      targetId: "b",
      relation: "links_to",
      confidence: "EXTRACTED",
      confidenceScore: 1,
    });
  });

  it("skips an unresolved wikilink (no matching title)", () => {
    const files = [file("a", "See [[Nowhere]].")];
    const cache = buildMetadataCache(files);
    const edges = buildStructuralEdges(files[0], cache);
    expect(edges.some((e) => e.relation === "links_to")).toBe(false);
  });

  it("emits a tagged_with edge pointing at a synthetic tag node", () => {
    const files = [file("a", "Some #biology content.")];
    const cache = buildMetadataCache(files);
    const edges = buildStructuralEdges(files[0], cache);
    expect(edges).toContainEqual({
      id: "a->tag:biology:tagged_with",
      sourceId: "a",
      targetId: "tag:biology",
      relation: "tagged_with",
      confidence: "EXTRACTED",
      confidenceScore: 1,
    });
  });

  it("returns an empty list for a file missing from the cache", () => {
    const files = [file("a", "hi")];
    const cache = buildMetadataCache(files);
    expect(buildStructuralEdges(file("ghost", "x"), cache)).toEqual([]);
  });
});

describe("budgetedQuery", () => {
  const edges = [
    { id: "a->b:links_to", sourceId: "a", targetId: "b", relation: "links_to" as const, confidence: "EXTRACTED" as const, confidenceScore: 1 },
    { id: "a->c:sim", sourceId: "a", targetId: "c", relation: "semantically_similar_to" as const, confidence: "INFERRED" as const, confidenceScore: 0.9 },
    { id: "b->d:links_to", sourceId: "b", targetId: "d", relation: "links_to" as const, confidence: "EXTRACTED" as const, confidenceScore: 1 },
  ];

  it("prefers EXTRACTED edges over higher-scored INFERRED ones under a tight budget", () => {
    const result = budgetedQuery(edges, "a", 2); // room for `a` + one more
    expect(result.nodeIds).toEqual(["a", "b"]);
    expect(result.edges).toEqual([edges[0]]);
  });

  it("keeps expanding breadth-first until the budget is exhausted", () => {
    const result = budgetedQuery(edges, "a", 4);
    expect(new Set(result.nodeIds)).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("returns just the start node when it has no edges", () => {
    const result = budgetedQuery(edges, "isolated", 10);
    expect(result).toEqual({ nodeIds: ["isolated"], edges: [] });
  });
});
