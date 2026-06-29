import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../test-helpers.ts";

// CSRF origin pinning. The test env sets APP_ORIGIN=http://localhost:5173, but the
// server actually listens on 127.0.0.1:<port> — so a request whose Origin matches
// the server's own host exercises the same-origin branch (not the APP_ORIGIN match),
// which is exactly what makes deployments like Railway work without APP_ORIGIN set.
let s: TestServer;
beforeAll(async () => { s = await startTestServer(); });
afterAll(() => s.close());

async function post(origin: string) {
  return fetch(s.baseURL + "/api/auth/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "x@example.com", password: "password123" }),
    redirect: "manual",
  });
}

describe("CSRF origin pinning", () => {
  it("allows a same-origin request (Origin host == request Host) past origin pinning", async () => {
    const res = await post(s.baseURL); // baseURL host == the server's Host header
    // Not blocked at the origin gate. It still fails the double-submit token check
    // (no CSRF cookie/header here), so we expect "Invalid CSRF token", NOT "Bad origin".
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid CSRF token");
  });

  it("rejects a cross-site Origin with 'Bad origin'", async () => {
    const res = await post("https://evil.example");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Bad origin");
  });

  it("still allows the configured APP_ORIGIN", async () => {
    const res = await post("http://localhost:5173"); // matches APP_ORIGIN in test env
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid CSRF token");
  });
});
