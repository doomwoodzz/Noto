import { describe, it, expect } from "vitest";
import { makeNotionProvider } from "./notion.ts";
import type { NotionBlock, NotionClient } from "../../connectors/notion.ts";
import type { FetchCtx } from "../types.ts";

// A scripted fake Notion client: pages + their block children (arrays of cursor
// pages per blockId; the cursor is the stringified next index).
function fakeClient(script: {
  pages: Record<string, { last_edited_time: string; url?: string }>;
  children: Record<string, NotionBlock[][]>;
}): NotionClient {
  return {
    async retrievePage(pageId) {
      const p = script.pages[pageId];
      if (!p) throw new Error("Notion API error 404");
      return { id: pageId, object: "page", last_edited_time: p.last_edited_time, url: p.url };
    },
    async blockChildren(blockId, cursor) {
      const pages = script.children[blockId] ?? [[]];
      const idx = cursor ? Number(cursor) : 0;
      const results = pages[idx] ?? [];
      const next = idx + 1 < pages.length ? String(idx + 1) : null;
      return { results, has_more: next !== null, next_cursor: next };
    },
    async search() {
      return { results: [], has_more: false, next_cursor: null };
    },
  };
}

const ctx = (pageIds: string[], cap = 100): FetchCtx => ({
  userId: "u1",
  sourceRef: { pageIds },
  cap,
  onProgress: () => {},
});

describe("notion provider", () => {
  it("turns one page into one RawItem with a stable source key + origin", async () => {
    const client = fakeClient({
      pages: { p1: { last_edited_time: "2026-01-01T00:00:00.000Z", url: "https://notion.so/p1" } },
      children: {
        p1: [[
          { id: "h", type: "heading_1", heading_1: { rich_text: [{ plain_text: "Title" }] } },
          { id: "para", type: "paragraph", paragraph: { rich_text: [{ plain_text: "hello" }] } },
        ]],
      },
    });
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    const items = await provider.fetch(ctx(["p1"]));
    expect(items).toHaveLength(1);
    expect(items[0].sourceKey).toBe("notion:p1@2026-01-01T00:00:00.000Z");
    expect(items[0].origin).toMatchObject({ type: "notion", url: "https://notion.so/p1", ref: "2026-01-01T00:00:00.000Z" });
    expect(items[0].body).toContain("# Title");
    expect(items[0].body).toContain("hello");
  });

  it("paginates block children via the cursor", async () => {
    const client = fakeClient({
      pages: { p1: { last_edited_time: "t" } },
      children: {
        p1: [
          [{ id: "a", type: "paragraph", paragraph: { rich_text: [{ plain_text: "page1" }] } }],
          [{ id: "b", type: "paragraph", paragraph: { rich_text: [{ plain_text: "page2" }] } }],
        ],
      },
    });
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    const items = await provider.fetch(ctx(["p1"]));
    expect(items[0].body).toContain("page1");
    expect(items[0].body).toContain("page2");
  });

  it("emits child pages as separate RawItems under a mirrored path", async () => {
    const client = fakeClient({
      pages: {
        parent: { last_edited_time: "t1" },
        kid: { last_edited_time: "t2" },
      },
      children: {
        parent: [[
          { id: "kid", type: "child_page", has_children: true, child_page: { title: "Kid Page" } },
        ]],
        kid: [[{ id: "kp", type: "paragraph", paragraph: { rich_text: [{ plain_text: "child body" }] } }]],
      },
    });
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    const items = await provider.fetch(ctx(["parent"]));
    expect(items.map((i) => i.sourceKey)).toContain("notion:kid@t2");
    const kid = items.find((i) => i.sourceKey === "notion:kid@t2")!;
    expect(kid.body).toContain("child body");
    expect(kid.origin.path).toContain("Kid Page");
  });

  it("inlines table rows so the body renders a markdown table", async () => {
    const client = fakeClient({
      pages: { p1: { last_edited_time: "t" } },
      children: {
        p1: [[{ id: "tbl", type: "table", has_children: true, table: { table_width: 2 } }]],
        tbl: [[
          { id: "r1", type: "table_row", table_row: { cells: [[{ plain_text: "A" }], [{ plain_text: "B" }]] } },
          { id: "r2", type: "table_row", table_row: { cells: [[{ plain_text: "1" }], [{ plain_text: "2" }]] } },
        ]],
      },
    });
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    const items = await provider.fetch(ctx(["p1"]));
    expect(items[0].body).toContain("| A | B |");
    expect(items[0].body).toContain("| 1 | 2 |");
  });

  it("stops at the cap and reports a partial failure without aborting the batch", async () => {
    const client = fakeClient({
      pages: { ok: { last_edited_time: "t" } }, // "bad" is missing → retrievePage throws
      children: { ok: [[{ id: "p", type: "paragraph", paragraph: { rich_text: [{ plain_text: "fine" }] } }]] },
    });
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    const items = await provider.fetch(ctx(["ok", "bad"], 100));
    // "ok" yields an item; "bad" is skipped (best-effort per item).
    expect(items.map((i) => i.sourceKey)).toContain("notion:ok@t");
    expect(items.some((i) => i.sourceKey.startsWith("notion:bad"))).toBe(false);

    const capped = await makeNotionProvider({ getClient: () => client, delayMs: 0 }).fetch(ctx(["ok", "ok"], 1));
    expect(capped).toHaveLength(1);
  });
});
