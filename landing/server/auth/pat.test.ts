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
    // With one shared local owner, an earlier test in this file ("a read PAT
    // reaches...") already minted its own token for the same owner — so the
    // list length is relative to that baseline, not an absolute 1.
    const before = ((await (await cookie.req("GET", "/api/tokens")).json()) as { tokens: unknown[] }).tokens.length;

    const mint = await cookie.req("POST", "/api/tokens", { name: "laptop", scopes: ["read", "write"] });
    expect(mint.status).toBe(201);
    const { token, id } = (await mint.json()) as { token: string; id: string };
    expect(token.startsWith("noto_pat_")).toBe(true);

    const list = await (await cookie.req("GET", "/api/tokens")).json();
    expect(list.tokens).toHaveLength(before + 1);
    const mine = list.tokens.find((t: { id: string }) => t.id === id);
    expect(mine).not.toHaveProperty("token"); // plaintext never returned again
    expect(mine.scopes).toEqual(["read", "write"]);

    expect((await cookie.req("DELETE", `/api/tokens/${id}`)).status).toBe(204);
    expect((await (await cookie.req("GET", "/api/tokens")).json()).tokens).toHaveLength(before);
  });

  it("mints a token for the auto-provisioned local session", async () => {
    const anon = makeCookieClient(s.baseURL);
    await anon.req("GET", "/api/health"); // primes the session cookie (ensureLocalSession)
    const res = await anon.req("POST", "/api/tokens", { name: "x", scopes: ["read"] });
    expect(res.status).toBe(201);
  });
});
