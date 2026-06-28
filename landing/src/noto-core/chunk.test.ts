import { describe, expect, it } from "vitest";
import { chunkNote, plainText, splitSentences } from "./chunk";

describe("chunkNote", () => {
  it("strips the leading H1 title and chunks the body", () => {
    const passages = chunkNote({
      id: "f1",
      content: "# Photosynthesis\n\nPlants convert light into chemical energy.",
    });
    expect(passages).toHaveLength(1);
    expect(passages[0].text).toBe("Plants convert light into chemical energy.");
    expect(passages[0].headingPath).toEqual([]);
    expect(passages[0].id).toBe("f1#0");
  });

  it("tracks the enclosing heading trail", () => {
    const passages = chunkNote({
      id: "f2",
      content: "# Bio\n\nIntro line.\n\n## Calvin Cycle\n\nThe cycle fixes carbon.",
    });
    expect(passages).toHaveLength(2);
    expect(passages[0]).toMatchObject({ index: 0, headingPath: [], text: "Intro line." });
    expect(passages[1]).toMatchObject({
      index: 1,
      headingPath: ["Calvin Cycle"],
      text: "The cycle fixes carbon.",
    });
  });

  it("nests heading paths and pops siblings", () => {
    const content = "# T\n\n## A\n\nunder a\n\n### A1\n\ndeep\n\n## B\n\nunder b";
    const passages = chunkNote({ id: "f3", content });
    expect(passages.map((p) => p.headingPath)).toEqual([["A"], ["A", "A1"], ["B"]]);
  });

  it("merges short adjacent paragraphs into one passage", () => {
    const passages = chunkNote({ id: "f4", content: "# T\n\nAlpha one.\n\nBeta two." });
    expect(passages).toHaveLength(1);
    expect(passages[0].text).toContain("Alpha one.");
    expect(passages[0].text).toContain("Beta two.");
  });

  it("splits an over-long block by sentence and keeps indices contiguous", () => {
    const longPara = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about cells.`).join(" ");
    const passages = chunkNote({ id: "f5", content: `# T\n\n${longPara}` });
    expect(passages.length).toBeGreaterThan(1);
    for (const p of passages) expect(p.text.length).toBeLessThanOrEqual(900);
    expect(passages.map((p) => p.index)).toEqual(passages.map((_, i) => i));
    expect(passages.map((p) => p.id)).toEqual(passages.map((_, i) => `f5#${i}`));
  });

  it("returns nothing for an empty or title-only note", () => {
    expect(chunkNote({ id: "f6", content: "# Empty\n\n   \n" })).toEqual([]);
    expect(chunkNote({ id: "f7", content: "" })).toEqual([]);
  });
});

describe("splitSentences", () => {
  it("splits on terminators and newlines", () => {
    expect(splitSentences("Hello world. This is great! Really?")).toEqual([
      "Hello world.",
      "This is great!",
      "Really?",
    ]);
    expect(splitSentences("- item one\n- item two")).toEqual(["- item one", "- item two"]);
  });
});

describe("plainText", () => {
  it("strips common markdown markup", () => {
    expect(plainText("## Heading\n- **bold** item with [[Link]] and [text](http://x)")).toBe(
      "Heading bold item with Link and text",
    );
  });
});
