import { describe, expect, it } from "vitest";
import { parseBlocks, serializeBlocks, createBlock, type Block } from "./blockModel";

/** parse → serialize must reproduce canonical Markdown byte-for-byte. */
function roundtrips(md: string) {
  expect(serializeBlocks(parseBlocks(md))).toBe(md);
}

describe("blockModel round-trip", () => {
  it("plain paragraphs and blank lines", () => {
    roundtrips("Hello world\n\nSecond paragraph");
  });

  it("headings h1–h3", () => {
    roundtrips("# Title\n## Section\n### Sub");
  });

  it("does not treat a tag line as a heading", () => {
    const blocks = parseBlocks("#welcome");
    expect(blocks[0].type).toBe("paragraph");
    roundtrips("#welcome");
  });

  it("bulleted and numbered lists with indentation", () => {
    roundtrips("- one\n- two\n    - nested");
    roundtrips("1. first\n2. second");
  });

  it("quotes, dividers, and code fences", () => {
    roundtrips("> a quote");
    roundtrips("---");
    roundtrips("```ts\nconst x = 1;\n```");
  });

  it("tasks checked and unchecked", () => {
    const blocks = parseBlocks("- [ ] todo\n- [x] done");
    expect(blocks[0]).toMatchObject({ type: "task", checked: false, text: "todo" });
    expect(blocks[1]).toMatchObject({ type: "task", checked: true, text: "done" });
    roundtrips("- [ ] todo\n- [x] done");
  });

  it("rich task carries an enrichment token", () => {
    const md = "- [ ] Ship the deck <!--noto:task id=tk_19f2-->";
    const blocks = parseBlocks(md);
    expect(blocks[0]).toMatchObject({ type: "task", text: "Ship the deck", taskId: "tk_19f2" });
    roundtrips(md);
  });

  it("callout keeps its icon and inline text", () => {
    const blocks = parseBlocks("<!--noto:callout icon=%E2%9A%A0%EF%B8%8F-->Heads up **now**");
    expect(blocks[0]).toMatchObject({ type: "callout", icon: "⚠️", text: "Heads up **now**" });
    roundtrips("<!--noto:callout icon=%E2%9A%A0%EF%B8%8F-->Heads up **now**");
  });

  it("toggle captures indented children", () => {
    const md = "<!--noto:toggle open=1-->Details\n    child one\n    child two";
    const blocks = parseBlocks(md);
    expect(blocks[0]).toMatchObject({ type: "toggle", text: "Details", body: "child one\nchild two", open: true });
    roundtrips(md);
  });

  it("widget directive round-trips id and config", () => {
    const md = "<!--noto:database id=db_7c1a view=table-->";
    const blocks = parseBlocks(md);
    expect(blocks[0]).toMatchObject({ type: "database", refId: "db_7c1a", config: { view: "table" } });
    roundtrips(md);
  });

  it("the seeded Welcome note round-trips", () => {
    const md = [
      "# Welcome to Noto",
      "",
      "When you listen, Noto remembers.",
      "",
      "## Quick start",
      "- Link notes with double brackets, like [[My First Lecture]].",
      "",
      "#welcome",
    ].join("\n");
    roundtrips(md);
  });

  it("never yields an empty document", () => {
    expect(parseBlocks("").length).toBe(1);
    expect(parseBlocks("")[0].type).toBe("paragraph");
  });

  it("createBlock produces valid defaults", () => {
    const types: Block["type"][] = [
      "paragraph", "heading", "bulleted", "numbered", "quote",
      "divider", "code", "callout", "toggle", "task", "database",
    ];
    for (const t of types) {
      const b = createBlock(t);
      expect(b.type).toBe(t);
      expect(b.id).toBeTruthy();
    }
  });
});
