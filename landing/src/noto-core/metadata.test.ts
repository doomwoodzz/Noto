// Ported from Tests/NotoCoreTests/MetadataCacheBuilderTests.swift
import { describe, expect, it } from "vitest";
import { buildMetadataCache } from "./metadata";
import { SCHOOL_VAULT_FILES } from "./mockVault";

function metaByTitle(title: string) {
  const cache = buildMetadataCache(SCHOOL_VAULT_FILES);
  const file = SCHOOL_VAULT_FILES.find((f) => f.title === title)!;
  return { cache, meta: cache.filesById[file.id]! };
}

describe("MetadataCacheBuilder", () => {
  it("builds outgoing links, headings, tags and word count", () => {
    const { meta } = metaByTitle("Photosynthesis");
    expect(meta.headings).toEqual([
      "Biology Lecture - Photosynthesis",
      "Key idea",
      "Important terms",
      "Summary",
      "Questions to review",
    ]);
    expect(meta.outgoingLinks).toEqual(["Chloroplast", "Glucose", "Carbon Dioxide", "Cell Structure"]);
    expect(meta.tags).toEqual([]);
    expect(meta.path).toBe("Biology/Photosynthesis.md");
    expect(meta.wordCount).toBeGreaterThan(20);
  });

  it("extracts tags from non-heading lines", () => {
    const { meta } = metaByTitle("Chloroplast");
    expect(meta.headings).toEqual(["Chloroplast"]);
    expect(meta.tags).toEqual(["biology"]);
  });

  it("generates backlinks by resolving wiki links to known titles", () => {
    const { meta } = metaByTitle("Photosynthesis");
    expect(new Set(meta.backlinks)).toEqual(
      new Set([
        "Biology Lecture - May 13",
        "Cell Structure",
        "Chloroplast",
        "Enzymes",
        "Glucose",
        "Carbon Dioxide",
      ]),
    );
  });

  it("ignores unresolved links when building backlinks", () => {
    const files = SCHOOL_VAULT_FILES.map((f, i) =>
      i === 0 ? { ...f, content: f.content + "\n- [[Unresolved Topic]]" } : f,
    );
    const cache = buildMetadataCache(files);
    expect(cache.fileIdByTitle["Unresolved Topic"]).toBeUndefined();
    expect(
      Object.values(cache.filesById).some((m) => m.backlinks.includes("Unresolved Topic")),
    ).toBe(false);
  });
});
