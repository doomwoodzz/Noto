import { describe, expect, it } from "vitest";
import { markdownToHtml, wikiTitlesIn } from "./liveMarkdown";

// Reconstruct the text content of the rendered HTML the way the editor's
// `serialize()` does (block divs joined by newlines, all tag/entity stripped).
// The core invariant: this must equal the original Markdown, because markers
// are hidden in the DOM, not removed.
function textOf(html: string): string {
  return html
    .replace(/<\/div>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n$/, "");
}

describe("markdownToHtml round-trip", () => {
  const cases = [
    "Plain paragraph text",
    "A line with a [[Wiki Link]] in it",
    "Some **bold** and *italic* and <u>underline</u>",
    "# Heading one",
    "## Heading two with [[Link]]",
    "- a bullet item",
    "- [ ] unchecked task",
    "- [x] done task",
    "> a quote line",
    "---",
    "first\n\nsecond\nthird",
    "**bold with [[Link]] inside**",
    "punctuation & <angles> stay intact",
  ];
  for (const md of cases) {
    it(`round-trips: ${JSON.stringify(md)}`, () => {
      expect(textOf(markdownToHtml(md))).toBe(md);
    });
  }
});

describe("markdownToHtml structure", () => {
  it("renders a wiki link as an atomic pill showing only the title", () => {
    const html = markdownToHtml("[[Algebra]]");
    expect(html).toContain('class="rme-pill"');
    expect(html).toContain('contenteditable="false"');
    expect(html).toContain('data-title="Algebra"');
    expect(html).toContain('<span class="rme-pill-label">Algebra</span>');
  });

  it("wraps bold text in <strong> with hidden markers", () => {
    const html = markdownToHtml("**hi**");
    expect(html).toContain("<strong>");
    expect(html.match(/rme-mk/g)?.length).toBe(2);
    expect(textOf(html)).toBe("**hi**");
  });

  it("does not create a pill for empty brackets", () => {
    const html = markdownToHtml("[[]]");
    expect(html).not.toContain("rme-pill");
    expect(textOf(html)).toBe("[[]]");
  });

  it("styles a heading line by level", () => {
    expect(markdownToHtml("## Two")).toContain('class="rme-block rme-h2"');
  });
});

describe("markdownToHtml citations", () => {
  it("renders a citation chip for an http(s) link and round-trips the source", () => {
    const md = "See [SKYMAGIC Drone Shows](<https://skymagic.show>) here";
    const html = markdownToHtml(md);
    expect(html).toContain('class="rme-cite"');
    expect(html).toContain('data-url="https://skymagic.show"');
    expect(html).toContain('<span class="rme-cite-label">SKYMAGIC Drone Shows</span>');
    expect(textOf(html)).toBe(md);
  });

  it("round-trips a plain-parens link form too", () => {
    const md = "[Example](https://example.com)";
    const html = markdownToHtml(md);
    expect(html).toContain('class="rme-cite"');
    expect(html).toContain('data-url="https://example.com"');
    expect(textOf(html)).toBe(md);
  });

  it("leaves a non-URL bracket link as literal text", () => {
    const md = "[a](b)";
    const html = markdownToHtml(md);
    expect(html).not.toContain("rme-cite");
    expect(textOf(html)).toBe(md);
  });

  it("prefers a wiki link over a citation", () => {
    const html = markdownToHtml("[[Algebra]]");
    expect(html).toContain("rme-pill");
    expect(html).not.toContain("rme-cite");
  });
});

describe("wikiTitlesIn", () => {
  it("extracts trimmed titles", () => {
    expect(wikiTitlesIn("see [[ Algebra ]] and [[Calculus]]")).toEqual(["Algebra", "Calculus"]);
  });
  it("ignores empty links", () => {
    expect(wikiTitlesIn("[[]] nothing")).toEqual([]);
  });
});
