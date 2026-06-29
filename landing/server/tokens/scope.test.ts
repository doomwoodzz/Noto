import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, signup, type TestServer } from "../test-helpers.ts";

let s: TestServer;
beforeAll(async () => { s = await startTestServer(); });
afterAll(() => s.close());

describe("PAT 'memory' scope", () => {
  it("mints a token carrying read + memory scopes", async () => {
    const cookie = await signup(s.baseURL, "scope-memory@example.com");
    const res = await cookie.req("POST", "/api/tokens", { name: "claude", scopes: ["read", "memory"] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { scopes: string[] };
    expect(body.scopes).toEqual(["read", "memory"]);
  });

  it("rejects an unknown scope", async () => {
    const cookie = await signup(s.baseURL, "scope-bad@example.com");
    const res = await cookie.req("POST", "/api/tokens", { name: "x", scopes: ["telepathy"] });
    expect(res.status).toBe(400);
  });
});
