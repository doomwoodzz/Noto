import { describe, it, expect, vi, afterEach } from "vitest";
import { makeLoopbackClient } from "./bridge.ts";
import { startTestServer, signup, mintToken, type TestServer } from "../test-helpers.ts";

// Record every fetch the bridge issues (method/url/headers/body) without a real
// server — lets us assert the bridge's HTTP shape precisely.
function recorder(status = 200, payload: unknown = { ok: true }) {
  const calls: { method: string; url: string; headers: Record<string, string>; body: string | undefined }[] = [];
  const fetchMock = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ method: init.method ?? "GET", url: String(url), headers, body: init.body as string | undefined });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  });
  return { calls, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe("makeLoopbackClient", () => {
  it("maps each method to the right /api verb+path and forwards auth + client headers", async () => {
    const { calls, fetchMock } = recorder();
    vi.stubGlobal("fetch", fetchMock);
    const c = makeLoopbackClient("http://127.0.0.1:8787", { token: "Bearer noto_pat_x", client: "cursor" });

    await c.remember({ text: "we use sqlite", scope: "proj" });
    await c.recall({ query: "sqlite", scope: "proj" });
    await c.createNote({ path: "Memory/a.md", title: "A", content: "x" });
    await c.getSection({ fileId: "f1", heading: "Parent/Child" });
    await c.updateSection({ fileId: "f1", heading: "A", content: "new" });

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("http://127.0.0.1:8787/api/memory");
    expect(calls[0].headers.authorization).toBe("Bearer noto_pat_x");
    expect(calls[0].headers["x-noto-client"]).toBe("cursor");
    expect(JSON.parse(calls[0].body!)).toEqual({ text: "we use sqlite", scope: "proj" });

    expect(calls[1].method).toBe("GET");
    expect(calls[1].url).toBe("http://127.0.0.1:8787/api/memory?q=sqlite&scope=proj&limit=6");

    expect(calls[2].method).toBe("POST");
    expect(calls[2].url).toBe("http://127.0.0.1:8787/api/notes");

    expect(calls[3].method).toBe("GET");
    expect(calls[3].url).toBe("http://127.0.0.1:8787/api/files/f1/section?heading=Parent%2FChild");

    expect(calls[4].method).toBe("PATCH");
    expect(calls[4].url).toBe("http://127.0.0.1:8787/api/files/f1/section");
  });

  it("throws the server's error message on a non-2xx response", async () => {
    const { fetchMock } = recorder(403, { error: "AI writes are confined to Memory/" });
    vi.stubGlobal("fetch", fetchMock);
    const c = makeLoopbackClient("http://127.0.0.1:8787", { token: "Bearer x", client: "codex" });
    await expect(c.createNote({ path: "Notes/x.md", title: "X" })).rejects.toThrow("confined to Memory/");
  });
});

describe("loopback against the real app", () => {
  let srv: TestServer;
  afterEach(() => srv?.close());

  it("reaches the real /api stack over loopback and round-trips a remember→recall", async () => {
    srv = await startTestServer();
    const cookie = await signup(srv.baseURL, "bridge-loopback@example.com");
    const token = await mintToken(cookie, ["read", "write", "memory"], "Bridge");
    const c = makeLoopbackClient(srv.baseURL, { token: `Bearer ${token}`, client: "cursor" });

    const { memoryId } = await c.remember({ text: "we ship on tuesdays", scope: "proj" });
    expect(memoryId).toBeTruthy();
    const { memories } = await c.recall({ query: "ship", scope: "proj" });
    expect(memories.some((m) => m.text === "we ship on tuesdays")).toBe(true);
  });
});
