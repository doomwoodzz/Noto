# P6 — UI & Client

> Read `00-global-constraints.md` (especially **§16 Client DI pattern**) and `overview.md`'s "Shared interfaces" first. This phase builds the client surface: the `DumpClient` DI seam (interface + `mockDumpClient` + `realDumpClient`), the `api.dump.*` section, the `DumpModal` (tabs / progress / manifest), the `ConnectorsSettings` panel, and all `NotoWindow`/`Sidebar`/`CommandPalette`/`NotoWorkspace` wiring. It depends on the route shapes locked in P1 (`02-job-orchestration.md`) and the types in P0 (`01-data-model.md`).
>
> **CRITICAL CONSTRAINT (00 §16): there is NO React component-test harness.** `vitest` runs `environment: "node"` and the repo has **zero `.test.tsx` files**. So this phase **TDDs only the PURE helpers** (`nextMockPhase`, `manifestToRows`, `countsLabel`) — failing test → impl → passing test → commit. **Components are verified with `cd landing && npm run build`** (`tsc -b` + `vite build`, must exit 0) and a manual preview pass — **never invent a component test**. Do not create any `*.test.tsx`.
>
> **Client cannot import server code at runtime.** `server/dump/types.ts` is server-side; the client gets a **parallel** type module `src/workspace/dumpTypes.ts` that mirrors P0's `PublicDumpJob` / `ManifestItem` / `DumpCounts` exactly. (Type-only imports across the boundary still type-check — e.g. `provenance.ts` imports `../../server/dump/types.ts` as types-only — but for client values + the DI contract we keep a clean parallel module so the client never reaches into `server/`.)

**Files (whole phase):**
- Create: `landing/src/workspace/dumpTypes.ts`
- Create: `landing/src/workspace/dumpClient.ts` (interface + `mockDumpClient`)
- Create: `landing/src/workspace/dumpClient.test.ts` (PURE reducer test only)
- Create: `landing/src/workspace/dumpView.ts` (PURE view helpers)
- Create: `landing/src/workspace/dumpView.test.ts`
- Create: `landing/src/app/dumpClient.ts` (`realDumpClient`)
- Create: `landing/src/workspace/DumpModal.tsx`
- Create: `landing/src/workspace/ConnectorsSettings.tsx`
- Create: `landing/src/styles/dump.css`
- Modify: `landing/src/app/api.ts` (add `api.dump`)
- Modify: `landing/src/workspace/NotoWindow.tsx` (prop + state + gating + dispatch)
- Modify: `landing/src/workspace/CommandPalette.tsx` (`open-dump` command)
- Modify: `landing/src/workspace/Sidebar.tsx` (`onOpenDump` footer button)
- Modify: `landing/src/app/NotoWorkspace.tsx` (inject `realDumpClient`)
- (NotoApp.tsx is intentionally **not** modified — the demo omits `dumpClient`.)

---

## Task 1: Client types + `DumpClient` interface + `mockDumpClient` (TDD the pure reducer)

The client mirrors `aiClient.ts` / `mcpClient.ts`: a surface-agnostic interface plus a scripted, zero-network mock for the marketing demo. The mock's poll state machine is driven by a **pure** reducer `nextMockPhase(prev)` — that is the only thing TDD'd here.

**Files:**
- Create: `landing/src/workspace/dumpTypes.ts`
- Create: `landing/src/workspace/dumpClient.ts`
- Test: `landing/src/workspace/dumpClient.test.ts`

- [ ] **Step 1: Write the parallel client types** — `landing/src/workspace/dumpTypes.ts`

(Pure types — verified by build, no runtime test. Mirrors P0 `server/dump/types.ts` `DumpStatus` / `DumpCounts` / `ManifestItem` / `PublicDumpJob` exactly; the client never imports the server module.)
```typescript
// Client-side mirror of the server Dump wire types (server/dump/types.ts).
// Kept parallel so the client never imports server code at runtime.

export type DumpStatus =
  | "queued" | "fetching" | "shaping" | "awaiting_review" | "committing" | "done" | "failed" | "cancelled";

export interface DumpCounts {
  fetched?: number;
  shaped?: number;
  redacted?: number;
  duplicates?: number;
  updates?: number;
  committed?: number;
  failed?: number;
  overCap?: number;
  totalAvailable?: number;
}

export interface ManifestItem {
  itemId: string;
  title: string;
  summary: string;
  tags: string[];
  linkCount: number;
  notePath: string;
  redactionCount: number;
  status: "new" | "update" | "duplicate" | "skipped";
  dedupOf?: string;
}

export interface PublicDumpJob {
  id: string;
  sourceType: "raw" | "github" | "notion";
  status: DumpStatus;
  counts: DumpCounts;
  error: string | null;
  manifest?: ManifestItem[];
}

/** A source selector the client sends to POST /api/dump. */
export type DumpSource =
  | { type: "raw"; text?: string; files?: { name: string; content: string }[] }
  | { type: "github"; repo: string; includeIssues?: boolean; glob?: string }
  | { type: "notion"; pageIds: string[] };

/** A linked connector as reported by GET /api/connectors. */
export interface ConnectorInfo {
  provider: string;
  externalAccount: string | null;
}

export interface GithubRepoOption {
  fullName: string;
  defaultBranch: string;
}

export interface NotionPageOption {
  id: string;
  title: string;
  type: string;
}
```

- [ ] **Step 2: Write the failing test** — `landing/src/workspace/dumpClient.test.ts`

(Only the PURE reducer is tested. Never test the mock's timers or the React components.)
```typescript
import { describe, it, expect } from "vitest";
import { nextMockPhase } from "./dumpClient.ts";

describe("nextMockPhase (mock poll state machine)", () => {
  it("walks queued → fetching → shaping → awaiting_review and then holds", () => {
    expect(nextMockPhase("queued")).toBe("fetching");
    expect(nextMockPhase("fetching")).toBe("shaping");
    expect(nextMockPhase("shaping")).toBe("awaiting_review");
    // awaiting_review is a hold state — it only advances on commit, never on poll.
    expect(nextMockPhase("awaiting_review")).toBe("awaiting_review");
  });

  it("walks committing → done and then holds on the terminal state", () => {
    expect(nextMockPhase("committing")).toBe("done");
    expect(nextMockPhase("done")).toBe("done");
  });

  it("treats terminal/side states as fixpoints", () => {
    expect(nextMockPhase("failed")).toBe("failed");
    expect(nextMockPhase("cancelled")).toBe("cancelled");
  });
});
```

- [ ] **Step 3: Run to verify failure** — `cd landing && npx vitest run src/workspace/dumpClient.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `dumpClient.ts`** — `landing/src/workspace/dumpClient.ts`

```typescript
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
```

- [ ] **Step 5: Run the reducer test to verify it passes** — `cd landing && npx vitest run src/workspace/dumpClient.test.ts` → PASS.

- [ ] **Step 6: Build + commit**
```bash
cd landing && npm run build   # expected: exits 0
git add src/workspace/dumpTypes.ts src/workspace/dumpClient.ts src/workspace/dumpClient.test.ts
git commit -m "feat(dump): DumpClient interface + mock (pure poll reducer TDD'd)"
```

---

## Task 2: `api.dump.*` section + `realDumpClient`

Add a `dump` section to `api` using the existing `request()` (auto CSRF, `credentials:"include"`, `x-noto-vault` header) and a thin `realDumpClient` wrapping it. File **upload** is JSON-encoded `{name,content}` (text only — no multipart), exactly as the route's `rawSource` zod schema expects.

**Files:**
- Modify: `landing/src/app/api.ts`
- Create: `landing/src/app/dumpClient.ts`

- [ ] **Step 1: Add the `api.dump` section to `api.ts`**

At the top of `landing/src/app/api.ts`, add the type-only import next to the other client-type imports (`import type { ActivityEntry, RevertOutcome } ...`):
```typescript
import type {
  PublicDumpJob,
  DumpSource,
  ConnectorInfo,
  GithubRepoOption,
  NotionPageOption,
} from "../workspace/dumpTypes";
```

Inside the exported `api` object, add a `dump` section immediately after the `activity: { ... },` block (and before `/* notes */`):
```typescript
  /* dump (bulk ingest → atomic notes; cookie-session only, never PAT) */
  dump: {
    start: (source: DumpSource) =>
      request<{ jobId: string }>("POST", "/api/dump", { source }),
    poll: (jobId: string) =>
      request<PublicDumpJob>("GET", `/api/dump/jobs/${jobId}`),
    commit: (
      jobId: string,
      selectedItemIds: string[],
      updates?: Record<string, "overwrite" | "skip">,
    ) =>
      request<{ ok: true }>("POST", `/api/dump/jobs/${jobId}/commit`, {
        selectedItemIds,
        ...(updates ? { updates } : {}),
      }),
    cancel: (jobId: string) =>
      request<{ ok: true }>("POST", `/api/dump/jobs/${jobId}/cancel`),
    remove: (jobId: string, purgeNotes: boolean) =>
      request<void>("DELETE", `/api/dump/jobs/${jobId}${purgeNotes ? "?purgeNotes=1" : ""}`),
    githubRepos: () =>
      request<{ repos: GithubRepoOption[] }>("GET", "/api/dump/github/repos"),
    notionPages: () =>
      request<{ pages: NotionPageOption[] }>("GET", "/api/dump/notion/pages"),
    connectors: () =>
      request<{ connectors: ConnectorInfo[] }>("GET", "/api/connectors"),
    disconnect: (provider: string) =>
      request<void>("DELETE", `/api/connectors/${provider}`),
  },
```

> The `request()` helper already JSON-encodes the body, so an uploaded file's `{ name, content }` text rides along inside `source.files` — no multipart, matching the P1 `rawSource` schema (`files: z.array(z.object({ name, content })).max(50)`). `githubRepos`/`notionPages`/`connectors` shapes match P4/P5/connector routes (`{repos}`/`{pages}`/`{connectors}`).

- [ ] **Step 2: Implement `realDumpClient`** — `landing/src/app/dumpClient.ts`

```typescript
import { api } from "./api";
import type { DumpClient } from "../workspace/dumpClient";

export const realDumpClient: DumpClient = {
  async start(source) {
    return api.dump.start(source);
  },
  async poll(jobId) {
    return api.dump.poll(jobId);
  },
  async commit(jobId, selectedItemIds, updates) {
    await api.dump.commit(jobId, selectedItemIds, updates);
  },
  async cancel(jobId) {
    await api.dump.cancel(jobId);
  },
  async remove(jobId, purgeNotes) {
    await api.dump.remove(jobId, purgeNotes);
  },
  async githubRepos() {
    return (await api.dump.githubRepos()).repos;
  },
  async notionPages() {
    return (await api.dump.notionPages()).pages;
  },
  async connectors() {
    return (await api.dump.connectors()).connectors;
  },
  async disconnect(provider) {
    await api.dump.disconnect(provider);
  },
};
```

- [ ] **Step 3: Build + commit**
```bash
cd landing && npm run build   # expected: exits 0
git add src/app/api.ts src/app/dumpClient.ts
git commit -m "feat(dump): api.dump section + realDumpClient adapter"
```

---

## Task 3: Pure view helpers (`dumpView.ts`) — TDD

Extract the non-trivial mapping the `DumpModal` needs (manifest → renderable rows, counts → progress label) as PURE functions and unit-test them. The modal then stays a thin renderer over these.

**Files:**
- Create: `landing/src/workspace/dumpView.ts`
- Test: `landing/src/workspace/dumpView.test.ts`

- [ ] **Step 1: Write the failing test** — `landing/src/workspace/dumpView.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { manifestToRows, countsLabel, selectableItemIds, phaseLabel } from "./dumpView.ts";
import type { ManifestItem, DumpCounts } from "./dumpTypes.ts";

const items: ManifestItem[] = [
  { itemId: "a", title: "Alpha", summary: "s", tags: ["x"], linkCount: 2, notePath: "Dump/s/Alpha.md", redactionCount: 1, status: "new" },
  { itemId: "b", title: "Beta", summary: "", tags: [], linkCount: 0, notePath: "Dump/s/Beta.md", redactionCount: 0, status: "duplicate", dedupOf: "f1" },
  { itemId: "c", title: "Gamma", summary: "g", tags: [], linkCount: 1, notePath: "Dump/s/Gamma.md", redactionCount: 0, status: "update", dedupOf: "f2" },
];

describe("manifestToRows", () => {
  it("flags redactions and maps a badge per status", () => {
    const rows = manifestToRows(items);
    expect(rows[0].redacted).toBe(true);
    expect(rows[0].badge).toBeNull();           // "new" has no badge
    expect(rows[1].badge).toBe("Duplicate");
    expect(rows[2].badge).toBe("Update");
    expect(rows[1].redacted).toBe(false);
  });
  it("defaults selection: new + update selected, duplicate deselected", () => {
    const rows = manifestToRows(items);
    expect(rows.find((r) => r.itemId === "a")!.defaultSelected).toBe(true);
    expect(rows.find((r) => r.itemId === "c")!.defaultSelected).toBe(true);
    expect(rows.find((r) => r.itemId === "b")!.defaultSelected).toBe(false);
  });
});

describe("selectableItemIds", () => {
  it("returns only non-duplicate ids (the ones a user can commit)", () => {
    expect(selectableItemIds(items).sort()).toEqual(["a", "c"]);
  });
});

describe("countsLabel", () => {
  it("summarizes the progress counters compactly", () => {
    const c: DumpCounts = { fetched: 5, shaped: 3, redacted: 2 };
    expect(countsLabel(c)).toContain("5 fetched");
    expect(countsLabel(c)).toContain("3 shaped");
    expect(countsLabel(c)).toContain("2 redacted");
  });
  it("renders an em dash when there is nothing to report", () => {
    expect(countsLabel({})).toBe("—");
  });
});

describe("phaseLabel", () => {
  it("maps a status to human copy", () => {
    expect(phaseLabel("fetching")).toBe("Fetching…");
    expect(phaseLabel("awaiting_review")).toBe("Ready to review");
    expect(phaseLabel("done")).toBe("Done");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd landing && npx vitest run src/workspace/dumpView.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `dumpView.ts`** — `landing/src/workspace/dumpView.ts`

```typescript
// PURE view helpers for DumpModal. No React, no timers, no I/O — unit-tested.
import type { ManifestItem, DumpCounts, DumpStatus } from "./dumpTypes.ts";

export interface ManifestRow {
  itemId: string;
  title: string;
  summary: string;
  tags: string[];
  linkCount: number;
  notePath: string;
  redacted: boolean;
  redactionCount: number;
  badge: "Duplicate" | "Update" | null;
  /** Whether this row starts checked in the review list. */
  defaultSelected: boolean;
  /** Duplicates cannot be committed (already imported, unchanged). */
  disabled: boolean;
}

const BADGE: Record<ManifestItem["status"], "Duplicate" | "Update" | null> = {
  new: null,
  update: "Update",
  duplicate: "Duplicate",
  skipped: null,
};

export function manifestToRows(manifest: ManifestItem[]): ManifestRow[] {
  return manifest.map((m) => ({
    itemId: m.itemId,
    title: m.title,
    summary: m.summary,
    tags: m.tags,
    linkCount: m.linkCount,
    notePath: m.notePath,
    redacted: m.redactionCount > 0,
    redactionCount: m.redactionCount,
    badge: BADGE[m.status],
    defaultSelected: m.status === "new" || m.status === "update",
    disabled: m.status === "duplicate" || m.status === "skipped",
  }));
}

/** Ids a user may select to commit (everything that isn't a hard duplicate/skip). */
export function selectableItemIds(manifest: ManifestItem[]): string[] {
  return manifest.filter((m) => m.status === "new" || m.status === "update").map((m) => m.itemId);
}

const COUNT_ORDER: { key: keyof DumpCounts; label: string }[] = [
  { key: "fetched", label: "fetched" },
  { key: "shaped", label: "shaped" },
  { key: "redacted", label: "redacted" },
  { key: "duplicates", label: "duplicates" },
  { key: "updates", label: "updates" },
  { key: "committed", label: "committed" },
  { key: "failed", label: "failed" },
];

export function countsLabel(counts: DumpCounts): string {
  const parts: string[] = [];
  for (const { key, label } of COUNT_ORDER) {
    const v = counts[key];
    if (typeof v === "number" && v > 0) parts.push(`${v} ${label}`);
  }
  return parts.length ? parts.join(" · ") : "—";
}

const PHASE: Record<DumpStatus, string> = {
  queued: "Queued…",
  fetching: "Fetching…",
  shaping: "Shaping notes…",
  awaiting_review: "Ready to review",
  committing: "Creating notes…",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function phaseLabel(status: DumpStatus): string {
  return PHASE[status];
}
```

- [ ] **Step 4: Run to verify it passes** — `cd landing && npx vitest run src/workspace/dumpView.test.ts` → PASS.

- [ ] **Step 5: Build + commit**
```bash
cd landing && npm run build   # expected: exits 0
git add src/workspace/dumpView.ts src/workspace/dumpView.test.ts
git commit -m "feat(dump): pure DumpModal view helpers (manifest rows / counts label)"
```

---

## Task 4: `DumpModal` component (build-verified, no component test)

The modal mirrors `McpSettings`'s structure/classes (`nw-menu-scrim` + a panel `role="dialog"`, Escape-to-close). Tabs **Paste / Upload / GitHub / Notion**; on **Start** it calls `dumpClient.start`, then enters a **polling loop** (`setInterval` ~1s → `poll`) rendering phase + counts. At `awaiting_review` it renders the manifest (via `manifestToRows`) with deselect checkboxes + **Create N notes** → `commit` → polls to `done` → toast + close. The modal can be closed while running (the job is durable). **No `.test.tsx` — verify with `npm run build`.**

**Files:**
- Create: `landing/src/workspace/DumpModal.tsx`
- Create: `landing/src/styles/dump.css`

- [ ] **Step 1: Write the stylesheet** — `landing/src/styles/dump.css`

(Reuses workspace CSS variables `--nw-*`; mirrors the MCP panel sizing. Plain, dependency-free CSS.)
```css
/* Dump modal + connectors panel. Mirrors the MCP panel (.nw-mcp-panel). */
.nw-dump-panel {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 50; width: min(680px, calc(100vw - 32px)); max-height: calc(100vh - 64px);
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--nw-surface, #fff); color: var(--nw-ink, #1a1f2b);
  border: 1px solid var(--nw-border, rgba(127, 140, 170, 0.22));
  border-radius: 14px; box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28);
}
.nw-dump-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px 10px; }
.nw-dump-head h2 { font-size: 16px; margin: 0; }
.nw-dump-x { background: none; border: 0; font-size: 22px; cursor: pointer; color: var(--nw-muted, #7f8caa); }
.nw-dump-x:hover { background: rgba(127, 140, 170, 0.12); color: var(--nw-ink, #1a1f2b); border-radius: 6px; }

.nw-dump-tabs { display: flex; gap: 4px; padding: 0 18px; border-bottom: 1px solid var(--nw-border, rgba(127, 140, 170, 0.18)); }
.nw-dump-tab { background: none; border: 0; padding: 8px 12px; cursor: pointer; font-size: 13px;
  color: var(--nw-muted, #7f8caa); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.nw-dump-tab.is-active { color: var(--nw-ink, #1a1f2b); border-bottom-color: var(--nw-accent, #6366f1); }

.nw-dump-body { padding: 16px 18px; overflow: auto; }
.nw-dump-textarea { width: 100%; min-height: 200px; resize: vertical; font: inherit; padding: 10px 12px;
  border: 1px solid var(--nw-border, rgba(127, 140, 170, 0.3)); border-radius: 10px; background: transparent; color: inherit; }
.nw-dump-drop { border: 1px dashed var(--nw-border, rgba(127, 140, 170, 0.4)); border-radius: 10px; padding: 18px; text-align: center; }
.nw-dump-filelist { margin: 10px 0 0; padding: 0; list-style: none; font-size: 13px; color: var(--nw-muted, #7f8caa); }

.nw-dump-foot { display: flex; justify-content: space-between; align-items: center; gap: 10px;
  padding: 12px 18px 16px; border-top: 1px solid var(--nw-border, rgba(127, 140, 170, 0.18)); }
.nw-dump-btn { padding: 8px 16px; border-radius: 10px; border: 0; cursor: pointer; font-size: 13px; font-weight: 600;
  background: var(--nw-accent, #6366f1); color: #fff; }
.nw-dump-btn:disabled { opacity: 0.5; cursor: default; }
.nw-dump-btn-ghost { background: transparent; color: var(--nw-muted, #7f8caa); border: 1px solid var(--nw-border, rgba(127, 140, 170, 0.3)); }

.nw-dump-progress { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; }
.nw-dump-phase { font-weight: 600; }
.nw-dump-counts { font-size: 13px; color: var(--nw-muted, #7f8caa); }
.nw-dump-err { color: #c0392b; font-size: 13px; }

.nw-dump-manifest { display: flex; flex-direction: column; gap: 6px; }
.nw-dump-row { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border-radius: 10px;
  border: 1px solid var(--nw-border, rgba(127, 140, 170, 0.18)); }
.nw-dump-row.is-disabled { opacity: 0.55; }
.nw-dump-row-main { flex: 1; min-width: 0; }
.nw-dump-row-title { font-weight: 600; font-size: 14px; }
.nw-dump-row-summary { font-size: 12.5px; color: var(--nw-muted, #7f8caa); }
.nw-dump-row-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; font-size: 11.5px; color: var(--nw-muted, #7f8caa); }
.nw-dump-badge { padding: 1px 6px; border-radius: 999px; background: rgba(99, 102, 241, 0.14); color: var(--nw-accent, #6366f1); }
.nw-dump-badge-warn { background: rgba(192, 57, 43, 0.14); color: #c0392b; }
.nw-dump-tag { padding: 1px 6px; border-radius: 999px; background: rgba(127, 140, 170, 0.14); }
```

- [ ] **Step 2: Write the component** — `landing/src/workspace/DumpModal.tsx` (COMPLETE — no placeholders)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import "../styles/dump.css";
import { Icon } from "./icons";
import type { DumpClient } from "./dumpClient";
import type {
  PublicDumpJob,
  DumpSource,
  GithubRepoOption,
  NotionPageOption,
  ConnectorInfo,
} from "./dumpTypes";
import { manifestToRows, countsLabel, phaseLabel, type ManifestRow } from "./dumpView";

type Tab = "paste" | "upload" | "github" | "notion";
const TABS: { id: Tab; label: string }[] = [
  { id: "paste", label: "Paste" },
  { id: "upload", label: "Upload" },
  { id: "github", label: "GitHub" },
  { id: "notion", label: "Notion" },
];

interface UploadedFile { name: string; content: string }

export function DumpModal({
  client,
  onClose,
  toast,
}: {
  client: DumpClient;
  onClose: () => void;
  toast: (text: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("paste");

  // source inputs
  const [text, setText] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [repos, setRepos] = useState<GithubRepoOption[]>([]);
  const [pages, setPages] = useState<NotionPageOption[]>([]);
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>("");
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());

  // job + manifest state
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<PublicDumpJob | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // Escape closes; the job keeps running server-side (durable).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Load connectors + lists once.
  useEffect(() => {
    client.connectors().then(setConnectors).catch(() => {});
  }, [client]);

  const isLinked = (provider: string) => connectors.some((c) => c.provider === provider);

  useEffect(() => {
    if (tab === "github" && isLinked("github")) client.githubRepos().then(setRepos).catch(() => {});
    if (tab === "notion" && isLinked("notion")) client.notionPages().then(setPages).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, connectors]);

  /* ------------------------------ polling ------------------------------- */
  const beginPolling = useCallback(
    (id: string) => {
      stopPolling();
      pollRef.current = setInterval(() => {
        client
          .poll(id)
          .then((j) => {
            setJob(j);
            if (j.status === "awaiting_review" && j.manifest) {
              setSelected((prev) =>
                prev.size > 0
                  ? prev
                  : new Set(manifestToRows(j.manifest).filter((r) => r.defaultSelected).map((r) => r.itemId)),
              );
            }
            if (j.status === "done") {
              stopPolling();
              toast("Dump complete — notes created.");
              onClose();
            }
            if (j.status === "failed" || j.status === "cancelled") {
              stopPolling();
              setErr(j.error ?? "Dump did not finish.");
            }
          })
          .catch((e) => {
            stopPolling();
            setErr(e instanceof Error ? e.message : "Lost contact with the dump.");
          });
      }, 1000);
    },
    [client, onClose, stopPolling, toast],
  );

  /* ------------------------------- start -------------------------------- */
  function buildSource(): DumpSource | null {
    if (tab === "paste") return text.trim() ? { type: "raw", text } : null;
    if (tab === "upload") return files.length ? { type: "raw", files } : null;
    if (tab === "github") return selectedRepo ? { type: "github", repo: selectedRepo } : null;
    if (tab === "notion") return selectedPages.size ? { type: "notion", pageIds: [...selectedPages] } : null;
    return null;
  }

  const start = async () => {
    const source = buildSource();
    if (!source) return;
    setBusy(true); setErr(null);
    try {
      const { jobId: id } = await client.start(source);
      setJobId(id);
      setJob({ id, sourceType: source.type, status: "queued", counts: {}, error: null });
      beginPolling(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start the dump.");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!jobId) return;
    setBusy(true); setErr(null);
    try {
      await client.commit(jobId, [...selected]);
      setJob((j) => (j ? { ...j, status: "committing", manifest: undefined } : j));
      beginPolling(jobId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the notes.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (jobId) { try { await client.cancel(jobId); } catch { /* ignore */ } }
    stopPolling();
    onClose();
  };

  /* ----------------------------- file input ----------------------------- */
  const onPickFiles = (list: FileList | null) => {
    if (!list) return;
    const reads = Array.from(list).map(
      (f) =>
        new Promise<UploadedFile>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: f.name, content: String(reader.result ?? "") });
          reader.onerror = () => resolve({ name: f.name, content: "" });
          reader.readAsText(f);
        }),
    );
    Promise.all(reads).then((next) => setFiles((prev) => [...prev, ...next]));
  };

  const togglePage = (id: string) =>
    setSelectedPages((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  /* ------------------------------- render ------------------------------- */
  const running = job !== null && job.status !== "awaiting_review";
  const reviewing = job?.status === "awaiting_review" && job.manifest;
  const rows: ManifestRow[] = reviewing ? manifestToRows(job!.manifest!) : [];

  return (
    <>
      <div className="nw-menu-scrim" onClick={onClose} />
      <div className="nw-dump-panel" role="dialog" aria-modal="true" aria-labelledby="dump-dialog-title">
        <header className="nw-dump-head">
          <h2 id="dump-dialog-title">Dump into Noto</h2>
          <button className="nw-dump-x" onClick={onClose} aria-label="Close">×</button>
        </header>

        {!job && (
          <div className="nw-dump-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={"nw-dump-tab" + (tab === t.id ? " is-active" : "")}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="nw-dump-body">
          {/* ----- input stage ----- */}
          {!job && tab === "paste" && (
            <textarea
              className="nw-dump-textarea"
              placeholder="Paste text or markdown to turn into atomic notes…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}

          {!job && tab === "upload" && (
            <div>
              <label className="nw-dump-drop">
                <Icon name="folder" size={20} stroke={1.6} />
                <div>Choose .md / .txt / .markdown files</div>
                <input
                  type="file"
                  multiple
                  accept=".md,.txt,.markdown,text/plain,text/markdown"
                  style={{ display: "none" }}
                  onChange={(e) => onPickFiles(e.target.files)}
                />
              </label>
              {files.length > 0 && (
                <ul className="nw-dump-filelist">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`}>{f.name} · {f.content.length} chars</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!job && tab === "github" && (
            isLinked("github") ? (
              <select
                className="nw-dump-textarea"
                style={{ minHeight: "auto", height: 40 }}
                value={selectedRepo}
                onChange={(e) => setSelectedRepo(e.target.value)}
              >
                <option value="">Choose a repository…</option>
                {repos.map((r) => (
                  <option key={r.fullName} value={r.fullName}>{r.fullName}</option>
                ))}
              </select>
            ) : (
              <div className="nw-dump-drop">
                <p>Connect GitHub to pull docs and issues from a repository.</p>
                <button className="nw-dump-btn" onClick={() => { window.location.href = "/api/auth/github/install"; }}>
                  Connect GitHub
                </button>
              </div>
            )
          )}

          {!job && tab === "notion" && (
            isLinked("notion") ? (
              <ul className="nw-dump-filelist">
                {pages.map((p) => (
                  <li key={p.id}>
                    <label>
                      <input type="checkbox" checked={selectedPages.has(p.id)} onChange={() => togglePage(p.id)} />{" "}
                      {p.title} <span className="nw-dump-tag">{p.type}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="nw-dump-drop">
                <p>Connect Notion to import the pages and databases you select.</p>
                <button className="nw-dump-btn" onClick={() => { window.location.href = "/api/auth/notion/install"; }}>
                  Connect Notion
                </button>
              </div>
            )
          )}

          {/* ----- progress stage ----- */}
          {running && job && (
            <div className="nw-dump-progress">
              <span className="nw-dump-phase">{phaseLabel(job.status)}</span>
              <span className="nw-dump-counts">{countsLabel(job.counts)}</span>
            </div>
          )}

          {/* ----- review stage ----- */}
          {reviewing && (
            <div className="nw-dump-manifest">
              {rows.map((r) => (
                <div key={r.itemId} className={"nw-dump-row" + (r.disabled ? " is-disabled" : "")}>
                  <input
                    type="checkbox"
                    checked={selected.has(r.itemId)}
                    disabled={r.disabled}
                    onChange={() => toggleRow(r.itemId)}
                  />
                  <div className="nw-dump-row-main">
                    <div className="nw-dump-row-title">{r.title}</div>
                    {r.summary && <div className="nw-dump-row-summary">{r.summary}</div>}
                    <div className="nw-dump-row-meta">
                      {r.badge && <span className="nw-dump-badge">{r.badge}</span>}
                      {r.redacted && <span className="nw-dump-badge nw-dump-badge-warn">{r.redactionCount} redacted</span>}
                      {r.linkCount > 0 && <span>{r.linkCount} links</span>}
                      {r.tags.map((t) => <span key={t} className="nw-dump-tag">{t}</span>)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {err && <p className="nw-dump-err">{err}</p>}
        </div>

        <div className="nw-dump-foot">
          {reviewing ? (
            <>
              <button className="nw-dump-btn nw-dump-btn-ghost" onClick={cancel}>Cancel</button>
              <button className="nw-dump-btn" onClick={commit} disabled={busy || selected.size === 0}>
                Create {selected.size} {selected.size === 1 ? "note" : "notes"}
              </button>
            </>
          ) : running ? (
            <button className="nw-dump-btn nw-dump-btn-ghost" onClick={cancel}>Stop</button>
          ) : (
            <>
              <button className="nw-dump-btn nw-dump-btn-ghost" onClick={onClose}>Close</button>
              <button className="nw-dump-btn" onClick={start} disabled={busy || !buildSource()}>
                Start dump
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
```

> No component test exists or is created (00 §16). The polling loop, FileReader read, and durability-on-close are validated by `npm run build` + the manual preview workflow below.

- [ ] **Step 3: Build to verify the component compiles** — `cd landing && npm run build` → **expected: exits 0** (tsc -b + vite). If `tsc` flags an unused import or a type mismatch, fix it (strict `noUnusedLocals`/`noUnusedParameters`); confirm your file is lint-clean with `npx eslint src/workspace/DumpModal.tsx`.

- [ ] **Step 4: Commit**
```bash
git add src/workspace/DumpModal.tsx src/styles/dump.css
git commit -m "feat(dump): DumpModal (tabs / polling progress / manifest review)"
```

> **Manual preview (visual check only — after the wiring in Task 6 lands):** `cd landing && npm run dev`, open the workspace, run **⌘K → "Dump…"** (or the sidebar account-menu **"Dump into Noto…"**). In the auth app the real client polls `/api/dump`; the public demo omits the client so the entry point simply does not appear. There is no automated component test — this preview pass is the visual gate.

---

## Task 5: `ConnectorsSettings` panel (build-verified, no component test)

A small panel mirroring `McpSettings` — Connect / Connected-as / Disconnect rows for GitHub + Notion. Connect navigates to the install route; Disconnect calls `client.disconnect`. **No `.test.tsx`.**

**Files:**
- Create: `landing/src/workspace/ConnectorsSettings.tsx`

- [ ] **Step 1: Write the component** — `landing/src/workspace/ConnectorsSettings.tsx` (COMPLETE)

```tsx
import { useEffect, useState } from "react";
import "../styles/dump.css";
import type { DumpClient } from "./dumpClient";
import type { ConnectorInfo } from "./dumpTypes";

const PROVIDERS: { id: string; label: string; installPath: string; blurb: string }[] = [
  { id: "github", label: "GitHub", installPath: "/api/auth/github/install", blurb: "Pull docs and issues from a repository (read-only)." },
  { id: "notion", label: "Notion", installPath: "/api/auth/notion/install", blurb: "Import the pages and databases you select." },
];

export function ConnectorsSettings({ client, onClose }: { client: DumpClient; onClose: () => void }) {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => client.connectors().then(setConnectors).catch(() => {});
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [client]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const linked = (id: string) => connectors.find((c) => c.provider === id) ?? null;

  const disconnect = async (id: string) => {
    setBusy(id); setErr(null);
    try { await client.disconnect(id); refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not disconnect."); }
    finally { setBusy(null); }
  };

  return (
    <>
      <div className="nw-menu-scrim" onClick={onClose} />
      <div className="nw-dump-panel" role="dialog" aria-modal="true" aria-labelledby="connectors-dialog-title">
        <header className="nw-dump-head">
          <h2 id="connectors-dialog-title">Connectors</h2>
          <button className="nw-dump-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="nw-dump-body">
          <div className="nw-dump-manifest">
            {PROVIDERS.map((p) => {
              const conn = linked(p.id);
              return (
                <div key={p.id} className="nw-dump-row">
                  <div className="nw-dump-row-main">
                    <div className="nw-dump-row-title">{p.label}</div>
                    <div className="nw-dump-row-summary">
                      {conn ? `Connected${conn.externalAccount ? ` as ${conn.externalAccount}` : ""}` : p.blurb}
                    </div>
                  </div>
                  {conn ? (
                    <button className="nw-dump-btn nw-dump-btn-ghost" disabled={busy === p.id} onClick={() => disconnect(p.id)}>
                      {busy === p.id ? "…" : "Disconnect"}
                    </button>
                  ) : (
                    <button className="nw-dump-btn" onClick={() => { window.location.href = p.installPath; }}>
                      Connect
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {err && <p className="nw-dump-err">{err}</p>}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Build** — `cd landing && npm run build` → **expected: exits 0**. Confirm clean: `npx eslint src/workspace/ConnectorsSettings.tsx`.

- [ ] **Step 3: Commit**
```bash
git add src/workspace/ConnectorsSettings.tsx
git commit -m "feat(dump): ConnectorsSettings panel (GitHub/Notion connect/disconnect)"
```

---

## Task 6: Wiring — `NotoWindow`, `CommandPalette`, `Sidebar`, `NotoWorkspace`

Thread `dumpClient` through with the same gating as `mcpClient`/`activityClient`: optional prop (NO default), gated render, palette command, sidebar footer button, real client injected only in the auth app. The demo (`NotoApp.tsx`) is **not** touched — omitting the prop disables Dump there.

**Files:**
- Modify: `landing/src/workspace/CommandPalette.tsx`
- Modify: `landing/src/workspace/Sidebar.tsx`
- Modify: `landing/src/workspace/NotoWindow.tsx`
- Modify: `landing/src/app/NotoWorkspace.tsx`

- [ ] **Step 1: Add the `open-dump` command** — `CommandPalette.tsx`

Append to the `COMMANDS` array (after `insert-backlink`); use an existing icon name (`spark`):
```typescript
  { id: "open-dump", title: "Dump…", icon: "spark" },
```

- [ ] **Step 2: Add the `onOpenDump` footer button** — `Sidebar.tsx`

1. Add to the `Props` interface (next to `onOpenConnect?`):
```typescript
  onOpenDump?: () => void;
```
2. Add `onOpenDump` to the destructure in `Sidebar(props)` (the `account, theme, onToggleTheme, onLogout, onOpenConnect, onOpenActivity,` line):
```typescript
    account, theme, onToggleTheme, onLogout, onOpenConnect, onOpenDump, onOpenActivity,
```
3. Pass it into `<AccountFooter ... />`:
```tsx
        <AccountFooter account={account} theme={theme} onToggleTheme={onToggleTheme} onLogout={onLogout} onOpenConnect={onOpenConnect} onOpenDump={onOpenDump} />
```
4. Extend `AccountFooter`'s prop type + destructure (mirror `onOpenConnect`):
```typescript
function AccountFooter({
  account, theme, onToggleTheme, onLogout, onOpenConnect, onOpenDump,
}: {
  account: { email: string | null } | null;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  onLogout?: () => void;
  onOpenConnect?: () => void;
  onOpenDump?: () => void;
}) {
```
5. Add the menu item right after the `onOpenConnect` button block (inside the open menu):
```tsx
            {onOpenDump && (
              <button
                className="nw-menu-item"
                onClick={() => { setOpen(false); onOpenDump(); }}
              >
                <Icon name="folder" size={14} stroke={1.7} />
                <span>Dump into Noto…</span>
              </button>
            )}
```

- [ ] **Step 3: Wire `NotoWindow.tsx`**

1. Add the imports near `import { McpSettings } from "./McpSettings";`:
```typescript
import { DumpModal } from "./DumpModal";
import type { DumpClient } from "./dumpClient";
```
2. Add the optional prop to `interface Props` (after `mcpClient?`, NO default):
```typescript
  /** Bulk-ingest backend for the Dump modal (omit in the demo). */
  dumpClient?: DumpClient;
```
3. Add `dumpClient` to the destructured params of `NotoWindow({ ... })` (after `mcpClient,`):
```typescript
  mcpClient,
  dumpClient,
  activityClient,
```
4. Add the open-state next to `const [mcpOpen, setMcpOpen] = useState(false);`:
```typescript
  const [dumpOpen, setDumpOpen] = useState(false);
```
5. Add the dispatch case to the `paletteCommand` switch (guarded by the client):
```typescript
        case "open-dump": if (dumpClient) setDumpOpen(true); break;
```
   …and add `dumpClient` to that `useCallback`'s dependency array (currently `[ws, ai, controller]`):
```typescript
    [ws, ai, controller, dumpClient],
```
6. Pass `onOpenDump` to `<Sidebar ... />` (mirror `onOpenConnect`, next to that prop):
```tsx
            onOpenDump={dumpClient ? () => setDumpOpen(true) : undefined}
```
7. Gate the modal render next to the `mcpOpen` line (in the bottom overlay block):
```tsx
      {dumpOpen && dumpClient && <DumpModal client={dumpClient} onClose={() => setDumpOpen(false)} toast={toast} />}
```

- [ ] **Step 4: Inject `realDumpClient` in the auth app** — `NotoWorkspace.tsx`

1. Add the import near `import { realMcpClient } from "./mcpClient";`:
```typescript
import { realDumpClient } from "./dumpClient";
```
2. Add the prop to the `<NotoWindow ... />` element (next to `mcpClient={realMcpClient}`):
```tsx
      mcpClient={realMcpClient}
      dumpClient={realDumpClient}
```

> **Do NOT modify `src/noto/NotoApp.tsx`.** The demo omits `dumpClient`, so `onOpenDump` is `undefined` (no sidebar item) and the `open-dump` command is a no-op — Dump's real backend is never reachable from the public preview (zero API cost), matching the AI/MCP/Activity gating.

- [ ] **Step 5: Full build to verify the whole phase compiles** — `cd landing && npm run build` → **expected: exits 0**. Then confirm the changed files are lint-clean:
```bash
cd landing && npx eslint src/workspace/NotoWindow.tsx src/workspace/Sidebar.tsx src/workspace/CommandPalette.tsx src/app/NotoWorkspace.tsx src/workspace/DumpModal.tsx src/workspace/ConnectorsSettings.tsx src/workspace/dumpClient.ts src/workspace/dumpView.ts src/app/dumpClient.ts src/app/api.ts
```

- [ ] **Step 6: Commit**
```bash
git add src/workspace/NotoWindow.tsx src/workspace/Sidebar.tsx src/workspace/CommandPalette.tsx src/app/NotoWorkspace.tsx
git commit -m "feat(dump): wire DumpClient through NotoWindow/Sidebar/CommandPalette (demo omits it)"
```

---

**P6 done when:**
- `dumpClient.ts` exports `DumpClient` (with `start`/`poll`/`commit`/`cancel`/`remove`/`githubRepos`/`notionPages`/`connectors`/`disconnect`) + `mockDumpClient`; `dumpTypes.ts` mirrors P0's `PublicDumpJob`/`ManifestItem`/`DumpCounts`; `app/dumpClient.ts` exports `realDumpClient` over `api.dump.*`.
- The **pure** helpers `nextMockPhase` (Task 1), `manifestToRows`/`countsLabel`/`selectableItemIds`/`phaseLabel` (Task 3) are TDD'd: `npx vitest run src/workspace/dumpClient.test.ts src/workspace/dumpView.test.ts` is green.
- `api.dump.*` is added (upload sent as JSON `{name,content}`, no multipart).
- `DumpModal` (tabs / polling / manifest review / durable-close) and `ConnectorsSettings` exist and **compile** — there is **no** `.test.tsx` for them, by design (00 §16).
- `NotoWindow` has the `dumpClient?` prop (no default), `dumpOpen` state, gated `{dumpOpen && dumpClient && <DumpModal/>}`, the `open-dump` palette command + guarded dispatch case, and the Sidebar `onOpenDump` footer button; `NotoWorkspace` injects `realDumpClient`; `NotoApp` omits it.
- `cd landing && npm run build` exits 0 and `npx eslint` reports **no new errors** on every file touched in this phase.
