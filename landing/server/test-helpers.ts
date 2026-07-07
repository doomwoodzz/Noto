// server/test-helpers.ts
// Shared HTTP clients for integration tests that boot createApp() on port 0.
import type { Server } from "node:http";
import { createApp } from "./app.ts";

const ORIGIN = "http://localhost:5173";

export interface TestServer {
  baseURL: string;
  close: () => void;
}

export async function startTestServer(): Promise<TestServer> {
  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { baseURL: `http://127.0.0.1:${port}`, close: () => server.close() };
}

/** Cookie-jar client mirroring the browser's CSRF/session flow. */
export function makeCookieClient(baseURL: string) {
  const cookies = new Map<string, string>();
  const cookieHeader = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  function absorb(res: Response) {
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  async function req(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<Response> {
    const headers: Record<string, string> = { Origin: ORIGIN, ...extra };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET" && method !== "HEAD") headers["X-CSRF-Token"] = cookies.get("noto_csrf") ?? "";
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

/** PAT client: Authorization bearer, no cookies, no CSRF. */
export function makePatClient(baseURL: string, token: string) {
  async function req(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Origin: ORIGIN, ...extra };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(baseURL + path, {
      method, headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    return res;
  }
  return { req };
}

/**
 * Return an authenticated cookie client. There are no accounts anymore — every
 * client auto-resolves to the single local owner (see auth/localSession.ts).
 * `email` is accepted for call-site compatibility with existing tests but is
 * otherwise unused.
 */
export async function signup(baseURL: string, _email: string) {
  const client = makeCookieClient(baseURL);
  await client.req("GET", "/api/auth/me"); // establishes the session
  return client;
}

/** Mint a PAT through the cookie API and return the plaintext token. */
export async function mintToken(
  client: ReturnType<typeof makeCookieClient>,
  scopes: string[] = ["read", "write"],
  name = "test",
): Promise<string> {
  const res = await client.req("POST", "/api/tokens", { name, scopes });
  if (res.status !== 201) throw new Error(`mint failed: ${res.status}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}
