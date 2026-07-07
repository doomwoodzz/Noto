import { describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../app.ts";

let server: Server;
let baseURL = "";

async function withApp<T>(fn: (baseURL: string) => Promise<T>): Promise<T> {
  const app = createApp();
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseURL = `http://127.0.0.1:${port}`;
  try {
    return await fn(baseURL);
  } finally {
    server.close();
  }
}

describe("local session auto-provisioning", () => {
  it("attaches a session to a completely fresh request with no cookies", async () => {
    await withApp(async (url) => {
      const res = await fetch(`${url}/api/auth/me`, {
        headers: { Origin: "http://localhost:5173" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: { id: string } | null };
      expect(body.user?.id).toBeTruthy();
      expect(res.headers.getSetCookie().some((c) => c.startsWith("noto_session="))).toBe(true);
    });
  });

  it("resolves two different cookie-less clients to the same local owner", async () => {
    await withApp(async (url) => {
      const a = (await (await fetch(`${url}/api/auth/me`, { headers: { Origin: "http://localhost:5173" } })).json()) as {
        user: { id: string } | null;
      };
      const b = (await (await fetch(`${url}/api/auth/me`, { headers: { Origin: "http://localhost:5173" } })).json()) as {
        user: { id: string } | null;
      };
      expect(a.user?.id).toBe(b.user?.id);
    });
  });
});
