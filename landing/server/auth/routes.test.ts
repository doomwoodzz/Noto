// Integration tests for the local-first auth API: no accounts, no login — every
// request is transparently attached to the single local-owner user.
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

describe("auth API — local-first, no accounts", () => {
  it("auto-provisions a session-backed local owner on the first request", async () => {
    const c = makeClient();
    const me = await c.req("GET", "/api/auth/me");
    expect(me.status).toBe(200);
    const { user } = await me.json();
    expect(user.id).toBeTruthy();
    expect(c.cookies.has("noto_session")).toBe(true);
  });

  it("gives the local owner a working, Welcome-seeded vault", async () => {
    const c = makeClient();
    await c.req("GET", "/api/auth/me"); // establishes the session

    const { vaults } = await (await c.req("GET", "/api/vaults")).json();
    expect(vaults).toHaveLength(1);
    const { files } = await (await c.req("GET", `/api/vaults/${vaults[0].id}/files`)).json();
    expect(files.map((f: { title: string }) => f.title)).toContain("Welcome");
  });

  it("resolves two different browsers/clients to the same local owner", async () => {
    const a = makeClient();
    const aUser = (await (await a.req("GET", "/api/auth/me")).json()).user;

    const b = makeClient();
    const bUser = (await (await b.req("GET", "/api/auth/me")).json()).user;

    // Different session cookies (each client got its own session)...
    expect(a.cookies.get("noto_session")).not.toBe(b.cookies.get("noto_session"));
    // ...but the same underlying local-owner user, since there is only one.
    expect(aUser.id).toBe(bUser.id);
  });

  it("updates the local owner's theme preference", async () => {
    const c = makeClient();
    await c.req("GET", "/api/auth/me");
    const res = await c.req("PATCH", "/api/auth/preferences", { theme: "dark" });
    expect(res.status).toBe(200);
    const me = await (await c.req("GET", "/api/auth/me")).json();
    expect(me.user.theme).toBe("dark");
  });
});
