// STUB — replaced by the real committer in P3 (04-graph-connection.md).
import { setDumpJobStatus } from "../db.ts";
import type { DumpJobRow } from "./types.ts";

export async function commitJob(job: DumpJobRow): Promise<void> {
  setDumpJobStatus(job.id, "done");
}
