import { describe, it, expect } from "vitest";
import { startTestServer, signup, mintToken } from "../test-helpers.ts";

describe("/api/dump", () => {
  it("creates a raw job, polls to awaiting_review (stub), commits to done", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `d-${crypto.randomUUID()}@t.local`);
      const create = await client.req("POST", "/api/dump", { source: { type: "raw", text: "# A\n\nbody" } });
      expect(create.status).toBe(201);
      const { jobId } = (await create.json()) as { jobId: string };

      const { drainOnce } = await import("./jobs.ts");
      await drainOnce();

      const poll = await client.req("GET", `/api/dump/jobs/${jobId}`);
      const job = (await poll.json()) as { status: string; manifest?: unknown[] };
      expect(job.status).toBe("awaiting_review");

      const commit = await client.req("POST", `/api/dump/jobs/${jobId}/commit`, { selectedItemIds: [] });
      expect(commit.status).toBe(202);
      await drainOnce();
      const done = await (await client.req("GET", `/api/dump/jobs/${jobId}`)).json() as { status: string };
      expect(done.status).toBe("done");
    } finally {
      srv.close();
    }
  });

  it("rejects PAT auth (cookie-only)", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `p-${crypto.randomUUID()}@t.local`);
      const token = await mintToken(client, ["read", "write"]);
      const { makePatClient } = await import("../test-helpers.ts");
      const pat = makePatClient(srv.baseURL, token);
      const res = await pat.req("POST", "/api/dump", { source: { type: "raw", text: "x" } });
      expect(res.status).toBe(403);
    } finally {
      srv.close();
    }
  });

  it("404s another user's job", async () => {
    const srv = await startTestServer();
    try {
      const a = await signup(srv.baseURL, `a-${crypto.randomUUID()}@t.local`);
      const b = await signup(srv.baseURL, `b-${crypto.randomUUID()}@t.local`);
      const { jobId } = await (await a.req("POST", "/api/dump", { source: { type: "raw", text: "x" } })).json() as { jobId: string };
      const res = await b.req("GET", `/api/dump/jobs/${jobId}`);
      expect(res.status).toBe(404);
    } finally {
      srv.close();
    }
  });
});
