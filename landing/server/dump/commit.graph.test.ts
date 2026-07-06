// landing/server/dump/commit.graph.test.ts
//
// A dump commit rebuilds the vault graph ONCE per batch — not once per item.
// The graph is only read after the whole job completes, and rebuildVaultGraph
// scans the entire vault (metadata cache, all edges, clustering) every call, so
// a per-item rebuild is O(N_items × vaultSize) for no benefit. This mocks the
// graph module to count calls and drives a 2-note commit (2 notes + 1 MOC).
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const rebuildSpy = vi.fn(async () => ({ filesProcessed: 0, edgeCount: 0 }));
vi.mock("../graph/build.ts", () => ({
  rebuildVaultGraph: (vaultId: string) => rebuildSpy(vaultId),
  rebuildStaleVaultGraphs: vi.fn(async () => {}),
}));

import { commitJob } from "./commit.ts";
import { __setEnrichComplete, __resetEnrichComplete } from "./enrich.ts";
import {
  createUser, createVault, createDumpJob, getOwnedDumpJob, setDumpJobStatus, insertDumpItem,
} from "../db.ts";
import type { ShapedNote } from "./types.ts";

beforeAll(() => {
  __setEnrichComplete(async () => ({ text: JSON.stringify({ title: "", summary: "s", tags: [], links: [] }), inputTokens: 0, outputTokens: 0 }));
});
afterAll(() => __resetEnrichComplete());

function shaped(title: string): ShapedNote {
  return { notePath: `Dump/src/${title}.md`, title, summary: "s", tags: [], links: [], body: `# ${title}\n\nBody of ${title}.`, origin: { type: "raw" } };
}

describe("dump commit rebuilds the vault graph once per batch", () => {
  it("calls rebuildVaultGraph exactly once for a multi-item job (not once per item)", async () => {
    rebuildSpy.mockClear();
    const u = createUser({ email: `cg-${crypto.randomUUID()}@t.local` });
    const v = createVault(u.id, { name: "V" });
    const job = createDumpJob({ userId: u.id, vaultId: v.id, sourceType: "raw", sourceRef: {}, sourceSlug: "src" });
    setDumpJobStatus(job.id, "committing");

    // Two brand-new notes (no dedup_of → commitNew path) + the MOC = would be 3
    // rebuilds with a per-item call. A single post-batch rebuild is exactly 1.
    insertDumpItem({ jobId: job.id, sourceKey: "raw:one", status: "selected", shaped: JSON.stringify(shaped("One")) });
    insertDumpItem({ jobId: job.id, sourceKey: "raw:two", status: "selected", shaped: JSON.stringify(shaped("Two")) });

    await commitJob(getOwnedDumpJob(u.id, job.id)!);

    expect(rebuildSpy).toHaveBeenCalledTimes(1);
    expect(rebuildSpy).toHaveBeenCalledWith(v.id);
  }, 30000);
});
