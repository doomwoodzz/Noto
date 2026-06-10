// Ported from Tests/NotoCoreTests/MarkdownParserTests.swift
import { describe, expect, it } from "vitest";
import {
  extractChecklistItems,
  extractHeadings,
  extractTags,
  extractWikiLinks,
  makeChecklistItem,
  wordCount,
} from "./parser";

describe("MarkdownParser", () => {
  it("extracts wiki links in order without brackets", () => {
    const content = "Study [[Photosynthesis]], [[Cell Structure]], and [[Cold War]].";
    expect(extractWikiLinks(content)).toEqual(["Photosynthesis", "Cell Structure", "Cold War"]);
  });

  it("extracts markdown headings without hash markers", () => {
    const content = "# Title\nParagraph\n## Key idea\n### Details";
    expect(extractHeadings(content)).toEqual(["Title", "Key idea", "Details"]);
  });

  it("ignores inline tags when extracting headings", () => {
    const content = "# Biology\nThis paragraph has #biology and #lecture tags.";
    expect(extractHeadings(content)).toEqual(["Biology"]);
  });

  it("extracts tags without treating headings as tags", () => {
    const content = "# Biology\nThis line has #biology and #lecture tags.";
    expect(extractTags(content)).toEqual(["biology", "lecture"]);
  });

  it("counts words from markdown text", () => {
    const content =
      "# Biology Lecture\nPhotosynthesis converts light energy into chemical energy stored in glucose.\n- [[Chloroplast]]";
    expect(wordCount(content)).toBe(13);
  });

  it("extracts checklist items", () => {
    const content = "- [ ] Review chlorophyll\n- [x] Compare Calvin cycle";
    expect(extractChecklistItems(content)).toEqual([
      makeChecklistItem("Review chlorophyll", false),
      makeChecklistItem("Compare Calvin cycle", true),
    ]);
  });
});
