# Noto Local-First Open-Source Release — Design Spec

**Date:** 2026-07-06
**Branch:** `feat/noto-web-app` (becomes the new `main`)
**Status:** Approved (design), pending implementation plan

## Summary

Noto pivots from "native macOS SwiftUI prototype + multi-tenant hosted web app" to a
single, open-source, local-first tool: no accounts, no server to operate, installed
with one command. Three phases, executed in order:

1. Delete the Swift macOS app (superseded by the actively-developed web app).
2. Remove the web app's sign-in system in favor of one implicit local user.
3. Package the web app for `pip install noto-app` (console-script `noto`).

Each phase is a clean prerequisite for the next: you can't sensibly design local-only
packaging while a multi-tenant auth system is still assumed, and the Swift app's
presence in the repo is unrelated noise to both.

## Goals

- Retire the Swift/SwiftUI codebase entirely from the repo's active line of development.
- Remove password/Google sign-in; the app runs immediately on first launch with no
  login step, while keeping a deliberate, minimal defense against drive-by requests
  from other software on the same machine.
- Preserve the Dump feature's GitHub/Notion connectors and the `noto-mcp` bridge's PAT
  auth, re-anchored to a single local user instead of a logged-in session.
- Ship `pip install noto-app` → `noto` as the entire installation/onboarding story, with
  no requirement that the user already has Node.js installed.
- Keep the marketing website independently deployable, decoupled from the local app's
  runtime.

## Non-goals

- No rewrite of the server in Python. Python's only role is packaging/distribution; the
  app itself stays Node/TypeScript.
- No migration tooling for the old multi-tenant schema — confirmed no real hosted user
  data exists worth preserving (see brainstorming interview).
- No repo/history split between the marketing site and the app. One repo, one source
  tree, two build outputs (see "Repo & deploy topology").
- No actual `twine upload` to public PyPI, and no attempt to reclaim/acquire the exact
  `noto` name on PyPI. Both are owner-only actions outside this plan's scope.
- No background-daemon mode for `noto` (`start`/`stop`/`status`) — foreground-only for v1.
- No single compiled cross-platform executable (Node SEA/`pkg`) — ruled out because
  `onnxruntime-node`'s native addon does not bundle into that model reliably.

## Locked decisions (from brainstorming interview)

1. **Swift branch fate:** `noto-implementation` branch left untouched as a historical
   reference; not deleted.
2. **Local security model:** keep the existing CSRF double-submit + origin-check
   middleware and a session cookie, auto-provisioned invisibly on first boot. Also bind
   the server to `127.0.0.1` only (additional free hardening, not a replacement for the
   above).
3. **Connectors + PAT/MCP:** GitHub App connector, Notion OAuth connector, and PAT
   tokens all stay, re-anchored to the single local user instead of `req.user`.
4. **Existing deployed data:** clean slate. A Railway deployment existed at some point
   (confirmed via commit history), but no real account data needs migration.
5. **Package name:** `noto` is taken on PyPI (unrelated, abandoned 2023 tool). Publish
   as `noto-app`; the installed console-script is `noto`.
6. **Packaging mechanism:** auto-managed pinned Node.js runtime, fetched and
   checksum-verified on first run, plus one real `npm ci --omit=dev` against the
   vendored lockfile so npm resolves the correct platform-specific `onnxruntime-node`
   binary. No dependency on a system-installed Node.
7. **CLI runtime UX:** `noto` runs the server in the foreground and auto-opens the
   browser, like `jupyter notebook`/`mkdocs serve`. Ctrl+C stops it.
8. **Publish scope:** this plan builds and fully verifies the packaging pipeline
   locally (build wheel → install into a clean venv → run `noto` → confirm it serves
   the real app). Publishing under real PyPI credentials is a manual step taken later,
   by the user.

## Phase 1: Remove the Swift macOS app

### Deletions (from `feat/noto-web-app`)

| Path | Notes |
|------|-------|
| `Sources/` | `NotoCore` + `Noto` targets |
| `Tests/` | `NotoCoreTests` |
| `Checks/` | `NotoCoreChecks` |
| `Package.swift`, `Package.resolved` | SwiftPM manifest |
| `appcast.xml` | Sparkle feed |
| `dist/*.dmg` (4 files) | Currently git-tracked binaries — `git rm`, not just `.gitignore` |
| `scripts/package-noto-dmg.sh` | DMG packaging script |
| `.github/workflows/release.yml` | Sparkle/DMG release pipeline |

### Rewrites

- **Root `README.md`** — drop the "Two apps in one repo" framing; document only the web
  app and the `pip install noto-app` quick start.
- **Root `CLAUDE.md`** — full rewrite. It currently documents the Swift/SwiftUI
  architecture exclusively (targets, source directories, keyboard shortcuts, Sparkle
  release process) — none of which will exist anymore. Replace with the actual
  `landing/` architecture: Express + SQLite server, React/Vite frontend, `noto-mcp`
  bridge, build/test commands (`npm run dev`, `npm test`, `npm run build`), and the new
  `pip install noto-app` packaging layer.

### Repurposed

- `landing/src/download/` (`DownloadPage.tsx`, `Roadmap.tsx`, `ComingSoon.tsx`,
  `NotifyForm.tsx`) currently offers the macOS DMG for download. Becomes the
  `pip install noto-app` install-instructions page.

### Explicitly untouched

- `noto-implementation` branch (historical; per locked decision 1).
- All existing `docs/superpowers/specs/` and `docs/superpowers/plans/` files that
  reference the Swift app — append-only historical record of what was actually built,
  same convention this repo already follows elsewhere.

## Phase 2: Remove sign-in, pivot to local-first single user

### Data model

The `users` table collapses to always exactly one row: a "local owner" auto-provisioned
on first boot if absent. Columns `password_hash`, `google_sub`, `email_verified`, and
`email` are dropped — all four existed only to support login (credential verification,
Google account linking, uniqueness enforcement, password recovery), none of which apply
once there's no login. `display_name`, `avatar_url`, `theme` stay.

The 10 tables carrying a `user_id` FK keep their schema exactly as-is — they simply
always point at the one synthetic user row. This is a deliberate minimal-churn choice
(locked decision 3): re-anchor, don't rip out.

| Table | Change |
|-------|--------|
| `users` | Collapses to one row; drop auth columns |
| `sessions` | Unchanged shape; now always belongs to the singleton user |
| `vaults` | Unchanged |
| `pat_tokens` | Unchanged |
| `audit_log` | Unchanged |
| `memories` | Unchanged |
| `dump_jobs` | Unchanged |
| `dump_sources` | Unchanged |
| `connector_tokens` | Unchanged (GitHub/Notion) |
| `files`, `note_passages` | Unchanged (scoped via `vault_id`, already indirect) |

### Removed

- Routes: `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/google`,
  `GET /api/auth/google/callback`.
- Modules: `landing/server/auth/password.ts`, `landing/server/auth/google.ts`.
- Frontend: `landing/src/onboarding/screens/AccountScreen.tsx`,
  `PasswordScreen.tsx`, and the account/password steps of the onboarding flow. The
  `/get-started` login entry point is deleted; its "how to get started" purpose merges
  into the repurposed install-instructions page from Phase 1.
- `AppRoot.tsx`'s auth gate (`api.me()` → redirect to `/get-started` if `user === null`)
  — replaced with a direct render of `NotoWorkspace`.
- Env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.

### Kept, re-anchored to the singleton user

- `landing/server/auth/session.ts` (session issuance) and `csrf.ts` (double-submit +
  origin check) — session creation moves from a user-initiated `/api/auth/guest` POST
  to automatic provisioning on server boot / first request.
- GitHub App connector routes (`/api/auth/github/install`, `/callback`) and Notion OAuth
  connector routes (`/api/auth/notion/install`, `/callback`) — Dump-feature data
  sources, unrelated to login. `getCurrentUser(req)` now always resolves the singleton
  user rather than reading a login session.
- PAT token routes (`/api/tokens/*`) — the `noto-mcp` bridge's auth mechanism.
  `scripts/mint-pat.mjs` mints a PAT for the singleton user.
- Env vars: `SESSION_SECRET`, `SESSION_COOKIE_NAME`, `SESSION_TTL_DAYS`, all
  `GITHUB_*` and `NOTION_*` connector vars.

### Security default

Server binds `127.0.0.1` only, never `0.0.0.0`, as a network-layer complement to the
retained CSRF/session code (locked decision 2).

### Open detail (non-blocking)

GitHub/Notion connectors require a registered OAuth app (App ID + secret) — inherent to
those providers, not something a local user configures. Default: bake in the project's
own registered app credentials (as today). This means the maintainer needs a real
GitHub App / Notion integration registered before public launch — tracked as a
pre-launch checklist item, not a design blocker. OpenAI keys already have a working
per-vault BYO-key UI (from the multi-vault feature) — packaged local installs reuse
that; no env-file editing required for AI features.

## Phase 3: `pip install noto-app`

### Package identity

- PyPI name: `noto-app` (confirmed available).
- Console-script / CLI command: `noto`.

### Mechanism

A thin Python CLI vendors:
- The prebuilt frontend (`vite build` output, built once at release time — not on the
  user's machine).
- The server's TypeScript source, executed via `tsx` at runtime (matching the existing
  `npm start` pattern — no new server build step invented).
- A production-only `package.json` + matching `package-lock.json` (only runtime deps:
  `express`, `express-rate-limit`, `helmet`, `zod`, `cookie`, `dotenv`, `openai`,
  `@modelcontextprotocol/sdk`, `@huggingface/transformers`, `onnxruntime-node`,
  `graphology`/`graphology-communities-louvain`, `tsx`).

The exact Node.js version to pin is chosen during implementation (current LTS at build
time, verified against `node:sqlite` stability — local dev already runs v24) and
recorded in `node_runtime.py`; it is not a design-time guess.

First run:
1. Detect OS/arch (`platform.system()`/`platform.machine()`).
2. Download the pinned Node.js build for that platform from nodejs.org, verify against
   the published SHA256SUMS, extract into `~/.noto/runtime/node-<version>-<platform>/`.
3. Run `npm ci --omit=dev` once against the vendored lockfile inside a per-install
   runtime directory — this is what makes npm resolve the correct prebuilt
   `onnxruntime-node` binary for the user's actual machine (locked decision 6; this is
   why a single compiled executable was ruled out).
4. Launch `node`/`tsx` against the server entry point.

Subsequent runs skip steps 2–3 (cached) and launch directly.

### Runtime UX

`noto` runs the server in the foreground, auto-opens the default browser to
`http://127.0.0.1:<port>`, and stops on Ctrl+C (locked decision 7). Local data (SQLite
DB, uploaded files) lives in the OS-standard per-user data directory —
`~/Library/Application Support/noto` (macOS), `~/.local/share/noto` (Linux),
`%APPDATA%\noto` (Windows) — kept separate from both the cached Node runtime and the
installed package itself.

### Layout

New top-level directory `packaging/pypi/`, kept separate from `landing/`'s npm tooling
so the two ecosystems' build systems don't tangle:

| Path | Responsibility |
|------|-----------------|
| `packaging/pypi/pyproject.toml` | Python package manifest |
| `packaging/pypi/noto_app/cli.py` | Entry point: orchestrates runtime fetch, first-run `npm ci`, launch, browser open |
| `packaging/pypi/noto_app/node_runtime.py` | Platform/arch detection, download, checksum verify, cache under `~/.noto/runtime/` |
| `packaging/pypi/noto_app/paths.py` | Resolves the OS-appropriate user-data directory |
| `packaging/pypi/noto_app/_vendor/` | Staged build output: prebuilt frontend + server source + production `package.json`/lockfile (populated by the build script, not hand-maintained) |
| `packaging/pypi/scripts/build_bundle.py` (or `.mjs`) | Release-time script: runs `landing/`'s frontend build, prunes to production-only server deps, stages `_vendor/`, bumps version |

### Scope

This plan builds and fully verifies the pipeline locally: build the wheel, `pip
install` it into a clean virtualenv, run `noto`, confirm it serves the real app
end-to-end (loads the workspace, hits the API, persists a note). Actual `twine upload`
to public PyPI is a manual step the user takes later, under their own credentials
(locked decision 8).

## Repo & deploy topology

One repo, one source tree — no history split between marketing site and app.

- **Marketing site** (`index.html`, `features.html`, the repurposed `download.html`)
  keeps building via the existing Vite multi-page setup and stays independently
  deployable as a hosted site. Its backing server shrinks to only what marketing needs
  (e.g. the waitlist form in `NotifyForm.tsx`) — no more account routes.
- **Local app** (`app.html` → `AppRoot` → `NotoWorkspace`, plus the full `/api/*` server
  minus the deleted login routes) is what Phase 3's build script vendors into the pip
  package.
- Same source, two independent build/deploy outputs.
- Optional, explicitly out of scope for this plan: renaming `landing/` to something
  like `app/` now that it's mostly not "landing" anymore. Large-diff rename with no
  functional benefit — a separate cleanup if ever done.

## Testing strategy

- Existing Vitest suite updated for removed auth routes/tables (delete tests for
  signup/login/Google OAuth; add/adjust tests asserting the singleton-user behavior)
  rather than rewritten wholesale.
- New coverage: auto-provisioning of the singleton local user on first boot; CSRF/session
  behavior with no login step; GitHub/Notion connector routes resolving the singleton
  user correctly; PAT minting for the singleton user.
- Packaging: unit-testable pieces of `node_runtime.py` (platform/arch → URL mapping,
  checksum verification) mocked in tests; the Node download + `npm ci` + launch flow
  itself verified manually (build wheel → clean venv → `pip install` → run `noto` →
  confirm the app is reachable and functional), since it depends on real network and
  filesystem state.

## Rollout / sequencing

Phases execute strictly in order — each is a clean prerequisite for the next:

1. **Phase 1** (Swift removal) first: removes unrelated noise before touching the web
   app's own architecture.
2. **Phase 2** (local-first pivot) second: packaging in Phase 3 assumes no server-side
   accounts to worry about.
3. **Phase 3** (pip packaging) last: depends on Phase 2's simplified, single-user
   server being the thing that gets vendored.

## Open follow-ups (non-blocking)

- Maintainer must register a real GitHub App / Notion integration before public launch
  if connector credentials aren't already production-ready (Phase 2 open detail).
- Actual PyPI publish (`twine upload`) and any attempt to acquire the `noto` name
  itself are manual, owner-only actions outside this plan.
- Optional `landing/` → `app/` rename, if desired later.
