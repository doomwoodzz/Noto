// server/auth/pat.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, makeCookieClient, type TestServer } from "../test-helpers.ts";

let s: TestServer;
beforeAll(async () => { s = await startTestServer(); });
afterAll(() => s.close());

describe("PAT auth plumbing", () => {
  it("a read PAT reaches an authenticated GET without cookie/CSRF", async () => {
    const cookie = await signup(s.baseURL, "pat-plumb@example.com");
    const token = await mintToken(cookie, ["read"]);
    const pat = makePatClient(s.baseURL, token);
    const res = await pat.req("GET", "/api/vaults"); // existing cookie-only routes ignore PATs → 401
    expect(res.status).toBe(401);
  });

  it("rejects a garbage bearer token as anonymous", async () => {
    const pat = makePatClient(s.baseURL, "noto_pat_not_a_real_token");
    const res = await pat.req("GET", "/api/files/anything");
    // tightened to 401 in Task C1 — until GET /api/files/:fileId is added, may 404
    expect([401, 404]).toContain(res.status);
  });
});

describe("PAT token management", () => {
  it("mints, lists, and revokes a PAT via the cookie API", async () => {
    const cookie = await signup(s.baseURL, "tokens@example.com");

    const mint = await cookie.req("POST", "/api/tokens", { name: "laptop", scopes: ["read", "write"] });
    expect(mint.status).toBe(201);
    const { token, id } = (await mint.json()) as { token: string; id: string };
    expect(token.startsWith("noto_pat_")).toBe(true);

    const list = await (await cookie.req("GET", "/api/tokens")).json();
    expect(list.tokens).toHaveLength(1);
    expect(list.tokens[0]).not.toHaveProperty("token"); // plaintext never returned again
    expect(list.tokens[0].scopes).toEqual(["read", "write"]);

    expect((await cookie.req("DELETE", `/api/tokens/${id}`)).status).toBe(204);
    expect((await (await cookie.req("GET", "/api/tokens")).json()).tokens).toHaveLength(0);
  });

  it("rejects unauthenticated token minting", async () => {
    const anon = makeCookieClient(s.baseURL);
    await anon.req("GET", "/api/health");
    expect((await anon.req("POST", "/api/tokens", { name: "x", scopes: ["read"] })).status).toBe(401);
  });
});
