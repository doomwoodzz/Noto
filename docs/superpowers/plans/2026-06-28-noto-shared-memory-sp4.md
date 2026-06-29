# SP4 — Remote Streamable-HTTP `/mcp` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount Noto's 9 MCP tools on the Express app as a stateless remote Streamable-HTTP endpoint (`POST /mcp`, bearer PAT), so users connect without a local `npx` install and from any machine — keeping stdio as the default.

**Architecture:** `/mcp` is a thin MCP-protocol shell. Each `tools/call` is replayed in-process through the existing `/api` stack via `light-my-request` (`inject(app, …)`, no socket), forwarding the bearer token + `X-Noto-Client`/`X-Noto-Scope` headers — so every SP1–SP3 guard (zod, ownership-404, `Memory/` confinement, scope-403, SP3 audit/provenance) is reused with zero duplication. Stateless: a fresh `McpServer` + `StreamableHTTPServerTransport({sessionIdGenerator: undefined})` per request.

**Tech Stack:** Express 5 + `node:sqlite`; `@modelcontextprotocol/sdk` (server `StreamableHTTPServerTransport` + `McpServer`; client used in tests); `light-my-request` for in-process dispatch; vitest (`node` env, `startTestServer`, `:memory:` DB). `noto-mcp` (stdio) is **untouched**.

**Spec:** `docs/superpowers/specs/2026-06-28-noto-shared-memory-sp4-design.md`.

**Commit posture (per the handoff):** per-task local commits on `feat/noto-web-app`; pushing / PR is a final checkpoint to confirm with the user.

**Conventions:** imports in `landing/` use explicit `.ts` extensions; SDK/`light-my-request` are imported by package specifier. Server tests boot `createApp()` on port 0; fresh `:memory:` DB per file; unique email per test. Run server tests `npm test` (from `landing/`); server typecheck `npm run typecheck:server`; client build `npm run build`; lint `npm run lint`.

---

## File Structure

**Server (`landing/server/mcp/`, all CREATE):**
- `bridge.ts` — `makeInjectClient(dispatch, {token, client})` → a 9-method `NotoBridgeClient` whose calls `inject` into the app's `/api` (mirrors `noto-mcp/src/notoClient.ts`).
- `handlers.ts` — `makeHandlers(client, {scope})` → the 9 thin tool handlers (mirrors `noto-mcp/src/tools.ts`).
- `server.ts` — `buildMcpServer(client, {scope})` → an `McpServer` with the 9 tools registered (schemas mirror `noto-mcp/src/index.ts`).
- `routes.ts` — `mountMcp(app)` → the stateless `POST /mcp` route + a `405` catch-all.
- `bridge.test.ts`, `handlers.test.ts`, `routes.test.ts` — tests.

**Server (MODIFY):**
- `landing/server/app.ts` — `mountMcp(app)` after the routers.
- `landing/package.json` — add `@modelcontextprotocol/sdk` + `light-my-request`.

**Client (`landing/src/`, MODIFY):**
- `workspace/mcpConfigs.ts` — add `buildRemoteConfigs(...)`.
- `workspace/mcpConfigs.test.ts` — add remote-config assertions.
- `workspace/McpSettings.tsx` — a Local/Remote toggle + project-scope input.

---

## Task 1: Dependencies + the in-process `/api` bridge

**Files:**
- Modify: `landing/package.json`
- Create: `landing/server/mcp/bridge.ts`
- Test: `landing/server/mcp/bridge.test.ts`

- [ ] **Step 1: Add the dependencies**

Run (from `landing/`): `npm install @modelcontextprotocol/sdk@^1.12.0 light-my-request@^6`
Expected: both added to `dependencies`. (`noto-mcp` already resolves `@modelcontextprotocol/sdk@1.29.0`; the same major works here.)

- [ ] **Step 2: Write the failing test**

Create `landing/server/mcp/bridge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { makeInjectClient } from "./bridge.ts";

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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd landing && npx vitest run server/mcp/bridge.test.ts`
Expected: FAIL — `./bridge.ts` not found.

- [ ] **Step 4: Implement `landing/server/mcp/bridge.ts`**

```ts
import inject from "light-my-request";

/** Whatever light-my-request's inject() accepts as its dispatch target (a DispatchFunc | http.Server | string). Avoids depending on a specific exported type name. */
export type InjectDispatch = Parameters<typeof inject>[0];

// Mirrors noto-mcp/src/notoClient.ts return types (the frozen tool contract).
export interface SearchResult { fileId: string; title: string; headingPath: string[]; snippet: string; score: number }
export interface NoteRef { fileId: string; title: string; path: string; updatedAt: number }
export interface Memory { id: string; text: string; type: string; scope: string; sourceClient: string; lastUsed: number; score?: number }

export interface NotoBridgeClient {
  searchNotes(a: { query: string; scope?: string; tag?: string; limit?: number }): Promise<{ results: SearchResult[] }>;
  listNotes(a: { by?: string; limit?: number }): Promise<{ notes: NoteRef[] }>;
  getNote(a: { fileId: string }): Promise<{ file: { id: string; title: string; path: string; content: string; updatedAt: number } }>;
  getSection(a: { fileId: string; heading: string }): Promise<{ fileId: string; headingPath: string[]; content: string }>;
  remember(a: { text: string; type?: string; scope?: string; supersedes?: string }): Promise<{ memoryId: string; deduped: boolean }>;
  recall(a: { query: string; scope?: string; type?: string; limit?: number }): Promise<{ memories: Memory[] }>;
  createNote(a: { path: string; title: string; content?: string }): Promise<{ fileId: string; path: string }>;
  appendNote(a: { fileId: string; text: string; underHeading?: string; expectUpdatedAt?: number }): Promise<{ fileId: string; updatedAt: number }>;
  updateSection(a: { fileId: string; heading: string; content: string; expectUpdatedAt?: number }): Promise<{ fileId: string; updatedAt: number }>;
}

const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

/**
 * Build a NotoBridgeClient whose calls are replayed in-process through `dispatch`
 * (the Express app) via light-my-request. `token` is the verbatim Authorization
 * header ("Bearer noto_pat_…"); `client` becomes X-Noto-Client for provenance.
 */
export function makeInjectClient(dispatch: InjectDispatch, opts: { token: string; client: string }): NotoBridgeClient {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: opts.token, "x-noto-client": opts.client };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await inject(dispatch, { method: method as "GET", url: path, headers, payload: body !== undefined ? JSON.stringify(body) : undefined });
    let data: unknown = null;
    try { data = JSON.parse(res.payload); } catch { /* empty body */ }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error((data as { error?: string } | null)?.error ?? `Noto request failed (${res.statusCode})`);
    }
    return data as T;
  }
  const enc = encodeURIComponent;
  return {
    searchNotes: (a) => call("GET", `/api/search?${qs({ q: a.query, scope: a.scope, tag: a.tag, limit: a.limit ?? 5 })}`),
    listNotes: (a) => call("GET", `/api/notes?${qs({ by: a.by ?? "recent", limit: a.limit ?? 20 })}`),
    getNote: (a) => call("GET", `/api/files/${enc(a.fileId)}`),
    getSection: (a) => call("GET", `/api/files/${enc(a.fileId)}/section?heading=${enc(a.heading)}`),
    remember: (a) => call("POST", "/api/memory", a),
    recall: (a) => call("GET", `/api/memory?${qs({ q: a.query, scope: a.scope, type: a.type, limit: a.limit ?? 6 })}`),
    createNote: (a) => call("POST", "/api/notes", a),
    appendNote: (a) => call("POST", `/api/files/${enc(a.fileId)}/append`, { text: a.text, underHeading: a.underHeading, expectUpdatedAt: a.expectUpdatedAt }),
    updateSection: (a) => call("PATCH", `/api/files/${enc(a.fileId)}/section`, { heading: a.heading, content: a.content, expectUpdatedAt: a.expectUpdatedAt }),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd landing && npx vitest run server/mcp/bridge.test.ts`
Expected: PASS (2 tests). (The `recorder()` stub is a plain `(req,res)` function, assignable to `InjectDispatch`; if TS complains, pass `dispatch as never`.)

- [ ] **Step 6: Verify light-my-request drives the real Express app**

Add this test to `bridge.test.ts` (proves the inject mechanism works against the actual `/api` middleware stack, the one Express-compat risk):

```ts
import { createApp } from "../app.ts";
import injectFn from "light-my-request";

describe("inject against the real app", () => {
  it("reaches GET /api/health in-process and returns 200 JSON", async () => {
    const app = createApp();
    const res = await injectFn(app as never, { method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({ ok: true });
  });
});
```

Run: `cd landing && npx vitest run server/mcp/bridge.test.ts`
Expected: PASS (3 tests). **If this `/api/health` inject fails (Express incompatibility with light-my-request), STOP and report** — the fallback is a localhost loopback (`fetch` to `http://127.0.0.1:${env.PORT}`) behind the same `makeInjectClient` signature, decided with the controller.

- [ ] **Step 7: Typecheck + commit**

Run: `cd landing && npm run typecheck:server`

```bash
git add landing/package.json landing/package-lock.json landing/server/mcp/bridge.ts landing/server/mcp/bridge.test.ts
git commit -m "feat(sp4): in-process /api bridge for remote MCP (light-my-request)"
```

---

## Task 2: Tool handlers + MCP server builder

**Files:**
- Create: `landing/server/mcp/handlers.ts`
- Create: `landing/server/mcp/server.ts`
- Test: `landing/server/mcp/handlers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `landing/server/mcp/handlers.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd landing && npx vitest run server/mcp/handlers.test.ts`
Expected: FAIL — `./handlers.ts` not found.

- [ ] **Step 3: Implement `landing/server/mcp/handlers.ts`** (mirrors `noto-mcp/src/tools.ts`)

```ts
import type { NotoBridgeClient } from "./bridge.ts";

export interface ToolResult { [key: string]: unknown; content: { type: "text"; text: string }[]; isError?: boolean }
const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const fail = (e: unknown): ToolResult => ({ content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });

/** The 9 tool handlers. `scope` is the X-Noto-Scope default; read tools + remember fall back to it. */
export function makeHandlers(client: NotoBridgeClient, ctx: { scope: string }) {
  return {
    async search_notes(a: { query: string; scope?: string; tag?: string; limit?: number }) {
      try { return ok(await client.searchNotes({ query: a.query, scope: a.scope ?? ctx.scope, tag: a.tag, limit: a.limit })); } catch (e) { return fail(e); }
    },
    async list_notes(a: { by?: string; limit?: number }) {
      try { return ok(await client.listNotes({ by: a.by, limit: a.limit })); } catch (e) { return fail(e); }
    },
    async get_note(a: { fileId: string }) {
      try { return ok(await client.getNote({ fileId: a.fileId })); } catch (e) { return fail(e); }
    },
    async get_section(a: { fileId: string; heading: string }) {
      try { return ok(await client.getSection({ fileId: a.fileId, heading: a.heading })); } catch (e) { return fail(e); }
    },
    async remember(a: { text: string; type?: string; scope?: string; supersedes?: string }) {
      try { return ok(await client.remember({ text: a.text, type: a.type, scope: a.scope ?? ctx.scope, supersedes: a.supersedes })); } catch (e) { return fail(e); }
    },
    async recall(a: { query: string; scope?: string; type?: string; limit?: number }) {
      try { return ok(await client.recall({ query: a.query, scope: a.scope ?? ctx.scope, type: a.type, limit: a.limit })); } catch (e) { return fail(e); }
    },
    async create_note(a: { path: string; title: string; content?: string }) {
      try { return ok(await client.createNote(a)); } catch (e) { return fail(e); }
    },
    async append_note(a: { fileId: string; text: string; underHeading?: string; expectUpdatedAt?: number }) {
      try { return ok(await client.appendNote(a)); } catch (e) { return fail(e); }
    },
    async update_section(a: { fileId: string; heading: string; content: string; expectUpdatedAt?: number }) {
      try { return ok(await client.updateSection(a)); } catch (e) { return fail(e); }
    },
  };
}
export type Handlers = ReturnType<typeof makeHandlers>;
```

- [ ] **Step 4: Implement `landing/server/mcp/server.ts`** (schemas mirror `noto-mcp/src/index.ts`)

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeHandlers } from "./handlers.ts";
import type { NotoBridgeClient } from "./bridge.ts";

/** Build an McpServer with the 9 Noto tools. Mirrors noto-mcp/src/index.ts (frozen contract). */
export function buildMcpServer(client: NotoBridgeClient, ctx: { scope: string }): McpServer {
  const h = makeHandlers(client, ctx);
  const server = new McpServer({ name: "noto-mcp", version: "0.1.0" });

  server.tool("search_notes", "Search the user's Noto notes; returns heading-addressable refs + snippets. Prefer this over reading whole notes.",
    { query: z.string(), scope: z.string().optional(), tag: z.string().optional(), limit: z.number().int().optional() }, async (a) => h.search_notes(a));
  server.tool("list_notes", "List recent notes as references (no bodies).",
    { by: z.enum(["recent"]).optional(), limit: z.number().int().optional() }, async (a) => h.list_notes(a));
  server.tool("get_note", "Fetch one whole note by id. Prefer get_section when you only need part of it.",
    { fileId: z.string() }, async (a) => h.get_note(a));
  server.tool("get_section", "Fetch one section of a note by heading path (e.g. 'Parent/Child').",
    { fileId: z.string(), heading: z.string() }, async (a) => h.get_section(a));
  server.tool("remember", "Persist a durable decision/preference/fact to shared memory for this project. Store durable things only.",
    { text: z.string(), type: z.enum(["decision", "preference", "fact", "glossary"]).optional(), scope: z.string().optional(), supersedes: z.string().optional() }, async (a) => h.remember(a));
  server.tool("recall", "Recall prior decisions/preferences/facts relevant to a query before acting.",
    { query: z.string(), scope: z.string().optional(), type: z.string().optional(), limit: z.number().int().optional() }, async (a) => h.recall(a));
  server.tool("create_note", "Create a note. Agent writes must live under Memory/ (e.g. 'Memory/decisions.md').",
    { path: z.string(), title: z.string(), content: z.string().optional() }, async (a) => h.create_note(a));
  server.tool("append_note", "Append text to a note (optionally under a heading). Memory/ notes only.",
    { fileId: z.string(), text: z.string(), underHeading: z.string().optional(), expectUpdatedAt: z.number().int().optional() }, async (a) => h.append_note(a));
  server.tool("update_section", "Replace one section of a Memory/ note by heading path. Prefer this over rewriting a whole note.",
    { fileId: z.string(), heading: z.string(), content: z.string(), expectUpdatedAt: z.number().int().optional() }, async (a) => h.update_section(a));

  return server;
}
```

- [ ] **Step 5: Run the handlers test to verify it passes**

Run: `cd landing && npx vitest run server/mcp/handlers.test.ts`
Expected: PASS (3 tests). (`server.ts` is exercised end-to-end in Task 3.)

- [ ] **Step 6: Typecheck + commit**

Run: `cd landing && npm run typecheck:server`

```bash
git add landing/server/mcp/handlers.ts landing/server/mcp/server.ts landing/server/mcp/handlers.test.ts
git commit -m "feat(sp4): MCP tool handlers + server builder (9 tools, mirrors noto-mcp)"
```

---

## Task 3: The stateless `/mcp` route + integration tests

**Files:**
- Create: `landing/server/mcp/routes.ts`
- Modify: `landing/server/app.ts`
- Test: `landing/server/mcp/routes.test.ts`

- [ ] **Step 1: Write the failing test** (drives the endpoint with the official SDK client)

Create `landing/server/mcp/routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startTestServer, signup, mintToken, type TestServer } from "../test-helpers.ts";

let srv: TestServer;
beforeAll(async () => { srv = await startTestServer(); });
afterAll(() => srv.close());

async function connect(token: string, headers: Record<string, string> = {}) {
  const transport = new StreamableHTTPClientTransport(new URL(`${srv.baseURL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}`, "X-Noto-Client": "cursor", ...headers } },
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return { client, transport };
}
const textOf = (r: { content: { type: string; text: string }[] }) => JSON.parse(r.content[0].text);

describe("POST /mcp (remote Streamable HTTP)", () => {
  it("401s without a PAT", async () => {
    const res = await fetch(`${srv.baseURL}/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } } }),
    });
    expect(res.status).toBe(401);
  });

  it("405s a GET (stateless — no server stream)", async () => {
    const res = await fetch(`${srv.baseURL}/mcp`, { method: "GET", headers: { Accept: "text/event-stream" } });
    expect(res.status).toBe(405);
  });

  it("lists exactly 9 tools and runs a remember→recall roundtrip scoped by X-Noto-Scope", async () => {
    const cookie = await signup(srv.baseURL, "mcp-roundtrip@example.com");
    const token = await mintToken(cookie, ["read", "write", "memory"], "Remote");
    const { client, transport } = await connect(token, { "X-Noto-Scope": "proj-a" });

    const tools = await client.listTools();
    expect(tools.tools.length).toBe(9);

    await client.callTool({ name: "remember", arguments: { text: "we deploy on fly.io" } });
    const recalled = await client.callTool({ name: "recall", arguments: { query: "deploy" } });
    expect(textOf(recalled as never).memories.some((m: { text: string }) => m.text === "we deploy on fly.io")).toBe(true);

    // A different scope must NOT see it (X-Noto-Scope default landed it in proj-a).
    await transport.close();
    const other = await connect(token, { "X-Noto-Scope": "proj-b" });
    const miss = await other.client.callTool({ name: "recall", arguments: { query: "deploy" } });
    expect(textOf(miss as never).memories.some((m: { text: string }) => m.text === "we deploy on fly.io")).toBe(false);
    await other.transport.close();
  });

  it("confines writes to Memory/ and surfaces 403s as tool errors", async () => {
    const cookie = await signup(srv.baseURL, "mcp-confine@example.com");
    const token = await mintToken(cookie, ["read", "write", "memory"], "Remote");
    const { client, transport } = await connect(token);

    const okCreate = await client.callTool({ name: "create_note", arguments: { path: "Memory/ok.md", title: "OK", content: "x" } });
    expect((okCreate as { isError?: boolean }).isError).toBeFalsy();
    const bad = await client.callTool({ name: "create_note", arguments: { path: "Notes/bad.md", title: "Bad", content: "x" } });
    expect((bad as { isError?: boolean }).isError).toBe(true);
    expect(JSON.stringify(bad)).toContain("Memory/");
    await transport.close();
  });

  it("a read-only token gets a tool error on remember (scope enforced by the bridge)", async () => {
    const cookie = await signup(srv.baseURL, "mcp-scope@example.com");
    const token = await mintToken(cookie, ["read"], "ReadOnly");
    const { client, transport } = await connect(token);
    const r = await client.callTool({ name: "remember", arguments: { text: "nope", scope: "p" } });
    expect((r as { isError?: boolean }).isError).toBe(true);
    await transport.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd landing && npx vitest run server/mcp/routes.test.ts`
Expected: FAIL — `/mcp` 404s (route not mounted).

- [ ] **Step 3: Implement `landing/server/mcp/routes.ts`**

```ts
import express, { type Express, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { resolveApiToken, requireApiUser } from "../auth/pat.ts";
import { makeInjectClient, type InjectDispatch } from "./bridge.ts";
import { buildMcpServer } from "./server.ts";

const mcpLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many requests." },
});
const jsonBody = express.json({ limit: "512kb" });

/** Mount the stateless remote MCP endpoint. Each POST gets a fresh server+transport. */
export function mountMcp(app: Express): void {
  app.post("/mcp", resolveApiToken, mcpLimiter, jsonBody, async (req: Request, res: Response) => {
    if (!requireApiUser(req, res)) return; // 401 if absent/invalid PAT
    const token = req.get("authorization") ?? "";               // verbatim "Bearer noto_pat_…"
    const client = (req.get("x-noto-client") || "remote").slice(0, 40);
    const scope = (req.get("x-noto-scope") || "global").slice(0, 200);

    const server = buildMcpServer(makeInjectClient(app as unknown as InjectDispatch, { token, client }), { scope });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: "MCP error" });
    }
  });

  // Stateless: no server→client GET stream, no session DELETE.
  app.all("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({ error: "Method not allowed (stateless /mcp accepts POST only)" });
  });
}
```

Note: `makeInjectClient(app …)` passes the Express `app` as the light-my-request dispatch target (cast to `InjectDispatch`; `app` is a valid runtime dispatch function) — each tool call replays through the full `/api` stack (PAT bypasses CSRF, so the injected write reaches the route).

- [ ] **Step 4: Mount it in `app.ts`**

Add the import near the other router imports:
```ts
import { mountMcp } from "./mcp/routes.ts";
```
Call it in the routes section, after `app.use("/api", searchRouter);` and before the static-frontend block:
```ts
  mountMcp(app);
```

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `cd landing && npx vitest run server/mcp/routes.test.ts`
Expected: PASS (5 tests). If the SDK client hangs opening its optional GET stream (we 405 it), confirm the 405 catch-all returns promptly; the client treats a 405 standalone stream as "unavailable" and proceeds. If a test times out on `connect`, STOP and report (we may need to return `202`/empty for GET instead of 405 — a documented MCP option).

- [ ] **Step 6: Typecheck + lint, then commit**

Run: `cd landing && npm run typecheck:server && npm run lint`

```bash
git add landing/server/mcp/routes.ts landing/server/app.ts landing/server/mcp/routes.test.ts
git commit -m "feat(sp4): stateless remote /mcp endpoint (bearer PAT, in-process /api bridge)"
```

---

## Task 4: Remote config generator + Settings toggle

**Files:**
- Modify: `landing/src/workspace/mcpConfigs.ts`
- Test: `landing/src/workspace/mcpConfigs.test.ts`
- Modify: `landing/src/workspace/McpSettings.tsx`

- [ ] **Step 1: Write the failing test**

Append to `landing/src/workspace/mcpConfigs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRemoteConfigs } from "./mcpConfigs";

describe("buildRemoteConfigs", () => {
  it("produces an http server config per client with auth + client + scope headers", () => {
    const r = buildRemoteConfigs({ notoUrl: "https://noto.app", token: "noto_pat_abc", scope: "github.com/acme/widgets" });
    const cc = JSON.parse(r.claudeCode);
    expect(cc.mcpServers.noto.type).toBe("http");
    expect(cc.mcpServers.noto.url).toBe("https://noto.app/mcp");
    expect(cc.mcpServers.noto.headers.Authorization).toBe("Bearer noto_pat_abc");
    expect(cc.mcpServers.noto.headers["X-Noto-Client"]).toBe("claude-code");
    expect(cc.mcpServers.noto.headers["X-Noto-Scope"]).toBe("github.com/acme/widgets");

    const cur = JSON.parse(r.cursor);
    expect(cur.mcpServers.noto.headers["X-Noto-Client"]).toBe("cursor");

    expect(r.codex).toContain('url = "https://noto.app/mcp"');
    expect(r.codex).toContain('X-Noto-Client = "codex"');
    expect(r.codex).toContain('X-Noto-Scope = "github.com/acme/widgets"');
    expect(r.codex).toContain("disable_on_external_context = true");
  });

  it("omits X-Noto-Scope when no scope is given (server defaults to global)", () => {
    const r = buildRemoteConfigs({ notoUrl: "https://noto.app", token: "noto_pat_abc" });
    expect(JSON.parse(r.claudeCode).mcpServers.noto.headers["X-Noto-Scope"]).toBeUndefined();
    expect(r.codex).not.toContain("X-Noto-Scope");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd landing && npx vitest run src/workspace/mcpConfigs.test.ts`
Expected: FAIL — `buildRemoteConfigs` not exported.

- [ ] **Step 3: Add `buildRemoteConfigs` to `mcpConfigs.ts`**

Append:

```ts
export interface RemoteConfigInput { notoUrl: string; token: string; scope?: string }

function remoteHeaders(token: string, client: string, scope?: string): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${token}`, "X-Noto-Client": client };
  if (scope) h["X-Noto-Scope"] = scope;
  return h;
}
function remoteJson(notoUrl: string, token: string, client: string, scope?: string): string {
  return JSON.stringify({ mcpServers: { noto: { type: "http", url: `${notoUrl}/mcp`, headers: remoteHeaders(token, client, scope) } } }, null, 2);
}

export function buildRemoteConfigs({ notoUrl, token, scope }: RemoteConfigInput) {
  const t = token || "noto_pat_…";
  const codex =
    `[mcp_servers.noto]\n` +
    `url = "${notoUrl}/mcp"\n\n` +
    `[mcp_servers.noto.headers]\n` +
    `Authorization = "Bearer ${t}"\n` +
    `X-Noto-Client = "codex"\n` +
    (scope ? `X-Noto-Scope = "${scope}"\n` : "") +
    `\n[memories]\n` +
    `disable_on_external_context = true\n`;
  return {
    claudeCode: remoteJson(notoUrl, t, "claude-code", scope),
    cursor: remoteJson(notoUrl, t, "cursor", scope),
    codex,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd landing && npx vitest run src/workspace/mcpConfigs.test.ts`
Expected: PASS (existing buildConfigs tests + 2 new).

- [ ] **Step 5: Add the Local/Remote toggle to `McpSettings.tsx`**

In the component, add state next to the existing `kind` state:
```tsx
  const [mode, setMode] = useState<"local" | "remote">("local");
  const [scope, setScope] = useState("");
```
Add the remote-config import at the top (next to `buildConfigs`):
```tsx
import { buildConfigs, buildRemoteConfigs } from "./mcpConfigs";
```
Replace the `cfgs`/`config` derivation (currently `const cfgs = buildConfigs({ notoUrl: client.notoUrl, token: fresh ?? "" });` and the `config` line) with:
```tsx
  const localCfgs = buildConfigs({ notoUrl: client.notoUrl, token: fresh ?? "" });
  const remoteCfgs = buildRemoteConfigs({ notoUrl: client.notoUrl, token: fresh ?? "", scope: scope.trim() || undefined });
  const cfgs = mode === "remote" ? remoteCfgs : localCfgs;
  const config = kind === "claude-code" ? cfgs.claudeCode : kind === "cursor" ? cfgs.cursor : cfgs.codex;
  const steering = kind === "cursor" ? localCfgs.cursorRule : localCfgs.steering;
```
In the "2 · Configure your tool" section, add a Local/Remote toggle above the client tabs, and (when remote) a scope input. After the `<div className="nw-mcp-tabs">…</div>` block, insert:
```tsx
          <div className="nw-mcp-tabs" role="tablist" aria-label="Transport">
            {(["local", "remote"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m}
                className={mode === m ? "nw-mcp-tab nw-mcp-tab-on" : "nw-mcp-tab"}
                onClick={() => setMode(m)}>{m === "local" ? "Local (npx)" : "Remote (hosted)"}</button>
            ))}
          </div>
          {mode === "remote" && (
            <div className="nw-mcp-row">
              <input value={scope} onChange={(e) => setScope(e.target.value)}
                placeholder="Project scope (optional, e.g. github.com/acme/widgets)" aria-label="Project scope" />
            </div>
          )}
          {mode === "remote" && kind === "codex" && (
            <p className="nw-mcp-empty">Codex remote MCP can be flaky — the Local (npx) option is more reliable for Codex.</p>
          )}
```
(The config target line `Add to <code>{CONFIG_TARGET[kind]}</code>` stays; remote uses the same files with the http-shaped contents.)

- [ ] **Step 6: Verify the client builds**

Run: `cd landing && npx tsc -b --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add landing/src/workspace/mcpConfigs.ts landing/src/workspace/mcpConfigs.test.ts landing/src/workspace/McpSettings.tsx
git commit -m "feat(sp4): remote (hosted) MCP config variants + Local/Remote settings toggle"
```

---

## Task 5: Full verification + live HTTP smoke

**Files:** none (verification only)

- [ ] **Step 1: Full suites + checks**

Run: `cd landing && npm test`
Expected: all green (prior 190 + the SP4 server tests + the 2 new config tests).

Run: `cd landing && npm run typecheck:server && npm run lint && npm run build`
Expected: clean.

Run: `cd /Users/SV/Desktop/Noto/noto-mcp && npm test && npm run typecheck && npm run build`
Expected: 21 tests green (stdio unchanged); still exactly 9 tools.

- [ ] **Step 2: Live HTTP smoke (real entrypoint)**

Start the API on a temp DB + port:
```bash
cd landing
DATABASE_PATH=/tmp/noto-sp4-smoke.sqlite PORT=8801 NODE_ENV=development \
  SESSION_SECRET=smoke-session-secret-at-least-32-chars-long APP_ORIGIN=http://localhost:5173 \
  npx tsx server/index.ts > /tmp/sp4-smoke.log 2>&1 &
SRV=$!
curl --retry 40 --retry-delay 1 --retry-connrefused -sf http://127.0.0.1:8801/api/health > /dev/null && echo "up"
```
Then a Node smoke (write `/tmp/sp4-smoke.mjs`) that: primes CSRF via `GET /api/health`, signs up, mints a `read,write,memory` PAT, then uses the SDK client (`StreamableHTTPClientTransport` → `${BASE}/mcp` with `Authorization`/`X-Noto-Client: cursor`/`X-Noto-Scope: smoke`) to (1) `listTools` = 9, (2) `create_note` under `Memory/` then `create_note` to `Notes/` → `isError`, (3) `remember` then — over a SECOND fresh client connection — `recall` returns it (cross-connection, proves stateless + scope), (4) a `read`-only PAT → `remember` → `isError`. Print PASS/FAIL counts. Then `kill $SRV`.

Expected: all checks pass. Capture the output.

- [ ] **Step 3: Update the memory file**

Update `noto-mcp-memory-layer` with SP4 status (remote `/mcp` shipped: stateless Streamable HTTP, in-process `/api` bridge, `X-Noto-Scope`/`X-Noto-Client` headers, Local/Remote config toggle; stdio + noto-mcp unchanged; 9 tools).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "test(sp4): full verification + live remote-MCP HTTP smoke"
```

---

## Self-Review notes (resolved)

- **Spec coverage:** `/mcp` stateless endpoint (§3,§4) → Task 3; in-process bridge (§3, S4-D4) → Task 1; 9 tools/handlers/schemas (§3) → Task 2; `X-Noto-Scope`/`X-Noto-Client` (§5) → Tasks 2/3; config UI (§6) → Task 4; transport-wrinkle Codex note (§6) → Task 4 (UI hint); safety/PAT/scope/confinement (§7) → Tasks 1/3 (reused via the bridge); testing (§9) → Tasks 1–5; success criteria (§10) → Task 5.
- **Bridge mechanism:** `light-my-request` `inject(app, …)`; Task 1 Step 6 verifies Express compatibility before anything depends on it; loopback-to-`env.PORT` is the documented fallback if that step fails.
- **Type consistency:** `NotoBridgeClient` (bridge.ts) is consumed by `makeHandlers` (handlers.ts) and `buildMcpServer` (server.ts); `ToolResult` shape matches what the SDK's `tool()` callback expects; the 9 tool names/schemas match `noto-mcp/src/index.ts` exactly.
- **No new tools / no trust-surface exposure:** only the 9 SP1/SP2 tools are registered; `/api/activity` (SP3, cookie-only) is never reachable via `/mcp`.
- **`noto-mcp` untouched:** no task edits the `noto-mcp` package; Task 5 re-runs its suite as a regression check.
