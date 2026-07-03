import { describe, it, expect } from "vitest";
import { enqueueDump, drainOnce, requestCancel, isCancelled } from "./jobs.ts";
import { getOwnedDumpJob, createUser, createVault } from "../db.ts";

describe("dump worker", () => {
  it("drains a queued job through the stub shaper to awaiting_review", async () => {
    const u = createUser({ email: `w-${crypto.randomUUID()}@t.local` });
    const v = createVault(u.id, { name: "V" });
    const job = enqueueDump({ userId: u.id, vaultId: v.id, sourceType: "raw", sourceRef: { type: "raw", text: "# Hi" }, sourceSlug: "pasted" });
    expect(getOwnedDumpJob(u.id, job.id)?.status).toBe("queued");
    await drainOnce();
    expect(getOwnedDumpJob(u.id, job.id)?.status).toBe("awaiting_review");
  });

  it("cancels a queued job before processing", async () => {
    const u = createUser({ email: `w2-${crypto.randomUUID()}@t.local` });
    const v = createVault(u.id, { name: "V" });
    const job = enqueueDump({ userId: u.id, vaultId: v.id, sourceType: "raw", sourceRef: {}, sourceSlug: "p" });
    requestCancel(job.id);
    await drainOnce();
    expect(getOwnedDumpJob(u.id, job.id)?.status).toBe("cancelled");
    // The cancel flag must be reaped once the worker has handled the job, or the
    // module-global cancel Set leaks an entry per cancelled job for the process life.
    expect(isCancelled(job.id)).toBe(false);
  });
});
