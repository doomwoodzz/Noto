import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, signup, mintToken } from "../test-helpers.ts";
import { __setEnrichComplete, __resetEnrichComplete } from "./enrich.ts";

describe("/api/dump", () => {
  beforeAll(() => {
    // Offline, deterministic enrichment: empty JSON → enrichNote falls back to the
    // heading title with no summary/tags/links. Keeps these tests network-free even
    // when a local .env sets OPENAI_API_KEY.
    __setEnrichComplete(async () => ({ text: "{}", inputTokens: 0, outputTokens: 0 }));
  });
  afterAll(() => __resetEnrichComplete());

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

  it("routes the dump to the vault in the x-noto-vault header, not just the first vault", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `hv-${crypto.randomUUID()}@t.local`);
      const me = (await (await client.req("GET", "/api/auth/me")).json()) as { user: { id: string } };

      // Seed the default vault (GET /api/vaults ensures it), then add a second.
      // The list is ordered oldest-first, so the default stays vaults[0] — the
      // vault the old bug always fell back to. We then dump "into" the second
      // vault, which is what the app signals via the x-noto-vault header.
      await client.req("GET", "/api/vaults");
      const created = (await (await client.req("POST", "/api/vaults", { name: "Second" })).json()) as { vault: { id: string } };
      const secondId = created.vault.id;
      const { vaults } = (await (await client.req("GET", "/api/vaults")).json()) as { vaults: { id: string }[] };
      expect(vaults.length).toBe(2);
      // Guard: the old bug fell back to vaults[0], which must differ from the target.
      expect(vaults[0].id).not.toBe(secondId);

      const res = await client.req(
        "POST",
        "/api/dump",
        { source: { type: "raw", text: "# A\n\nbody" } },
        { "x-noto-vault": secondId },
      );
      expect(res.status).toBe(201);
      const { jobId } = (await res.json()) as { jobId: string };

      const { getOwnedDumpJob } = await import("../db.ts");
      expect(getOwnedDumpJob(me.user.id, jobId)?.vault_id).toBe(secondId);
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

  it("cancelling a queued job does not leak into the cancel set", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `cx-${crypto.randomUUID()}@t.local`);
      const { jobId } = await (await client.req("POST", "/api/dump", { source: { type: "raw", text: "x" } })).json() as { jobId: string };
      // Job is 'queued' (worker interval is not running in tests; only drainOnce advances it).
      const cancel = await client.req("POST", `/api/dump/jobs/${jobId}/cancel`);
      expect(cancel.status).toBe(200);
      const { isCancelled } = await import("./jobs.ts");
      expect(isCancelled(jobId)).toBe(false); // resolved synchronously → never flagged → no leak
      const job = await (await client.req("GET", `/api/dump/jobs/${jobId}`)).json() as { status: string };
      expect(job.status).toBe("cancelled");
    } finally {
      srv.close();
    }
  });

  it("cancelling an in-flight (committing) job flags then reaps via the worker", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `ci-${crypto.randomUUID()}@t.local`);
      const { jobId } = await (await client.req("POST", "/api/dump", { source: { type: "raw", text: "x" } })).json() as { jobId: string };
      const { drainOnce, isCancelled } = await import("./jobs.ts");
      await drainOnce(); // → awaiting_review
      const commit = await client.req("POST", `/api/dump/jobs/${jobId}/commit`, { selectedItemIds: [] });
      expect(commit.status).toBe(202); // status is now 'committing'
      const cancel = await client.req("POST", `/api/dump/jobs/${jobId}/cancel`);
      expect(cancel.status).toBe(200);
      expect(isCancelled(jobId)).toBe(true); // in-flight → flagged, worker not yet run
      await drainOnce();                      // processJob observes the flag → cancels + reaps
      expect(isCancelled(jobId)).toBe(false); // reaped
      const job = await (await client.req("GET", `/api/dump/jobs/${jobId}`)).json() as { status: string };
      expect(job.status).toBe("cancelled");
    } finally {
      srv.close();
    }
  });
});
