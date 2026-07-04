import { describe, it, expect } from "vitest";
import { startTestServer, signup, mintToken, makePatClient } from "../test-helpers.ts";

describe("GET /api/dump/notion/pages", () => {
  it("503s when the connector is unconfigured", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `np-${crypto.randomUUID()}@t.local`);
      const res = await client.req("GET", "/api/dump/notion/pages");
      expect(res.status).toBe(503);
    } finally {
      srv.close();
    }
  });

  it("rejects PAT auth (cookie-only)", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `np2-${crypto.randomUUID()}@t.local`);
      const token = await mintToken(client, ["read", "write"]);
      const pat = makePatClient(srv.baseURL, token);
      const res = await pat.req("GET", "/api/dump/notion/pages");
      expect(res.status).toBe(403);
    } finally {
      srv.close();
    }
  });
});
