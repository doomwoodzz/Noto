import { describe, expect, it } from "vitest";
import { buildMetadataCache, type VaultFile } from "../../noto-core";
import { lexicalSearch, tokenize } from "./lexical";

function file(id: string, title: string, body: string): VaultFile {
  return {
    id,
    path: `Notes/${title}.md`,
    title,
    content: `# ${title}\n\n${body}`,
    pinned: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

const FILES: VaultFile[] = [
  file(
    "a",
    "Photosynthesis",
    "Plants convert sunlight into glucose.\n\n## Calvin Cycle\n\nCarbon fixation happens in the stroma.",
  ),
  file("b", "Cold War", "Tensions between the superpowers escalated after 1945."),
];
const CACHE = buildMetadataCache(FILES);

describe("tokenize", () => {
  it("lowercases, drops stopwords and short tokens", () => {
    expect(tokenize("How do the plants make Energy?")).toEqual(["plants", "make", "energy"]);
  });
});

describe("lexicalSearch", () => {
  it("matches a note via its title even when the body lacks the word", () => {
    const r = lexicalSearch("photosynthesis", FILES, CACHE);
    expect(r[0]?.fileId).toBe("a");
    expect(r).toHaveLength(1);
  });

  it("ranks a body passage and highlights the matching sentence", () => {
    const r = lexicalSearch("carbon fixation", FILES, CACHE);
    expect(r[0]?.fileId).toBe("a");
    expect(r[0]?.highlightSentence).toContain("Carbon fixation");
    expect(r[0]?.source).toBe("lexical");
  });

  it("returns nothing when no term matches", () => {
    expect(lexicalSearch("quantum entanglement", FILES, CACHE)).toEqual([]);
  });

  it("returns nothing for an all-stopword query", () => {
    expect(lexicalSearch("how do the", FILES, CACHE)).toEqual([]);
  });

  it("normalizes the top score to 1", () => {
    const r = lexicalSearch("cold war superpowers", FILES, CACHE);
    expect(r[0]?.score).toBeCloseTo(1, 6);
  });
});
