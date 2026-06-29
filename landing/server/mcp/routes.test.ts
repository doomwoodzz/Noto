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
