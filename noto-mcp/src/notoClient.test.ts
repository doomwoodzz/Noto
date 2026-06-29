import { describe, expect, it, vi } from "vitest";
import { createNotoClient } from "./notoClient.ts";

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
}

const opts = { baseUrl: "https://noto.test", token: "noto_pat_abc", client: "claude-code" };

describe("notoClient", () => {
  it("sends Bearer auth + X-Noto-Client and parses search results", async () => {
    const fetchImpl = fakeFetch((url, init) => {
      expect(url).toBe("https://noto.test/api/search?q=auth&limit=5");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer noto_pat_abc");
      expect((init.headers as Record<string, string>)["X-Noto-Client"]).toBe("claude-code");
      return { status: 200, body: { results: [{ fileId: "1", title: "Auth", headingPath: [], snippet: "x", score: -1 }] } };
    });
    const c = createNotoClient({ ...opts, fetchImpl });
    const r = await c.searchNotes({ query: "auth", limit: 5 });
    expect(r.results[0].title).toBe("Auth");
  });

  it("remembers with scope in the body + X-Noto-Client", async () => {
    const fetchImpl = fakeFetch((url, init) => {
      expect(url).toBe("https://noto.test/api/memory");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toMatchObject({ text: "hi", scope: "proj/x" });
      return { status: 201, body: { memoryId: "m1", deduped: false } };
    });
    const c = createNotoClient({ ...opts, fetchImpl });
    expect((await c.remember({ text: "hi", scope: "proj/x" })).memoryId).toBe("m1");
  });

  it("throws the server error message on non-2xx", async () => {
    const fetchImpl = fakeFetch(() => ({ status: 403, body: { error: "Token missing 'memory' scope" } }));
    const c = createNotoClient({ ...opts, fetchImpl });
    await expect(c.remember({ text: "x" })).rejects.toThrow("Token missing 'memory' scope");
  });

  it("falls back to a generic message when the error body has no error field", async () => {
    const fetchImpl = fakeFetch(() => ({ status: 500, body: {} }));
    const c = createNotoClient({ ...opts, fetchImpl });
    await expect(c.searchNotes({ query: "x" })).rejects.toThrow("Noto request failed (500)");
  });

  it("createNote POSTs to /api/notes with the body", async () => {
    const fetchImpl = fakeFetch((url, init) => {
      expect(url).toBe("https://noto.test/api/notes");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toMatchObject({ path: "Memory/x.md", title: "X" });
      return { status: 201, body: { fileId: "f1", path: "Memory/x.md" } };
    });
    const c = createNotoClient({ ...opts, fetchImpl });
    expect((await c.createNote({ path: "Memory/x.md", title: "X" })).fileId).toBe("f1");
  });

  it("appendNote POSTs to /api/files/:id/append", async () => {
    const fetchImpl = fakeFetch((url, init) => {
      expect(url).toBe("https://noto.test/api/files/f1/append");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toMatchObject({ text: "hi", underHeading: "A/B" });
      return { status: 200, body: { fileId: "f1", updatedAt: 9 } };
    });
    const c = createNotoClient({ ...opts, fetchImpl });
    expect((await c.appendNote({ fileId: "f1", text: "hi", underHeading: "A/B" })).updatedAt).toBe(9);
  });

  it("updateSection PATCHes /api/files/:id/section", async () => {
    const fetchImpl = fakeFetch((url, init) => {
      expect(url).toBe("https://noto.test/api/files/f1/section");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body as string)).toMatchObject({ heading: "A", content: "## A\n\nx" });
      return { status: 200, body: { fileId: "f1", updatedAt: 9 } };
    });
    const c = createNotoClient({ ...opts, fetchImpl });
    expect((await c.updateSection({ fileId: "f1", heading: "A", content: "## A\n\nx" })).updatedAt).toBe(9);
  });
});
