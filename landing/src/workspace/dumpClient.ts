// The Dump surface the workspace renders against — mirrors the AIClient /
// McpClient DI pattern. The authenticated app injects `realDumpClient` (see
// src/app/dumpClient.ts); the marketing demo OMITS the client entirely so the
// preview never reaches Dump's real backend (zero API cost, no connector calls).

import type {
  PublicDumpJob,
  DumpStatus,
  DumpSource,
  ConnectorInfo,
  GithubRepoOption,
  NotionPageOption,
} from "./dumpTypes.ts";

export type { PublicDumpJob, ManifestItem, DumpCounts, DumpStatus, DumpSource, ConnectorInfo, GithubRepoOption, NotionPageOption } from "./dumpTypes.ts";

export interface DumpClient {
  /** Create a job from a source selector. Returns the durable job id. */
  start(source: DumpSource): Promise<{ jobId: string }>;
  /** Poll the job's current public state (status + counts + manifest at review). */
  poll(jobId: string): Promise<PublicDumpJob>;
  /** Approve the selected items (optionally per-item overwrite/skip) and begin committing. */
  commit(jobId: string, selectedItemIds: string[], updates?: Record<string, "overwrite" | "skip">): Promise<void>;
  /** Cancel a running or awaiting-review job. */
  cancel(jobId: string): Promise<void>;
  /** Delete a job; `purgeNotes` also removes the notes it created. */
  remove(jobId: string, purgeNotes: boolean): Promise<void>;
  /** Repos visible to the user's GitHub App installation(s). */
  githubRepos(): Promise<GithubRepoOption[]>;
  /** Pages/databases granted to the Notion integration. */
  notionPages(): Promise<NotionPageOption[]>;
  /** Currently-linked connectors (github/notion) with their external account. */
  connectors(): Promise<ConnectorInfo[]>;
  /** Forget a connector token (and offer to purge its notes elsewhere). */
  disconnect(provider: string): Promise<void>;
}

/* --------------------- pure mock poll state machine --------------------- */

/**
 * The mock's poll transition. PURE + deterministic (no timers, no randomness)
 * so it is unit-tested. `awaiting_review` and the terminal states are fixpoints
 * — `awaiting_review` only advances when the client calls `commit`.
 */
export function nextMockPhase(prev: DumpStatus): DumpStatus {
  switch (prev) {
    case "queued": return "fetching";
    case "fetching": return "shaping";
    case "shaping": return "awaiting_review";
    case "committing": return "done";
    default: return prev; // awaiting_review, done, failed, cancelled
  }
}

/* ------------------------------ demo mock ------------------------------- */

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const DEMO_MANIFEST: PublicDumpJob["manifest"] = [
  {
    itemId: "mock-1",
    title: "Photosynthesis Overview",
    summary: "Light-dependent reactions feed the Calvin cycle to build glucose.",
    tags: ["biology", "energy"],
    linkCount: 3,
    notePath: "Dump/Pasted Notes/Photosynthesis Overview.md",
    redactionCount: 0,
    status: "new",
  },
  {
    itemId: "mock-2",
    title: "Chloroplast Structure",
    summary: "Thylakoid stacks and stroma host the two stages of photosynthesis.",
    tags: ["biology", "cells"],
    linkCount: 2,
    notePath: "Dump/Pasted Notes/Chloroplast Structure.md",
    redactionCount: 1,
    status: "new",
  },
  {
    itemId: "mock-3",
    title: "Calvin Cycle",
    summary: "Carbon fixation stage that turns CO₂ into sugar.",
    tags: ["biology"],
    linkCount: 1,
    notePath: "Dump/Pasted Notes/Calvin Cycle.md",
    redactionCount: 0,
    status: "duplicate",
    dedupOf: "existing-file",
  },
];

// One in-memory job per mock id, advanced by nextMockPhase on each poll.
const mockJobs = new Map<string, { status: DumpStatus }>();

function countsFor(status: DumpStatus): PublicDumpJob["counts"] {
  switch (status) {
    case "fetching": return { fetched: 2, totalAvailable: 3 };
    case "shaping": return { fetched: 3, shaped: 1 };
    case "awaiting_review": return { fetched: 3, shaped: 3, redacted: 1, duplicates: 1 };
    case "committing": return { fetched: 3, shaped: 3, committed: 1 };
    case "done": return { fetched: 3, shaped: 3, committed: 2, duplicates: 1 };
    default: return {};
  }
}

/** Scripted, zero-cost client for the marketing demo (never used in production). */
export const mockDumpClient: DumpClient = {
  async start() {
    await delay(300);
    const jobId = `mock-job-${Date.now()}`;
    mockJobs.set(jobId, { status: "queued" });
    return { jobId };
  },
  async poll(jobId) {
    await delay(250);
    const job = mockJobs.get(jobId) ?? { status: "awaiting_review" as DumpStatus };
    job.status = nextMockPhase(job.status);
    mockJobs.set(jobId, job);
    const out: PublicDumpJob = {
      id: jobId,
      sourceType: "raw",
      status: job.status,
      counts: countsFor(job.status),
      error: null,
    };
    if (job.status === "awaiting_review") out.manifest = DEMO_MANIFEST;
    return out;
  },
  async commit(jobId) {
    await delay(250);
    const job = mockJobs.get(jobId);
    if (job) { job.status = "committing"; mockJobs.set(jobId, job); }
  },
  async cancel(jobId) {
    await delay(150);
    const job = mockJobs.get(jobId);
    if (job) { job.status = "cancelled"; mockJobs.set(jobId, job); }
  },
  async remove(jobId) {
    await delay(150);
    mockJobs.delete(jobId);
  },
  async githubRepos() {
    await delay(300);
    return [
      { fullName: "octocat/Hello-World", defaultBranch: "main" },
      { fullName: "octocat/Spoon-Knife", defaultBranch: "main" },
    ];
  },
  async notionPages() {
    await delay(300);
    return [
      { id: "mock-page-1", title: "Engineering Wiki", type: "page" },
      { id: "mock-page-2", title: "Roadmap", type: "database" },
    ];
  },
  async connectors() {
    await delay(150);
    return [];
  },
  async disconnect() {
    await delay(150);
  },
};
