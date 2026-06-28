import { describe, it, expect, vi } from "vitest";
import { makeHandlers } from "./handlers.ts";
import type { NotoBridgeClient } from "./bridge.ts";

function fakeClient(over: Partial<NotoBridgeClient> = {}): NotoBridgeClient {
  return {
    searchNotes: vi.fn(async () => ({ results: [] })),
    listNotes: vi.fn(async () => ({ notes: [] })),
    getNote: vi.fn(async () => ({ file: { id: "f", title: "T", path: "p", content: "c", updatedAt: 0 } })),
    getSection: vi.fn(async () => ({ fileId: "f", headingPath: ["A"], content: "c" })),
    remember: vi.fn(async () => ({ memoryId: "m", deduped: false })),
    recall: vi.fn(async () => ({ memories: [] })),
    createNote: vi.fn(async () => ({ fileId: "f", path: "Memory/a.md" })),
    appendNote: vi.fn(async () => ({ fileId: "f", updatedAt: 1 })),
    updateSection: vi.fn(async () => ({ fileId: "f", updatedAt: 1 })),
    ...over,
  };
}

describe("makeHandlers", () => {
  it("defaults scope to ctx.scope for read+remember tools and wraps results as MCP text", async () => {
    const client = fakeClient();
    const h = makeHandlers(client, { scope: "proj" });

    const r = await h.remember({ text: "x" });
    expect(client.remember).toHaveBeenCalledWith({ text: "x", type: undefined, scope: "proj", supersedes: undefined });
    expect(r.content[0].text).toBe(JSON.stringify({ memoryId: "m", deduped: false }));
    expect(r.isError).toBeUndefined();

    await h.recall({ query: "q" });
    expect(client.recall).toHaveBeenCalledWith({ query: "q", scope: "proj", type: undefined, limit: undefined });

    await h.search_notes({ query: "q" });
    expect(client.searchNotes).toHaveBeenCalledWith({ query: "q", scope: "proj", tag: undefined, limit: undefined });
  });

  it("honours an explicit scope arg over ctx.scope", async () => {
    const client = fakeClient();
    const h = makeHandlers(client, { scope: "proj" });
    await h.remember({ text: "x", scope: "global" });
    expect(client.remember).toHaveBeenCalledWith({ text: "x", type: undefined, scope: "global", supersedes: undefined });
  });

  it("surfaces a client error as an MCP isError result, not a throw", async () => {
    const client = fakeClient({ createNote: vi.fn(async () => { throw new Error("AI writes are confined to Memory/"); }) });
    const h = makeHandlers(client, { scope: "proj" });
    const r = await h.create_note({ path: "Notes/x.md", title: "X" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("confined to Memory/");
  });
});
