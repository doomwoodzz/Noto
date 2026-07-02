import { describe, it, expect } from "vitest";
import { makeNotionProvider } from "./notion.ts";
import type { NotionClient, NotionBlock } from "../../connectors/notion.ts";

// A scripted fake Notion client: pages + their block children.
function fakeClient(script: {
  pages: Record<string, { last_edited_time: string; url?: string }>;
  children: Record<string, { results: NotionBlock[]; next?: string }[]>; // pages of children per blockId
}): NotionClient {
  const cursors: Record<string, number> = {};
  return {
    async retrievePage(pageId) {
      const p = script.pages[pageId];
      if (!p) throw new Error("Notion API error 404");
      return { id: pageId, object: "page", last_edited_time: p.last_edited_time, url: p.url };
    },
    async blockChildren(blockId, cursor) {
      const pages = script.children[blockId] ?? [{ results: [] }];
      const idx = cursor ? (cursors[`${blockId}:${cursor}`] ?? 0) : 0;
      const page = pages[idx] ?? { results: [] };
      const next = page.next;
      if (next) cursors[`${blockId}:${next}`] = idx + 1;
      return { results: page.results, has_more: Boolean(next), next_cursor: next ?? null };
    },
    async search() {
      return { results: [], has_more: false, next_cursor: null };
    },
  };
}

const ctx = (pageIds: string[], cap = 100) => ({
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
        p1: [{
          results: [
            { id: "h", type: "heading_1", heading_1: { rich_text: [{ plain_text: "Title" }] } },
            { id: "para", type: "paragraph", paragraph: { rich_text: [{ plain_text: "hello" }] } },
          ],
        }],
      },
    });
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    const items = await provider.fetch(ctx(["p1"]));
    expect(items).toHaveLength(1);
    expect(items[0].sourceKey).toBe("notion:p1");
    expect(items[0].origin).toMatchObject({ type: "notion", url: "https://notion.so/p1", ref: "2026-01-01T00:00:00.000Z" });
    expect(items[0].body).toContain("# Title");
    expect(items[0].body).toContain("hello");
  });

  it("paginates block children via the cursor", async () => {
    const client = fakeClient({
      pages: { p1: { last_edited_time: "t" } },
      children: {
        p1: [
          { results: [{ id: "a", type: "paragraph", paragraph: { rich_text: [{ plain_text: "page1" }] } }], next: "cur2" },
          { results: [{ id: "b", type: "paragraph", paragraph: { rich_text: [{ plain_text: "page2" }] } }] },
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
        parent: [{
          results: [
            { id: "kid", type: "child_page", has_children: true, child_page: { title: "Kid Page" } },
          ],
        }],
        kid: [{ results: [{ id: "kp", type: "paragraph", paragraph: { rich_text: [{ plain_text: "child body" }] } }] }],
      },
    });
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    const items = await provider.fetch(ctx(["parent"]));
    expect(items.map((i) => i.sourceKey)).toContain("notion:kid");
    const kid = items.find((i) => i.sourceKey === "notion:kid")!;
    expect(kid.body).toContain("child body");
    expect(kid.origin.path).toContain("Kid Page");
  });

  it("inlines table rows so the body renders a markdown table", async () => {
    const client = fakeClient({
      pages: { p1: { last_edited_time: "t" } },
      children: {
        p1: [{
          results: [{ id: "tbl", type: "table", has_children: true, table: { table_width: 2 } }],
        }],
        tbl: [{
          results: [
            { id: "r1", type: "table_row", table_row: { cells: [[{ plain_text: "A" }], [{ plain_text: "B" }]] } },
            { id: "r2", type: "table_row", table_row: { cells: [[{ plain_text: "1" }], [{ plain_text: "2" }]] } },
          ],
        }],
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
      children: { ok: [{ results: [{ id: "p", type: "paragraph", paragraph: { rich_text: [{ plain_text: "fine" }] } }] }] },
    });
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    const items = await provider.fetch(ctx(["ok", "bad"], 100));
    // "ok" yields an item; "bad" is skipped (best-effort per item).
    expect(items.map((i) => i.sourceKey)).toContain("notion:ok");
    expect(items.some((i) => i.sourceKey.startsWith("notion:bad"))).toBe(false);

    const capped = await makeNotionProvider({ getClient: () => client, delayMs: 0 }).fetch(ctx(["ok", "ok"], 1));
    expect(capped).toHaveLength(1);
  });

  it("throws when every selected page fails (systemic failure, not empty success)", async () => {
    const client = fakeClient({ pages: {}, children: {} }); // every retrievePage → 404 throw
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    await expect(provider.fetch(ctx(["a", "b"]))).rejects.toThrow(/all .* selected page/i);
  });

  it("a failing child page does not abort its parent or siblings", async () => {
    // parent has two child_page blocks: 'good' resolves, 'bad' is missing → its
    // retrievePage throws, but the parent + the good child still yield items.
    const client = fakeClient({
      pages: { parent: { last_edited_time: "t0" }, good: { last_edited_time: "t1" } }, // 'bad' absent
      children: {
        parent: [{ results: [
          { id: "good", type: "child_page", has_children: true, child_page: { title: "Good" } },
          { id: "bad", type: "child_page", has_children: true, child_page: { title: "Bad" } },
        ] }],
        good: [{ results: [{ id: "g", type: "paragraph", paragraph: { rich_text: [{ plain_text: "good body" }] } }] }],
      },
    });
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    const items = await provider.fetch(ctx(["parent"]));
    const keys = items.map((i) => i.sourceKey);
    expect(keys).toContain("notion:parent");
    expect(keys).toContain("notion:good");
    expect(keys.some((k) => k.startsWith("notion:bad"))).toBe(false); // failed child skipped, no crash
  });

  it("terminates on a cyclic child_page reference (seen guard)", async () => {
    // parent → child 'c' → points back to 'parent'. Must terminate, not infinite-loop.
    const client = fakeClient({
      pages: { parent: { last_edited_time: "t0" }, c: { last_edited_time: "t1" } },
      children: {
        parent: [{ results: [{ id: "c", type: "child_page", has_children: true, child_page: { title: "C" } }] }],
        c: [{ results: [{ id: "parent", type: "child_page", has_children: true, child_page: { title: "Parent Again" } }] }],
      },
    });
    const provider = makeNotionProvider({ getClient: () => client, delayMs: 0 });
    const items = await provider.fetch(ctx(["parent"]));
    // parent + c each once; the back-reference to parent is skipped by `seen`.
    expect(items.map((i) => i.sourceKey).sort()).toEqual(["notion:c", "notion:parent"]);
  });
});
