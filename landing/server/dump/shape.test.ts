import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, signup } from "../test-helpers.ts";
import { enqueueDump, drainOnce } from "./jobs.ts";
import { getOwnedDumpJob, ensureLocalOwner, createVault } from "../db.ts";
import { __setEnrichComplete, __resetEnrichComplete } from "./enrich.ts";

describe("shapeJob (raw provider integration)", () => {
  beforeAll(() => {
    // Offline, deterministic enrichment: empty JSON → enrichNote falls back to the
    // heading title with no summary/tags/links. Keeps these tests network-free even
    // when a local .env sets OPENAI_API_KEY.
    __setEnrichComplete(async () => ({ text: "{}", inputTokens: 0, outputTokens: 0 }));
  });
  afterAll(() => __resetEnrichComplete());

  it("shapes a raw dump: redacts secrets, splits sections, reaches awaiting_review", async () => {
    const srv = await startTestServer();
    try {
      const client = await signup(srv.baseURL, `shape-${crypto.randomUUID()}@t.local`);

      // A doc with a leaked AWS key and two large ## sections (over the split threshold).
      const big = "lorem ipsum ".repeat(700); // ~8.4k chars per section
      const text = `## Alpha\n\nAKIAIOSFODNN7EXAMPLE\n\n${big}\n\n## Beta\n\n${big}`;
      const create = await client.req("POST", "/api/dump", { source: { type: "raw", text } });
      expect(create.status).toBe(201);
      const { jobId } = (await create.json()) as { jobId: string };

      await drainOnce();

      const poll = await client.req("GET", `/api/dump/jobs/${jobId}`);
      const job = (await poll.json()) as {
        status: string;
        counts: { shaped?: number; redacted?: number };
        manifest?: { title: string; notePath: string; redactionCount: number; status: string }[];
      };

      expect(job.status).toBe("awaiting_review");
      expect(job.manifest).toBeTruthy();
      const manifest = job.manifest!;
      // Two sections → two notes, titled by heading.
      expect(manifest.map((m) => m.title).sort()).toEqual(["Alpha", "Beta"]);
      // The Alpha note carries the redaction.
      const alpha = manifest.find((m) => m.title === "Alpha")!;
      expect(alpha.redactionCount).toBeGreaterThanOrEqual(1);
      expect(alpha.notePath.startsWith("Dump/")).toBe(true);
      expect(alpha.notePath.endsWith(".md")).toBe(true);
      expect(alpha.status).toBe("new");
      expect(job.counts.redacted).toBeGreaterThanOrEqual(1);
      expect(job.counts.shaped).toBe(2);

      // The staged shaped body has the secret redacted (never stored in cleartext).
      const { db } = await import("../db.ts");
      const rows = db.prepare("SELECT shaped FROM dump_items WHERE job_id = ?").all(jobId) as { shaped: string | null }[];
      const allShaped = rows.map((r) => r.shaped ?? "").join("\n");
      expect(allShaped).toContain("‹redacted:aws-access-key›");
      expect(allShaped).not.toContain("AKIAIOSFODNN7EXAMPLE");
    } finally {
      srv.close();
    }
  });

  it("marks a job failed when the shaper throws (unavailable provider)", async () => {
    const u = ensureLocalOwner();
    const v = createVault(u.id, { name: "V" });
    const job = enqueueDump({ userId: u.id, vaultId: v.id, sourceType: "github", sourceRef: { type: "github", repo: "o/r" }, sourceSlug: "o-r" });
    // Drain until this job leaves the queue (claimableDumpJobs is LIMIT-bounded, so a
    // single drain may not reach it if other queued jobs exist).
    for (let i = 0; i < 5 && getOwnedDumpJob(u.id, job.id)!.status === "queued"; i++) {
      await drainOnce();
    }
    const row = getOwnedDumpJob(u.id, job.id)!;
    expect(row.status).toBe("failed");
    expect(row.error).toBeTruthy();
  });
});
