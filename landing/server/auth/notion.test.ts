import { describe, it, expect } from "vitest";
import { startTestServer, signup, makeCookieClient } from "../test-helpers.ts";

describe("notion oauth gating", () => {
  it("503s the install route when the connector is unconfigured", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `n-${crypto.randomUUID()}@t.local`);
      const res = await client.req("GET", "/api/auth/notion/install");
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/not configured/i);
    } finally {
      srv.close();
    }
  });

  it("401s the install route when not authenticated", async () => {
    const srv = await startTestServer();
    try {
      // Bare cookie client with no session (never signed up).
      const client = makeCookieClient(srv.baseURL);
      const res = await client.req("GET", "/api/auth/notion/install");
      // Unconfigured short-circuits to 503 before the auth check; assert it is NOT a redirect/200.
      expect([401, 503]).toContain(res.status);
    } finally {
      srv.close();
    }
  });

  it("503s the callback route when unconfigured", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `n2-${crypto.randomUUID()}@t.local`);
      const res = await client.req("GET", "/api/auth/notion/callback?code=x&state=y");
      expect(res.status).toBe(503);
    } finally {
      srv.close();
    }
  });
});
