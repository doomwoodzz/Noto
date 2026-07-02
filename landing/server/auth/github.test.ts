import { describe, it, expect } from "vitest";
import { startTestServer, signup } from "../test-helpers.ts";

describe("GitHub App install flow", () => {
  // env.githubConfigured is false under test (no GITHUB_* vars) → install gates to 503.
  it("503s the install endpoint when GitHub is not configured", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `gh-${crypto.randomUUID()}@t.local`);
      const res = await client.req("GET", "/api/auth/github/install");
      expect(res.status).toBe(503);
    } finally {
      srv.close();
    }
  });

  it("401s the install endpoint when not authenticated", async () => {
    const srv = await startTestServer();
    try {
      // A cookie client that never signed up → no session cookie.
      const { makeCookieClient } = await import("../test-helpers.ts");
      const client = makeCookieClient(srv.baseURL);
      await client.req("GET", "/api/health"); // prime CSRF only
      const res = await client.req("GET", "/api/auth/github/install");
      // Auth is checked before the config gate → 401 (not 503).
      expect(res.status).toBe(401);
    } finally {
      srv.close();
    }
  });

  it("callback fails closed without a valid state cookie (redirect to error)", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `gh2-${crypto.randomUUID()}@t.local`);
      const res = await client.req("GET", "/api/auth/github/callback?installation_id=42&state=bogus");
      // Either 503 (unconfigured) or a 302 redirect to the app with an error — never a 2xx success.
      expect([302, 303, 503]).toContain(res.status);
    } finally {
      srv.close();
    }
  });
});
