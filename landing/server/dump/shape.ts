// STUB — replaced by the real pipeline in P2 (03-shaping-pipeline.md).
import { setDumpJobStatus, setDumpJobCounts, listDumpItems } from "../db.ts";
import type { DumpJobRow, ManifestItem } from "./types.ts";

export async function shapeJob(job: DumpJobRow): Promise<void> {
  setDumpJobStatus(job.id, "shaping");
  setDumpJobCounts(job.id, { fetched: 0, shaped: 0 });
  setDumpJobStatus(job.id, "awaiting_review");
}

export function buildManifest(jobId: string): ManifestItem[] {
  // STUB — real implementation maps dump_items in P2.
  return listDumpItems(jobId).map((i) => ({
    itemId: i.id, title: "", summary: "", tags: [], linkCount: 0,
    notePath: "", redactionCount: i.redaction_count, status: "new" as const,
  }));
}
