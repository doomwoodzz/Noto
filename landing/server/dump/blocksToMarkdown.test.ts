import { describe, it, expect } from "vitest";
import { blocksToMarkdown } from "./blocksToMarkdown.ts";
import type { NotionBlock } from "../connectors/notion.ts";

function rt(text: string) {
  return [{ plain_text: text }];
}
function block(type: string, payload: Record<string, unknown>): NotionBlock {
  return { id: crypto.randomUUID(), type, [type]: payload };
}

describe("blocksToMarkdown", () => {
  it("maps headings 1/2/3", () => {
    const md = blocksToMarkdown([
      block("heading_1", { rich_text: rt("One") }),
      block("heading_2", { rich_text: rt("Two") }),
      block("heading_3", { rich_text: rt("Three") }),
    ]);
    expect(md).toContain("# One");
    expect(md).toContain("## Two");
    expect(md).toContain("### Three");
  });

  it("maps paragraphs and quotes", () => {
    const md = blocksToMarkdown([
      block("paragraph", { rich_text: rt("hello world") }),
      block("quote", { rich_text: rt("a quote") }),
    ]);
    expect(md).toContain("hello world");
    expect(md).toContain("> a quote");
  });

  it("maps bulleted + numbered list items", () => {
    const md = blocksToMarkdown([
      block("bulleted_list_item", { rich_text: rt("bullet") }),
      block("numbered_list_item", { rich_text: rt("first") }),
      block("numbered_list_item", { rich_text: rt("second") }),
    ]);
    expect(md).toContain("- bullet");
    expect(md).toContain("1. first");
    expect(md).toContain("2. second");
  });

  it("maps to_do checkboxes", () => {
    const md = blocksToMarkdown([
      block("to_do", { rich_text: rt("done"), checked: true }),
      block("to_do", { rich_text: rt("todo"), checked: false }),
    ]);
    expect(md).toContain("- [x] done");
    expect(md).toContain("- [ ] todo");
  });

  it("fences code with its language", () => {
    const md = blocksToMarkdown([
      block("code", { rich_text: rt("const x = 1;"), language: "typescript" }),
    ]);
    expect(md).toContain("```typescript");
    expect(md).toContain("const x = 1;");
    expect(md).toContain("\n```");
  });

  it("widens the fence so code containing ``` can't break out into live markdown", () => {
    const md = blocksToMarkdown([
      block("code", { rich_text: rt("```\n# Injected Heading"), language: "" }),
    ]);
    const lines = md.split("\n");
    // The opening + closing fences are widened to 4 backticks so the inner ```
    // cannot terminate the block early; everything between them is code, and the
    // "# Injected Heading" never escapes into a real markdown H1.
    expect(lines[0]).toBe("````");
    expect(lines[lines.length - 1]).toBe("````");
    expect(md).toContain("# Injected Heading"); // preserved verbatim, inside the fence
    const wideFences = lines.filter((l) => /^`{4,}$/.test(l));
    expect(wideFences.length).toBe(2); // exactly one opening + one closing wide fence
  });

  it("maps callouts to blockquotes and divider to ---", () => {
    const md = blocksToMarkdown([
      block("callout", { rich_text: rt("note this") }),
      block("divider", {}),
    ]);
    expect(md).toContain("> note this");
    expect(md).toContain("---");
  });

  it("emits a child_page placeholder line", () => {
    const md = blocksToMarkdown([
      { id: "cp1", type: "child_page", child_page: { title: "Sub Page" } } as NotionBlock,
    ]);
    expect(md).toContain("Sub Page");
    expect(md.toLowerCase()).toContain("child page");
  });

  it("renders a table from inlined table_row children", () => {
    const table = block("table", { table_width: 2, has_column_header: true }) as NotionBlock;
    table.has_children = true;
    const row1 = block("table_row", { cells: [rt("A"), rt("B")] });
    const row2 = block("table_row", { cells: [rt("1"), rt("2")] });
    const md = blocksToMarkdown([table, row1, row2]);
    expect(md).toContain("| A | B |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| 1 | 2 |");
  });

  it("labels unsupported blocks instead of dropping them", () => {
    const md = blocksToMarkdown([block("unsupported_widget", { foo: 1 })]);
    expect(md).toContain("> [unsupported: unsupported_widget]");
  });

  it("flattens multi-run rich text", () => {
    const md = blocksToMarkdown([
      block("paragraph", { rich_text: [{ plain_text: "foo " }, { plain_text: "bar" }] }),
    ]);
    expect(md).toContain("foo bar");
  });
});
