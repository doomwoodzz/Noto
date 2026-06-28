import { describe, it, expect } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { makeInjectClient } from "./bridge.ts";
import { createApp } from "../app.ts";
import injectFn from "light-my-request";

// A stub dispatch (the `(req,res)` shape light-my-request drives) that records the
// request and echoes a canned JSON body — lets us assert the bridge's HTTP shape
// without a real app.
function recorder() {
  const calls: { method: string; url: string; headers: Record<string, string>; body: string }[] = [];
  const dispatch = (req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers as Record<string, string>, body });
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
  };
  return { calls, dispatch };
}

describe("makeInjectClient", () => {
  it("maps each method to the right /api verb+path and forwards auth + client headers", async () => {
    const { calls, dispatch } = recorder();
    const c = makeInjectClient(dispatch, { token: "Bearer noto_pat_x", client: "cursor" });

    await c.remember({ text: "we use sqlite", scope: "proj" });
    await c.recall({ query: "sqlite", scope: "proj" });
    await c.createNote({ path: "Memory/a.md", title: "A", content: "x" });
    await c.getSection({ fileId: "f1", heading: "Parent/Child" });
    await c.updateSection({ fileId: "f1", heading: "A", content: "new" });

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("/api/memory");
    expect(calls[0].headers.authorization).toBe("Bearer noto_pat_x");
    expect(calls[0].headers["x-noto-client"]).toBe("cursor");
    expect(JSON.parse(calls[0].body)).toEqual({ text: "we use sqlite", scope: "proj" });

    expect(calls[1].method).toBe("GET");
    expect(calls[1].url).toBe("/api/memory?q=sqlite&scope=proj&limit=6");

    expect(calls[2].method).toBe("POST");
    expect(calls[2].url).toBe("/api/notes");

    expect(calls[3].method).toBe("GET");
    expect(calls[3].url).toBe("/api/files/f1/section?heading=Parent%2FChild");

    expect(calls[4].method).toBe("PATCH");
    expect(calls[4].url).toBe("/api/files/f1/section");
  });

  it("throws the server's error message on a non-2xx response", async () => {
    const dispatch = (_req: IncomingMessage, res: ServerResponse) => {
      res.statusCode = 403; res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "AI writes are confined to Memory/" }));
    };
    const c = makeInjectClient(dispatch, { token: "Bearer x", client: "codex" });
    await expect(c.createNote({ path: "Notes/x.md", title: "X" })).rejects.toThrow("confined to Memory/");
  });
});

describe("inject against the real app", () => {
  it("reaches GET /api/health in-process and returns 200 JSON", async () => {
    const app = createApp();
    const res = await injectFn(app as never, { method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({ ok: true });
  });
});
