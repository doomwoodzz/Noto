# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Noto is a local-first Markdown notes workspace with an AI lecture-listening assistant,
run entirely on the user's own machine. It features a three-pane workspace (vault
sidebar, editor, context panel), wiki-link support with generated backlinks, a
canvas-based "Knowledge Web" graph view, a real OpenAI-backed AI assistant (chat,
summarize, flashcards, find-links, lecture transcription), semantic Smart Search
(local MiniLM embeddings), a bulk-import "Dump" pipeline (paste/upload/GitHub/Notion),
and an MCP bridge so MCP-compatible tools (Claude Code, Cursor, Codex) can read/write
the vault and a shared memory layer.

Slogan: "When you listen, Noto remembers."

There is no sign-in: every request is transparently attached to a single local-owner
user, auto-provisioned on first boot. See `landing/server/auth/localSession.ts`.

## Tech Stack

- Express 5 server (`landing/server/`) + `node:sqlite` (no native DB addon)
- React 19 + Vite 8 frontend (`landing/src/`), TypeScript throughout
- Server code runs directly via `tsx` (no separate server build step)
- Vitest for tests
- `packaging/pypi/`: a Python package that wraps the above for `pip install noto-app`
- `noto-mcp/`: a separate stdio MCP server bridging Claude Code/Cursor/Codex to the
  HTTP API via a Personal Access Token (PAT)

## Repo Layout

- `landing/server/` — Express API. One subdirectory per feature: `auth/` (local
  session + GitHub/Notion connector OAuth + PAT), `notes/`, `dump/` (bulk import),
  `ai/` (OpenAI-backed features), `search/` (semantic search + MiniLM embedder),
  `graph/` (Knowledge Web edge building), `memory/` (shared MCP memory), `links/`
  (citation unfurling), `tokens/` (PAT management), `audit/` (activity feed), `mcp/`
  (remote MCP transport), `connectors/`. `db.ts` is the only file that touches SQL.
- `landing/src/` — frontend. `app/` (the real authenticated-shape workspace, now
  gate-free — see `AppRoot.tsx`), `workspace/` (shared UI: sidebar, editor, graph,
  command palette — used by both the real app and the marketing demo), `landing/`
  (marketing homepage), `features/`, `download/` (install-instructions page),
  `onboarding/` (first-run tour only — no accounts), `noto/` (in-memory mock vault
  for the marketing demo), `noto-core/` (parser/graph logic shared with the demo).
- `packaging/pypi/` — the `noto-app` PyPI package. `noto_app/cli.py` is the `noto`
  entry point; `noto_app/node_runtime.py` fetches/verifies/caches Node.js;
  `noto_app/_vendor/` is a generated, gitignored staging area populated by
  `landing/scripts/build-pypi-bundle.mjs` at release time.
- `noto-mcp/` — separate stdio MCP server package.
- `docs/superpowers/` — design specs and implementation plans (historical record;
  never rewritten after the fact).

## Build, Test, and Run

```bash
cd landing
npm install
npm run dev            # Vite client (5173) + Express API (8787) together
npm test                # Vitest
npm run typecheck:server
npm run lint
npm run build           # full marketing site + app (tsc -b && vite build)
```

Packaging (produces the bundle vendored into the pip package):
```bash
cd landing
node scripts/build-pypi-bundle.mjs
cd ../packaging/pypi
python -m build
```

## Architecture

### State Flow

1. Every `/api` request is attached to the single local-owner user automatically
   (`server/auth/localSession.ts`) — there is no login step and no multi-tenancy.
2. `db.ts` is the only module that touches SQL; all other modules call its exported
   functions. Swapping to Postgres later means re-implementing this one module.
3. The frontend's `useVault` hook (`landing/src/app/useVault.ts`) adapts the REST API
   into the `VaultController` shape the shared `workspace/` UI renders against — the
   same UI renders against a real vault (`app/NotoWorkspace.tsx`) or an in-memory mock
   (`noto/NotoApp.tsx`, the marketing demo), with full parity.
4. The Knowledge Web graph is built server-side from structural links/tags plus
   MiniLM-embedding-based semantic edges for under-linked notes (`server/graph/`),
   cached in SQLite, and rendered as a force-directed canvas
   (`landing/src/workspace/graph/`).

### Auth model

No accounts. `server/auth/localSession.ts`'s `ensureLocalSession` middleware runs
before every `/api` route: if the request carries no valid session cookie and no PAT
bearer token, it auto-provisions the one local-owner user (`db.ts`'s
`ensureLocalOwner()`) and mints a session, invisibly. GitHub App and Notion OAuth
(`server/auth/github.ts`, `server/auth/notion.ts`) are Dump data-source *connectors*,
not login — they call `getCurrentUser(req)` like every other route and simply resolve
to the local owner. PAT tokens (`server/auth/pat.ts`) authenticate the `noto-mcp`
bridge via `Authorization: Bearer` and bypass session/CSRF entirely (no cookies
involved). The server binds `127.0.0.1` only.

### Packaging

`packaging/pypi/noto_app/cli.py` is a thin orchestrator: it has no bundled Node.js of
its own. On first run it downloads the official Node.js build matching the user's
OS/arch from nodejs.org, verifies it against the published SHA256SUMS, caches it, then
runs one real `npm ci --omit=dev` against the vendored server bundle (this is what
makes npm resolve the correct prebuilt `onnxruntime-node` native binary for that
machine — a single compiled cross-platform executable was rejected for this reason).
Subsequent runs launch directly from cache. Local data lives in the OS-standard
per-user data directory, resolved by `noto_app/paths.py`.

## Testing Notes

- Vitest integration tests boot a real `createApp()` on port 0 per test file and drive
  it with a cookie-jar HTTP client (see `landing/server/test-helpers.ts` for the shared
  version). Since there is only one local-owner user, tests do not assert cross-user
  isolation — that property no longer exists by design.
- `packaging/pypi/tests/` covers the pure-logic pieces of the Node runtime manager
  (platform/arch → download URL mapping, checksum verification) with mocked network
  calls. The download/install/launch flow itself is verified manually (build the
  wheel, install into a clean venv, run `noto`).
