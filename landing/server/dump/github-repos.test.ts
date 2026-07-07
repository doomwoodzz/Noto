import { describe, it, expect } from "vitest";
import { startTestServer, signup } from "../test-helpers.ts";

describe("GET /api/dump/github/repos", () => {
  it("503s when GitHub is not configured", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `r-${crypto.randomUUID()}@t.local`);
      const res = await client.req("GET", "/api/dump/github/repos");
      // githubConfigured is false under test → 503 (config gate precedes the connection check).
      expect(res.status).toBe(503);
    } finally {
      srv.close();
    }
  });

  it("rejects PAT auth (cookie-only → 403)", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `r2-${crypto.randomUUID()}@t.local`);
      const { mintToken, makePatClient } = await import("../test-helpers.ts");
      const token = await mintToken(client, ["read", "write"]);
      const pat = makePatClient(srv.baseURL, token);
      const res = await pat.req("GET", "/api/dump/github/repos");
      expect(res.status).toBe(403);
    } finally {
      srv.close();
    }
  });
});
