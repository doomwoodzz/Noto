# Noto "Dump" — Implementation Plan (Overview)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pour bulk content (pasted text, uploaded files, a selected GitHub repo, or selected Notion pages) into Noto and have it become clean, atomic, titled/tagged/linked notes — embedded for AI recall and connected in the knowledge web without hairballing — behind a durable background job with a preview-and-approve gate.

**Architecture:** Each source is a thin `SourceProvider` feeding one shared pipeline: **fetch → shape (split · redact secrets · clean · LLM metadata · dedup) → manifest (user approval) → commit (create notes under `Dump/<source>/` · resolve ≤5 `[[wiki-links]]` · build a per-source MOC index · embed · audit)**. The pipeline runs as the project's first **in-process background job** (`dump_jobs`/`dump_items` tables + an in-process worker loop) with client **status polling**. Embedding runs inside the worker, off the request thread.

**Tech Stack:** TypeScript ESM; Express 5; `node:sqlite` (`DatabaseSync`); zod 4; `tsx`; React 19; Vitest 3 (node env, `:memory:` SQLite); OpenAI `gpt-4o-mini` via the existing `complete()` wrapper; MiniLM embeddings via the existing `reembedNote()`; AES-256-GCM keyvault; SSRF-guarded `safeFetch`; GitHub App + Notion OAuth.

**Design spec (authoritative):** `docs/superpowers/specs/2026-06-30-noto-dump-design.md`. Read it for the *why*; this plan is the *how*.

---

## Read this first

`00-global-constraints.md` carries **verbatim values and reusable signatures** every task depends on (DB helpers, `complete()`, keyvault, `safeFetch`, OAuth helpers, the test harness, env vars, CSP additions, the provenance-marker format, the secret-pattern list, the `Dump/` path scheme, and the security invariants). **Every task references it.** Do not re-derive these from the codebase — they are pinned here so a zero-context engineer copies them exactly.

## Subsystem map & build order

Tasks are grouped into eight files. Build strictly in this order; later files import types/functions defined in earlier ones.

| File | Phase | Builds | Depends on |
|---|---|---|---|
| `01-data-model.md` | **P0** | Migrations for `dump_jobs`/`dump_items`/`dump_sources`/`connector_tokens`; DB accessors; shared types (`server/dump/types.ts`); the provenance marker (`src/noto-core/provenance.ts`) | — |
| `02-job-orchestration.md` | **P1** | The in-process worker loop, phase machine, `/api/dump/*` routes (create/poll/commit/cancel/delete), `dumpLimiter`, mount in `app.ts`, worker boot in `index.ts` | P0 |
| `03-shaping-pipeline.md` | **P2** | `secrets.ts` (detect+redact+neutralize), boundary split, `dumpEnrich` LLM call, `dedup.ts`, staging into `dump_items`, manifest assembly, the **raw** `SourceProvider` (paste/upload) | P0, P1 |
| `04-graph-connection.md` | **P3** | `commit.ts`: create notes under `Dump/<source>/`, resolve ≤5 `[[links]]` (two-pass), build/update the per-source MOC, embed, audit; link-candidate retrieval | P0, P2 |
| `05-github-connector.md` | **P4** | env + CSP, GitHub App JWT + installation tokens, `auth/github.ts` (install/callback), `connector_tokens` use, the **github** `SourceProvider`, repo-list endpoint | P0–P3 |
| `06-notion-connector.md` | **P5** | env + CSP, `auth/notion.ts` (OAuth install/callback), the **notion** `SourceProvider` (blocks→markdown, pagination, rate-limit), page-list endpoint | P0–P3 |
| `07-ui-client.md` | **P6** | `DumpClient` interface + mock + real adapter, `api.dump.*`, `DumpModal` (tabs/progress/manifest), `ConnectorsSettings`, `NotoWindow`/`Sidebar`/`NotoWorkspace` wiring, demo omission | P0–P6 |
| `08-downstream-hardening.md` | **P7** | Functional provenance marker: untrusted-source fence in `buildChatPrompt`, provenance tags on MCP `search_notes`/`recall` results | P0 (provenance), P2 (marker emitted) |

**P4 and P5 are independent** and may be built in parallel once P3 is done. **P7** can be built any time after P0 (it only needs the provenance marker), but it is verified meaningfully once P2 emits markers.

## Shared interfaces (locked in P0 — `server/dump/types.ts`)

These names are used verbatim across all later tasks. Do not rename.

```typescript
// A unit of source content before shaping. Produced by a SourceProvider.
export interface RawItem {
  sourceKey: string;        // stable identity, e.g. "github:o/r@<sha>:docs/x.md" | "raw:sha256(content)"
  title: string;            // best-effort title hint (filename / page title / first heading)
  body: string;             // raw text/markdown
  origin: ProvenanceOrigin; // source attribution (becomes the note's provenance marker)
}

// Source attribution stamped into every note's provenance marker.
export interface ProvenanceOrigin {
  type: "raw" | "github" | "notion";
  ref?: string;             // commit sha / page last_edited_time / paste timestamp id
  url?: string;             // canonical source URL (github blob / notion page)
  path?: string;            // repo path / notion page-tree path
  repo?: string;            // "owner/repo" for github
}

// The shaped result staged in dump_items.shaped (JSON).
export interface ShapedNote {
  notePath: string;         // vault-relative target, e.g. "Dump/acme-repo/Readme.md"
  title: string;
  summary: string;          // one line
  tags: string[];           // <= 5, no leading '#'
  links: string[];          // <= 5 candidate titles to wiki-link
  body: string;             // cleaned, secret-redacted, hidden-text-neutralized (NO marker yet)
  origin: ProvenanceOrigin;
}

// A SourceProvider enumerates RawItems for a job. Enumeration is capped (see Global Constraints).
export interface SourceProvider {
  // Yield items in deterministic order; stop at `cap`. Best-effort per item; throw only on auth/fatal errors.
  fetch(ctx: FetchCtx): Promise<RawItem[]>;
}
export interface FetchCtx {
  userId: string;
  sourceRef: unknown;       // provider-specific selector (parsed from dump_jobs.source_ref JSON)
  cap: number;              // max items to enumerate (computed by the job before fetch)
  onProgress: (fetched: number) => void;
}

// One manifest row the client renders for approval.
export interface ManifestItem {
  itemId: string;
  title: string;
  summary: string;
  tags: string[];
  linkCount: number;
  notePath: string;
  redactionCount: number;
  status: "new" | "update" | "duplicate" | "skipped";  // see dedup
  dedupOf?: string;         // existing fileId for update/duplicate
}
```

## Cross-phase function seams (locked names — use verbatim)

These exported names are the contract between phases. Define them exactly; later phases import them.

```typescript
// server/dump/jobs.ts (P1)
export function enqueueDump(input: { userId: string; vaultId: string; sourceType: "raw"|"github"|"notion"; sourceRef: unknown; sourceSlug: string }): DumpJobRow; // creates a 'queued' job
export function startDumpWorker(): void;          // idempotent; setInterval drain; never throws
export function requestCancel(jobId: string): void;
// internal drain: 'queued' → await shapeJob(job) (ends 'awaiting_review'); 'committing' → await commitJob(job) (ends 'done')

// server/dump/providers/index.ts (registry; raw added P2, github P4, notion P5)
export function getProvider(type: "raw"|"github"|"notion"): SourceProvider;

// server/dump/shape.ts (P2)
export async function shapeJob(job: DumpJobRow): Promise<void>;  // fetch→split→redact→clean→enrich→dedup→stage dump_items→status 'awaiting_review'
export function buildManifest(jobId: string): ManifestItem[];

// server/dump/secrets.ts (P2)   export function redactSecrets(body: string): { body: string; count: number };
// server/dump/clean.ts (P2)     export function cleanBody(raw: string): string; // neutralize hidden text + light cleanup
// server/dump/enrich.ts (P2)    export async function enrichNote(input: {...}): Promise<{ title; summary; tags; links }>;
// server/dump/dedup.ts (P2)     export function classifyItem(userId, sourceKey, contentHash): { status: "new"|"update"|"duplicate"; dedupOf?: string };

// server/dump/commit.ts (P3/graph)
export async function commitJob(job: DumpJobRow): Promise<void>;  // selected items → createFile under Dump/<slug>/ → resolve links → MOC → embed → audit → status 'done'

// server/dump/routes.ts (P1)    export const dumpRouter; // mounted at /api/dump
// server/connectors/routes.ts (P4/P5)  export const connectorsRouter; // mounted at /api/connectors
```

The **commit route** (P1) marks the user-approved items `status='selected'` and sets the job to `committing`; the worker then calls `commitJob`. `shapeJob`/`commitJob` are written in later phases — in P1 you create thin stubs (e.g. `shapeJob` sets `awaiting_review` with zero items) so the worker compiles and is tested, then later phases replace the stub bodies.

## Execution

Execute task-by-task with `superpowers:subagent-driven-development`: one fresh subagent per task, two-stage review between tasks. Every task ends green (`typecheck` + `lint` + `vitest` + `build` as specified per task). Commit after each task.
