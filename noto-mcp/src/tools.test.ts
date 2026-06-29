import { describe, expect, it, vi } from "vitest";
import { makeHandlers } from "./tools.ts";
import type { NotoClient } from "./notoClient.ts";

function fakeClient() {
  return {
    searchNotes: vi.fn(async () => ({ results: [{ fileId: "1", title: "T", headingPath: [], snippet: "s", score: -1 }] })),
    listNotes: vi.fn(async () => ({ notes: [] })),
    getNote: vi.fn(async () => ({ file: { id: "1", title: "T", path: "p", content: "c", updatedAt: 0 } })),
    getSection: vi.fn(async () => ({ fileId: "1", headingPath: ["A"], content: "c" })),
    remember: vi.fn(async () => ({ memoryId: "m1", deduped: false })),
    recall: vi.fn(async () => ({ memories: [] })),
    createNote: vi.fn(async () => ({ fileId: "f1", path: "Memory/x.md" })),
    appendNote: vi.fn(async () => ({ fileId: "f1", updatedAt: 9 })),
    updateSection: vi.fn(async () => ({ fileId: "f1", updatedAt: 9 })),
  };
}

describe("tool handlers", () => {
  it("search_notes injects the auto-detected scope and returns text content", async () => {
    const client = fakeClient();
    const h = makeHandlers(client as unknown as NotoClient, { scope: "proj/x" });
    const out = await h.search_notes({ query: "auth" });
    expect(client.searchNotes).toHaveBeenCalledWith({ query: "auth", scope: "proj/x", tag: undefined, limit: undefined });
    expect(out.content[0].type).toBe("text");
    expect(JSON.parse(out.content[0].text).results[0].title).toBe("T");
  });

  it("remember passes an explicit scope override through unchanged", async () => {
    const client = fakeClient();
    const h = makeHandlers(client as unknown as NotoClient, { scope: "proj/x" });
    await h.remember({ text: "hi", scope: "global" });
    expect(client.remember).toHaveBeenCalledWith({ text: "hi", type: undefined, scope: "global", supersedes: undefined });
  });

  it("surfaces a client error as an isError result, not a throw", async () => {
    const client = fakeClient();
    client.remember = vi.fn(async () => { throw new Error("Token missing 'memory' scope"); });
    const h = makeHandlers(client as unknown as NotoClient, { scope: "proj/x" });
    const out = await h.remember({ text: "x" });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("memory");
  });

  it("list_notes returns text content from the client", async () => {
    const client = fakeClient();
    const h = makeHandlers(client as unknown as NotoClient, { scope: "proj/x" });
    const out = await h.list_notes({ limit: 10 });
    expect(client.listNotes).toHaveBeenCalledWith({ by: undefined, limit: 10 });
    expect(out.content[0].type).toBe("text");
    expect(JSON.parse(out.content[0].text)).toEqual({ notes: [] });
  });

  it("get_note passes the fileId through", async () => {
    const client = fakeClient();
    const h = makeHandlers(client as unknown as NotoClient, { scope: "proj/x" });
    const out = await h.get_note({ fileId: "1" });
    expect(client.getNote).toHaveBeenCalledWith({ fileId: "1" });
    expect(JSON.parse(out.content[0].text).file.title).toBe("T");
  });

  it("get_section passes fileId + heading through", async () => {
    const client = fakeClient();
    const h = makeHandlers(client as unknown as NotoClient, { scope: "proj/x" });
    await h.get_section({ fileId: "1", heading: "A/B" });
    expect(client.getSection).toHaveBeenCalledWith({ fileId: "1", heading: "A/B" });
  });

  it("recall injects the auto-detected scope", async () => {
    const client = fakeClient();
    const h = makeHandlers(client as unknown as NotoClient, { scope: "proj/x" });
    await h.recall({ query: "auth" });
    expect(client.recall).toHaveBeenCalledWith({ query: "auth", scope: "proj/x", type: undefined, limit: undefined });
  });

  it("create_note passes args through and returns text content", async () => {
    const client = fakeClient();
    const h = makeHandlers(client as unknown as NotoClient, { scope: "proj/x" });
    const out = await h.create_note({ path: "Memory/x.md", title: "X" });
    expect(client.createNote).toHaveBeenCalledWith({ path: "Memory/x.md", title: "X" });
    expect(JSON.parse(out.content[0].text).fileId).toBe("f1");
  });

  it("append_note passes args through", async () => {
    const client = fakeClient();
    const h = makeHandlers(client as unknown as NotoClient, { scope: "proj/x" });
    await h.append_note({ fileId: "f1", text: "hi" });
    expect(client.appendNote).toHaveBeenCalledWith({ fileId: "f1", text: "hi" });
  });

  it("update_section surfaces a client error as isError", async () => {
    const client = fakeClient();
    client.updateSection = vi.fn(async () => { throw new Error("AI writes are confined to Memory/"); });
    const h = makeHandlers(client as unknown as NotoClient, { scope: "proj/x" });
    const out = await h.update_section({ fileId: "f1", heading: "A", content: "x" });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("Memory/");
  });
});
