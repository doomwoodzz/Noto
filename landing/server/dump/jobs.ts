import { createDumpJob, claimableDumpJobs, setDumpJobStatus } from "../db.ts";
import type { DumpJobRow } from "./types.ts";
import { shapeJob } from "./shape.ts";
import { commitJob } from "./commit.ts";

const cancels = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;
let draining = false;

export function enqueueDump(input: {
  userId: string; vaultId: string; sourceType: "raw"|"github"|"notion"; sourceRef: unknown; sourceSlug: string;
}): DumpJobRow {
  return createDumpJob(input);
}

export function requestCancel(jobId: string): void {
  cancels.add(jobId);
}
export function isCancelled(jobId: string): boolean {
  return cancels.has(jobId);
}
/** Remove a job id from the cancel set (used when a job is resolved without the worker). */
export function clearCancel(jobId: string): void {
  cancels.delete(jobId);
}

async function processJob(job: DumpJobRow): Promise<void> {
  try {
    if (cancels.has(job.id)) {
      setDumpJobStatus(job.id, "cancelled");
      return;
    }
    if (job.status === "queued") await shapeJob(job);
    else if (job.status === "committing") await commitJob(job);
  } catch (err) {
    setDumpJobStatus(job.id, "failed", err instanceof Error ? err.message : String(err));
  } finally {
    // Always reap the cancel flag once the worker is done with this pass —
    // whether it saw the pre-dispatch flag above OR shapeJob/commitJob observed
    // it at an in-flight checkpoint (which sets a terminal status and returns,
    // so the job never re-enters processJob). Without this, every mid-flight
    // cancel leaks its id into the module-global Set for the process lifetime.
    cancels.delete(job.id);
  }
}

/** Process all currently-claimable jobs once. Exposed for deterministic tests. */
export async function drainOnce(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (const job of claimableDumpJobs(5)) await processJob(job);
  } finally {
    draining = false;
  }
}

/** Start the periodic drain. Idempotent; unref'd so it never blocks process exit. */
export function startDumpWorker(): void {
  if (timer) return;
  timer = setInterval(() => void drainOnce(), 500);
  if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();
}
