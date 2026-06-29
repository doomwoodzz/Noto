import { describe, expect, it } from "vitest";
import { bestSnippet } from "./snippet.ts";

const NOTE = "# Cells\n\nIntro about biology.\n\n## Mitochondria\n\nThe mitochondria makes ATP for the cell.\n\n## Nucleus\n\nThe nucleus holds DNA.";

describe("bestSnippet", () => {
  it("returns the heading path and a snippet for the best-matching section", () => {
    const r = bestSnippet(NOTE, "ATP");
    expect(r.headingPath).toEqual(["Cells", "Mitochondria"]);
    expect(r.snippet).toContain("ATP");
    expect(r.snippet.length).toBeLessThanOrEqual(160);
  });

  it("falls back to the intro / empty heading path when no section matches", () => {
    const r = bestSnippet(NOTE, "biology");
    expect(r.snippet).toContain("biology");
  });

  it("never returns more than 160 chars", () => {
    const long = "# T\n\n## H\n\n" + "word ".repeat(200);
    expect(bestSnippet(long, "word").snippet.length).toBeLessThanOrEqual(160);
  });

  it("returns empty headingPath for a note with no headings", () => {
    const r = bestSnippet("Just some text about biology and nothing else.", "biology");
    expect(r.headingPath).toEqual([]);
    expect(r.snippet).toContain("biology");
  });

  it("does not let a multi-term query bleed across sections into the intro", () => {
    // No H1 wrapper: intro is just "Intro line."; section A has ATP, B has DNA.
    const doc = "Intro line.\n\n## A\n\nATP here.\n\n## B\n\nDNA here.";
    const r = bestSnippet(doc, "ATP DNA");
    expect(r.headingPath).toEqual(["A"]); // a real section, NOT [] (the intro-bleed bug)
  });

  it("returns a <=160-char snippet and does not throw when nothing matches", () => {
    const r = bestSnippet(NOTE, "quantum physics");
    expect(r.snippet.length).toBeLessThanOrEqual(160);
  });
});
