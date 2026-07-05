# Noto Shared-Memory Wedge — Continue Here (SP3 → SP5)

> **Paste this whole file as the first message of a fresh Claude Code session** (run from the repo root `<repo-root>`). It is a self-contained handoff: it tells you what exists, what's decided, and what to build next.

## Your task

Continue building Noto's shared-memory MCP wedge. **SP1 and SP2 are done, verified, and committed** on branch `feat/noto-web-app`. Build the next sub-project(s): **SP3 → SP4 → SP5** (defined below), one at a time, each via the workflow in "How to work" below. Start by asking me which sub-project to do first (default: **SP3**).

## What Noto is (and the wedge)

Noto is a hosted Markdown notes web app (`landing/`: React 19 + Express 5 + SQLite via `node:sqlite`, WAL; server is source of truth; auth = session cookie **or** PAT bearer token). The wedge: **"Noto is the app that remembers — the notes vault that doubles as the shared, auditable memory your Claude Code / Cursor / ChatGPT read from and write back to."** A standalone npm package `noto-mcp/` (stdio MCP server) bridges PAT-authed HTTP endpoints to AI tools.

## Read these first (authoritative, in order)

1. `docs/superpowers/specs/2026-06-28-noto-stage-a-wedge-analysis.md` — market/wedge + the SP1–SP5 decomposition.
2. `docs/superpowers/specs/2026-06-28-noto-shared-memory-sp1-design.md` — SP1 design (read §0b Addendum — authoritative).
3. `docs/superpowers/plans/2026-06-28-noto-shared-memory-sp1.md` — SP1 plan (built).
4. `docs/superpowers/specs/2026-06-28-noto-shared-memory-sp2-design.md` — SP2 design.
5. `docs/superpowers/plans/2026-06-28-noto-shared-memory-sp2.md` — SP2 plan (built).
6. Your memory file `noto-mcp-memory-layer` (auto-loaded) — running status + locked decisions.

## What already exists (REUSE — do not rebuild)

**Server (`landing/server/`):** PAT auth (`auth/pat.ts`: `resolveApiToken`, `requireScope`; scopes `read|write|destructive|memory`), `/api/tokens` mint/list/revoke (`tokens/routes.ts`), tables `pat_tokens` / `audit_log` / `memories` / `files` + `files_fts` + `memories_fts`; `db.ts` helpers (`createPat`/`usePat`, `writeAudit`/`sha256Hex`, `rememberMemory`/`recallMemories`/`listMemories`, `searchFiles`/`listNoteRefs`, `ftsQuery`, `getOwnedFile`/`updateFile`/`createFile`/`ensureDefaultVault`/`getVaultsForUser`); endpoints `GET /api/files/:id`, `GET/PATCH /api/files/:id/section`, `POST /api/files/:id/append`, `POST /api/notes`, `GET /api/search`, `GET /api/notes`, `/api/memory` (remember/recall/list); `notes/sections.ts` (`getSection`/`replaceSection`/`listHeadings`/`appendUnderHeading`), `notes/confinement.ts` (`isMemoryPath`); `test-helpers.ts` (`startTestServer`/`signup`/`mintToken`/`makePatClient`/`makeCookieClient`).

**`noto-mcp/` (npm package, repo root):** stdio server, `@modelcontextprotocol/sdk@1.29.0`, **9 tools** (`search_notes`, `list_notes`, `get_note`, `get_section`, `remember`, `recall`, `create_note`, `append_note`, `update_section`); `scope.ts` (git-remote→cwd scope detection), `notoClient.ts` (injected-fetch HTTP client), `tools.ts`, `index.ts`.

**Client (`landing/src/`):** `app/api.ts` (`pat.*`, `memory.list`), `workspace/mcpClient.ts` + `app/mcpClient.ts` (DI), `workspace/mcpConfigs.ts` (per-client config/steering generator), `workspace/McpSettings.tsx` ("Connect AI tools" panel, per-client tabs, mints `read,memory,write`).

## Locked decisions (do not relitigate)

- One stdio `noto-mcp` for all 3 clients; bridges the HTTP API (not direct-DB). Remote HTTP is SP4.
- Hosted multi-tenant; PAT auth (UUID `id` + separate `token_hash`); ownership 404-on-miss; insufficient scope 403; missing/invalid PAT 401.
- Memory = hybrid: atomic `remember`/`recall` (table, exact-norm dedup + supersede, bm25+recency) **and** narrative `Memory/*.md` notes. No knowledge graph.
- **AI writes are hard-confined to `Memory/`** server-side (`isMemoryPath` on every PAT write); cookie sessions unconfined. No `delete` tool.
- Scope auto-detected from git remote→cwd; reads union `scope ∪ global`; writes land in exactly `scope`.
- Provenance: `memories.source_client` + an `audit_log` row on every write.

## What to build

**SP3 — Provenance / trust UI (the defensibility pillar).** A UI to browse what each AI wrote and **revert** it. The data already exists in `audit_log` (token_id, tool, target, before_hash, created_at) and `memories` (source_client). Likely scope: an audit/history view (filter by tool/source/time), a per-note "AI changes" view, and one-click revert for note edits (using `before_hash` to confirm + restore) and memory supersede/undo. Decide: where the UI lives, what "revert" means for create vs section-edit vs append vs memory.

**SP4 — Remote Streamable-HTTP `/mcp` + multi-device.** Mount the same tool handlers on the Express app as a remote MCP endpoint (bearer PAT, current MCP spec ~2025-11-25 Streamable HTTP; keep stdio as the default). Lets users connect without a local `npx` install and across machines. Watch the transport wrinkles documented in the SP1 design (Codex HTTP flakiness, Cursor HTTP↔SSE fallback).

**SP5 — Semantic memory.** Server-side embeddings (port MiniLM via `@xenova/transformers`, reusing `noto-core/chunk.ts` passages) for `search_notes` + `recall`; decay/consolidation of the atomic store. Replaces SP1's lexical FTS ranking with semantic.

## How to work (the workflow SP1/SP2 used — follow it)

1. **Brainstorm** (`superpowers:brainstorming`): explore context, surface the few real decisions as a batched `AskUserQuestion` with strong recommendations, write a design doc to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, get approval.
2. **Plan** (`superpowers:writing-plans`): write a TDD, no-placeholder plan with exact code grounded in the CURRENT files (read them first) to `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.
3. **Execute** (`superpowers:subagent-driven-development`): per task → implementer subagent → spec-compliance review → code-quality review → fix → re-verify → mark complete; final holistic review + a live MCP smoke at the end. Adjudicate review findings (accept/decline with reasons); don't blindly apply.
4. **Update** the `noto-mcp-memory-layer` memory file as you go.

## Conventions & gotchas

- Imports: `.ts` extensions in `landing/`; `.js` (NodeNext) in `noto-mcp/` production source, `.ts` in its tests.
- Tests: vitest on `DATABASE_PATH=:memory:` (fresh DB per file; unique emails per test). FTS5 is available in this Node's `node:sqlite` (verified). The auth rate-limiter is skipped when `NODE_ENV=test`.
- Run: server tests `npm test` (from `landing/`); `npm run typecheck:server`; client `npx tsc -b --noEmit` + `npm run build`; `noto-mcp/` → `npm test`, `npm run typecheck`, `npm run build`.
- Live smoke pattern (proves the real chain): start the API on a temp `DATABASE_PATH` + port, sign up via CSRF flow, mint a PAT via `POST /api/tokens`, then drive `node noto-mcp/dist/index.js` over stdio JSON-RPC (`initialize` → `notifications/initialized` → `tools/call`). See this session's transcript for the exact script.
- **Commit posture:** ask me. SP1/SP2 were built "leave uncommitted," then committed in one checkpoint. The working tree mixes in-flight web-app work with the memory layer; shared files (`db.ts`, `app.ts`, `notes/routes.ts`) can't be cleanly split by authorship.
- SDK: `noto-mcp` uses `server.tool(name, desc, zodShape, handler)` (works on `@modelcontextprotocol/sdk@1.29.0`).

## Verified status at handoff

SP1+SP2: landing **162** tests + noto-mcp **21** tests green; typecheck/lint/build clean; live MCP smokes passed (cross-session recall; write loop create→append→update_section under `Memory/`; non-`Memory/` write → 403/`isError`). 9 tools, no delete, confinement airtight.
