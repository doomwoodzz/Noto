import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";

let s: TestServer;
beforeAll(async () => { s = await startTestServer(); });
afterAll(() => s.close());

async function memToken(email: string) {
  const cookie = await signup(s.baseURL, email);
  const token = await mintToken(cookie, ["read", "memory"], "claude");
  return { cookie, pat: makePatClient(s.baseURL, token) };
}

describe("/api/memory", () => {
  it("remembers (memory scope) then recalls (read scope) with the X-Noto-Client provenance", async () => {
    const { pat } = await memToken("route-mem@example.com");
    const wrote = await pat.req("POST", "/api/memory", { text: "Auth uses scrypt", type: "decision", scope: "proj/api" }, { "X-Noto-Client": "claude-code" });
    expect(wrote.status).toBe(201);
    const { memoryId, deduped } = (await wrote.json()) as { memoryId: string; deduped: boolean };
    expect(deduped).toBe(false);
    expect(memoryId).toBeTruthy();

    const got = await pat.req("GET", "/api/memory?q=scrypt&scope=proj/api&limit=6");
    expect(got.status).toBe(200);
    const { memories } = (await got.json()) as { memories: { text: string; sourceClient: string }[] };
    expect(memories[0].text).toBe("Auth uses scrypt");
    expect(memories[0].sourceClient).toBe("claude-code");
  });

  it("rejects remember from a read-only token (403) and accepts recall (read)", async () => {
    const cookie = await signup(s.baseURL, "route-ro@example.com");
    const ro = makePatClient(s.baseURL, await mintToken(cookie, ["read"], "ro"));
    expect((await ro.req("POST", "/api/memory", { text: "x", scope: "p" })).status).toBe(403);
    expect((await ro.req("GET", "/api/memory?q=x")).status).toBe(200);
  });

  it("returns 401 for unauthenticated recall (no token)", async () => {
    const res = await fetch(s.baseURL + "/api/memory?q=x", { headers: { Origin: "http://localhost:5173" } });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid type filter with 400", async () => {
    const { pat } = await memToken("route-badtype@example.com");
    expect((await pat.req("GET", "/api/memory?q=x&type=banana")).status).toBe(400);
  });
});
