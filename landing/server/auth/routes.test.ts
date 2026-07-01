// Integration tests for the auth API guest path: skipping sign-in still yields
// a real, isolated, session-backed account.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../app.ts";

const ORIGIN = "http://localhost:5173";

let server: Server;
let baseURL = "";

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseURL = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

/** A tiny cookie-jar HTTP client mirroring the browser's CSRF/session flow. */
function makeClient() {
  const cookies = new Map<string, string>();

  function cookieHeader(): string {
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  function absorb(res: Response): void {
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  async function req(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Origin: ORIGIN };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET" && method !== "HEAD") {
      headers["X-CSRF-Token"] = cookies.get("noto_csrf") ?? "";
    }
    if (cookies.size > 0) headers["Cookie"] = cookieHeader();
    const res = await fetch(baseURL + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    absorb(res);
    return res;
  }

  return { req, cookies };
}

describe("auth API — guest sign-in skip", () => {
  it("mints a session-backed guest account that /me recognises", async () => {
    const c = makeClient();
    await c.req("GET", "/api/health"); // prime CSRF cookie

    const res = await c.req("POST", "/api/auth/guest");
    expect(res.status).toBe(201);
    const { user } = await res.json();
    expect(user.id).toBeTruthy();
    expect(user.displayName).toBe("Guest");
    expect(c.cookies.has("noto_session")).toBe(true);

    const me = await c.req("GET", "/api/auth/me");
    expect(me.status).toBe(200);
    const meBody = await me.json();
    expect(meBody.user.id).toBe(user.id);
  });

  it("gives the guest a working, Welcome-seeded vault", async () => {
    const c = makeClient();
    await c.req("GET", "/api/health");
    await c.req("POST", "/api/auth/guest");

    const { vaults } = await (await c.req("GET", "/api/vaults")).json();
    expect(vaults).toHaveLength(1);
    const { files } = await (await c.req("GET", `/api/vaults/${vaults[0].id}/files`)).json();
    expect(files.map((f: { title: string }) => f.title)).toContain("Welcome");
  });

  it("isolates two guests from each other", async () => {
    const a = makeClient();
    await a.req("GET", "/api/health");
    const aUser = (await (await a.req("POST", "/api/auth/guest")).json()).user;

    const b = makeClient();
    await b.req("GET", "/api/health");
    const bUser = (await (await b.req("POST", "/api/auth/guest")).json()).user;

    expect(aUser.id).not.toBe(bUser.id);
    expect(aUser.email).not.toBe(bUser.email);
  });
});
