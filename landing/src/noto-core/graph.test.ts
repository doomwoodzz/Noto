// Ported from Tests/NotoCoreTests/GraphBuilderTests.swift
import { describe, expect, it } from "vitest";
import { buildGraph, filterGraph } from "./graph";
import { buildMetadataCache } from "./metadata";
import { SCHOOL_VAULT_FILES } from "./mockVault";

function build() {
  const cache = buildMetadataCache(SCHOOL_VAULT_FILES);
  return buildGraph(SCHOOL_VAULT_FILES, cache);
}

describe("GraphBuilder", () => {
  it("builds nodes and edges from the metadata cache", () => {
    const graph = build();
    expect(graph.nodes.length).toBe(SCHOOL_VAULT_FILES.length);
    expect(
      graph.edges.some((e) => e.source === "biology-photosynthesis" && e.target === "biology-chloroplast"),
    ).toBe(true);
    expect(
      graph.edges.some((e) => e.source === "ai-biology-lecture-may-13" && e.target === "biology-photosynthesis"),
    ).toBe(true);
  });

  it("exposes backlink and outgoing counts from metadata", () => {
    const graph = build();
    const photosynthesis = graph.nodes.find((n) => n.id === "biology-photosynthesis")!;
    expect(photosynthesis.backlinksCount).toBe(6);
    expect(photosynthesis.outgoingCount).toBe(4);
    expect(photosynthesis.degree).toBe(10);
  });

  it("local filter shows the active note's outgoing links and backlinks", () => {
    const graph = build();
    const filtered = filterGraph(graph, "local", "biology-photosynthesis");
    const titles = new Set(filtered.nodes.map((n) => n.title));
    for (const t of [
      "Photosynthesis",
      "Chloroplast",
      "Glucose",
      "Carbon Dioxide",
      "Cell Structure",
      "Enzymes",
      "Biology Lecture - May 13",
    ]) {
      expect(titles.has(t)).toBe(true);
    }
    expect(titles.has("Cold War")).toBe(false);
  });

  it("lectureOnly filter shows only the lecture-folder notes", () => {
    const graph = build();
    const filtered = filterGraph(graph, "lectureOnly", "biology-photosynthesis");
    expect(filtered.nodes.map((n) => n.title)).toEqual(["Biology Lecture - May 13"]);
    expect(filtered.edges).toEqual([]);
  });

  it("orphan filter shows notes without edges", () => {
    const graph = build();
    const filtered = filterGraph(graph, "orphans", "biology-photosynthesis");
    const titles = new Set(filtered.nodes.map((n) => n.title));
    for (const t of ["Cold War", "Industrial Revolution", "Logarithms", "Macbeth"]) {
      expect(titles.has(t)).toBe(true);
    }
    expect(filtered.edges).toEqual([]);
  });
});
