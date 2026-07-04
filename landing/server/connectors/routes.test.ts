import { describe, it, expect } from "vitest";
import { startTestServer, signup, mintToken, makePatClient } from "../test-helpers.ts";

describe("/api/connectors", () => {
  it("returns [] for a user with no connectors", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `c-${crypto.randomUUID()}@t.local`);
      const res = await client.req("GET", "/api/connectors");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    } finally {
      srv.close();
    }
  });

  it("lists a saved connector and disconnects it (204)", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `c2-${crypto.randomUUID()}@t.local`);
      // Resolve this user's id, then seed a connector row directly.
      const me = (await (await client.req("GET", "/api/auth/me")).json()) as { user: { id: string } };
      const { saveConnectorToken } = await import("../db.ts");
      saveConnectorToken({ userId: me.user.id, provider: "github", externalAccount: "octocat", installationId: "42", scopes: "contents:read" });

      const list = await client.req("GET", "/api/connectors");
      const rows = (await list.json()) as { provider: string; externalAccount: string | null }[];
      expect(rows.map((r) => r.provider)).toContain("github");
      expect(rows.find((r) => r.provider === "github")?.externalAccount).toBe("octocat");

      const del = await client.req("DELETE", "/api/connectors/github");
      expect(del.status).toBe(204);
      expect(await (await client.req("GET", "/api/connectors")).json()).toEqual([]);
    } finally {
      srv.close();
    }
  });

  it("rejects PAT auth on connectors (cookie-only → 403)", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `c3-${crypto.randomUUID()}@t.local`);
      const token = await mintToken(client, ["read", "write"]);
      const pat = makePatClient(srv.baseURL, token);
      const res = await pat.req("GET", "/api/connectors");
      expect(res.status).toBe(403);
    } finally {
      srv.close();
    }
  });

  it("rejects an unknown provider on DELETE (400)", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `c4-${crypto.randomUUID()}@t.local`);
      const res = await client.req("DELETE", "/api/connectors/dropbox");
      expect(res.status).toBe(400);
    } finally {
      srv.close();
    }
  });
});
