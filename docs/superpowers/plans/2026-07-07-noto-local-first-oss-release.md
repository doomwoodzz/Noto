# Noto Local-First Open-Source Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the Swift macOS app, remove the web app's sign-in system in favor of one implicit local user, and package the web app as `pip install noto-app` → `noto`.

**Architecture:** Three ordered phases. Phase 1 deletes the Swift package and its release pipeline and rewrites the two docs that describe it. Phase 2 collapses the multi-tenant `users` table to a single auto-provisioned "local owner," adds a session-auto-provisioning middleware so no login step is ever visible, and deletes the password/Google sign-in code while keeping the GitHub/Notion connectors and PAT/MCP auth (both already just call `getCurrentUser`/check bearer tokens, so they need no code changes — only the tests that assumed multiple accounts do). Phase 3 adds a `packaging/pypi/` Python package whose CLI downloads a pinned, checksum-verified Node.js runtime on first run, runs one real `npm ci` against a vendored production-only server bundle (so npm resolves the correct native `onnxruntime-node` binary for the user's machine), and launches the app in the foreground.

**Tech Stack:** Existing: Node 24 + Express 5 + `node:sqlite` + React 19 + Vite 8 + TypeScript + Vitest, all under `landing/`. New: Python 3.9+ (`packaging/pypi/`), `setuptools`, no new Python third-party dependencies (stdlib `urllib`/`subprocess`/`pathlib` only).

**Reference spec:** [`docs/superpowers/specs/2026-07-06-noto-local-first-oss-release-design.md`](../specs/2026-07-06-noto-local-first-oss-release-design.md)

---

## Phase 1: Remove the Swift macOS app

### Task 1: Delete the Swift package, build artifacts, and release pipeline

**Files:**
- Delete: `Sources/`, `Tests/`, `Checks/`, `Package.swift`, `Package.resolved`, `appcast.xml`
- Delete: `dist/Noto-20260516-101332.dmg`, `dist/Noto-20260516-130114.dmg`, `dist/Noto-dark-theme.dmg`, `dist/Noto.dmg` (git-tracked despite `dist/` being gitignored — pre-existing tracked files aren't retroactively untracked by a `.gitignore` entry)
- Delete: `scripts/package-noto-dmg.sh`
- Delete: `.github/workflows/release.yml`

- [ ] **Step 1: Confirm nothing in the surviving codebase references these paths**

Run:
```bash
grep -rn "Sources/Noto\|Package\.swift\|package-noto-dmg\|NotoCoreChecks" landing/ noto-mcp/ --include="*.ts" --include="*.tsx" --include="*.json" --include="*.mjs" --include="*.mts" 2>/dev/null | grep -v node_modules
```
Expected: no output.

- [ ] **Step 2: Delete the Swift package and its release pipeline**

Run:
```bash
git rm -r Sources Tests Checks
git rm Package.swift Package.resolved appcast.xml
git rm dist/Noto-20260516-101332.dmg dist/Noto-20260516-130114.dmg dist/Noto-dark-theme.dmg dist/Noto.dmg
git rm scripts/package-noto-dmg.sh
git rm .github/workflows/release.yml
```
Expected: all listed paths staged for deletion (`git status` shows them as `D`).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove the Swift macOS app

Superseded by the actively-developed web app under landing/. The
noto-implementation branch keeps the full Swift source as a historical
reference and is left untouched."
```

### Task 2: Rewrite the root README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the full file content**

The current README describes "two apps in one repo" (Swift + web). Replace its entire content with:

```markdown
# Noto

A local-first Markdown notes workspace with an AI lecture-listening assistant.

> **When you listen, Noto remembers.**

Noto runs entirely on your own machine. There are no accounts, no sign-in, and no
hosted server to operate — your notes live in a local SQLite database and nothing
leaves your computer except the optional AI/connector calls you explicitly configure.

## Install

```bash
pip install noto-app
noto
```

This opens Noto in your browser at `http://127.0.0.1:8787`. The first run downloads a
small, checksum-verified Node.js runtime (Noto itself is a Node/TypeScript app under
the hood); later runs start instantly. No separate Node.js install is required.

## Features

- **Markdown notes** with `[[wiki-links]]` and automatically generated backlinks.
- **Knowledge Web** graph view of how your notes connect.
- **Smart Search** — semantic search running locally with MiniLM embeddings.
- **AI lecture assistant** — an OpenAI-backed layer for chat, flashcards, find-links,
  and lecture support (bring your own API key).
- **Dump** — a bulk-import pipeline (paste, upload, GitHub, Notion) that turns source
  material into atomic notes.
- **Connectors** — optional GitHub App and Notion OAuth integrations for Dump.
- **MCP bridge** — expose your workspace to MCP-compatible tools (Claude Code, Cursor,
  Codex) via `noto-mcp`.

## Developing

Requires [Node.js](https://nodejs.org) 24+.

```bash
cd landing
npm install
npm run dev          # starts the Vite client + Express API together
npm test             # runs the test suite
```

AI features and connectors are optional and gated on environment variables — see
[`landing/.env.example`](landing/.env.example).

## Local-first

Your data stays on your device: the server persists everything to a local SQLite
database (under `landing/server/data/` in development, or your OS's standard app-data
directory when installed via `pip install noto-app`). AI and connector features only
reach out when you configure their keys.

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for the local-first web app only"
```

### Task 3: Rewrite CLAUDE.md for the actual architecture

**Files:**
- Modify: `CLAUDE.md`

The current file documents the Swift/SwiftUI architecture exclusively — none of which
exists after Task 1. This is the file that governs how Claude Code works in this repo,
so it needs to describe what's actually here.

- [ ] **Step 1: Replace the full file content**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rewrite CLAUDE.md for the web app + pip packaging architecture"
```

### Task 4: Repurpose the download page for `pip install`

**Files:**
- Modify: `landing/download.html`
- Modify: `landing/src/shared/release.ts`
- Modify: `landing/src/download/DownloadPage.tsx`
- Create: `landing/src/download/InstallInstructions.tsx`
- Delete: `landing/src/download/ComingSoon.tsx`, `landing/src/download/useCountdown.ts`, `landing/src/download/NotifyForm.tsx`, `landing/src/download/notify.ts`

`Roadmap.tsx`/`CardModal.tsx`/`roadmapData.ts` are a separate "what's shipping next"
feature, not DMG-specific — left untouched. `roadmapData.ts` imports `RELEASE_LABEL`
from `shared/release.ts`, which stays.

- [ ] **Step 1: Update `shared/release.ts`**

Read the current file first (`landing/src/shared/release.ts`), then replace the
`DOWNLOAD_URL` export (the only macOS-DMG-specific piece — `VERSION`/`VERSION_LABEL`/
`RELEASE_DATE`/`RELEASE_LABEL` are still meaningful and used by `Hero.tsx`,
`FeaturesHero.tsx`, and `roadmapData.ts`, so keep them unchanged):

Old:
```ts
/** Real macOS build URL once the app ships. Empty string = not yet downloadable,
 *  so the launched state keeps the email-the-link form instead of a dead button. */
export const DOWNLOAD_URL = "";
```

New:
```ts
/** PyPI package name and the one-line install command shown on the install page. */
export const PIP_PACKAGE_NAME = "noto-app";
export const PIP_INSTALL_COMMAND = `pip install ${PIP_PACKAGE_NAME}`;
```

- [ ] **Step 2: Delete the countdown/notify files (their only reason to exist —
      pre-launch anticipation — no longer applies once install works today)**

```bash
git rm landing/src/download/ComingSoon.tsx landing/src/download/useCountdown.ts landing/src/download/NotifyForm.tsx landing/src/download/notify.ts
```

- [ ] **Step 3: Create `landing/src/download/InstallInstructions.tsx`**

```tsx
import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { VERSION_LABEL, PIP_INSTALL_COMMAND } from "../shared/release";

export function InstallInstructions() {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(PIP_INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the command is still selectable text */
    }
  }

  return (
    <section className="cs-hero" id="download">
      <div className="l-shell">
        <div className="cs-hero-head">
          <div className="cs-eyebrow">
            <span className="cs-eyebrow-dot" />
            {VERSION_LABEL} — Available now
          </div>
          <h1 className="cs-title">
            Install with <em>one command.</em>
          </h1>
          <p className="cs-sub">
            Noto runs entirely on your machine. No accounts, no cloud lock-in, no
            server to operate — your vault stays on disk.
          </p>
        </div>

        <div className="cs-grid">
          <div className="cs-grid-cell cs-cell-timer">
            <div className="cs-timer-label">
              <span className="cs-timer-label-bar" /> Requires Python 3.9+
            </div>
            <button className="cs-install-cmd" onClick={copyCommand} type="button">
              <Terminal size={15} strokeWidth={1.7} />
              <code>{PIP_INSTALL_COMMAND}</code>
              {copied ? <Check size={14} strokeWidth={2.4} /> : <Copy size={14} strokeWidth={1.7} />}
            </button>
            <p className="cs-launch-note">
              Then run <code>noto</code>. The first launch downloads a small,
              checksum-verified Node.js runtime automatically — no separate Node.js
              install required.
            </p>
          </div>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="cs-grid-cell is-empty" />
          ))}
        </div>

        <div className="cs-grid-foot">
          <div className="cs-grid-foot-meta">
            <span>Free and open source</span>
            <span className="l-hero-meta-dot" />
            <span>macOS · Linux · Windows</span>
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Add the `.cs-install-cmd` style**

Read `landing/src/styles/coming-soon.css` first, then append (reusing the existing
`.cs-*` design tokens/variables already defined earlier in that file — match whatever
spacing/color variables the surrounding `.cs-timer-unit`/`.l-btn` rules already use
rather than inventing new ones):

```css
.cs-install-cmd {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.85rem 1.1rem;
  border-radius: 10px;
  border: 1px solid var(--cs-border, rgba(255, 255, 255, 0.12));
  background: var(--cs-code-bg, rgba(0, 0, 0, 0.25));
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.cs-install-cmd code {
  flex: 1;
  text-align: left;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 0.95rem;
}
```

(If `--cs-border`/`--cs-code-bg` aren't already defined as CSS variables in this file,
use the literal color values the neighboring `.cs-grid-cell`/`.cs-timer` rules use
instead, so the new element matches the existing dark card styling.)

- [ ] **Step 5: Update `DownloadPage.tsx`**

Read the current file, then replace the `ComingSoon` import and usage with
`InstallInstructions`:

```tsx
import { useState } from "react";
import { Nav } from "../landing/Nav";
import { Footer } from "../landing/Footer";
import { useTheme } from "../landing/useTheme";
import { InstallInstructions } from "./InstallInstructions";
import { Roadmap } from "./Roadmap";
import { CardModal } from "./CardModal";
import type { RoadmapCard } from "./roadmapData";

export function DownloadPage() {
  const [theme, setTheme] = useTheme();
  const [active, setActive] = useState<RoadmapCard | null>(null);
  return (
    <div className="l-page">
      <Nav theme={theme} setTheme={setTheme} />
      <InstallInstructions />
      <Roadmap onOpen={setActive} />
      <Footer />
      {active && <CardModal card={active} onClose={() => setActive(null)} />}
    </div>
  );
}
```

- [ ] **Step 6: Update `download.html` metadata**

Read the file, then replace the `<title>`/`<meta description>`/`og:*` tags (currently
"Coming June 20" framing) with:

```html
    <title>Download — Noto · pip install noto-app</title>
    <meta name="description" content="Install Noto with one command: pip install noto-app. Local-first, no accounts, runs entirely on your machine." />
    <meta property="og:title" content="Noto — Install with one command" />
    <meta property="og:description" content="pip install noto-app. Local-first, no accounts, runs entirely on your machine." />
```

- [ ] **Step 7: Verify and commit**

Run:
```bash
cd landing && npm run lint && npx tsc -b --noEmit
```
Expected: no errors (confirms no dangling imports of the deleted files).

```bash
git add -A
git commit -m "feat(marketing): repurpose the download page for pip install noto-app"
```

---

## Phase 2: Remove sign-in, pivot to local-first

### Task 5: Collapse the `users` table to a single local owner

**Files:**
- Modify: `landing/server/db.ts`
- Test: `landing/server/db.test.ts` (create if it doesn't already exist — check first with `ls landing/server/db*.test.ts`)

- [ ] **Step 1: Write the failing test**

If `landing/server/db.test.ts` already exists, read it first and add this test inside
its existing structure (matching its existing imports/setup pattern for a temp
`DATABASE_PATH`). If it doesn't exist, create it:

```ts
// landing/server/db.test.ts
import { describe, expect, it } from "vitest";
import { ensureLocalOwner, getUserById, setUserTheme, toPublicUser } from "./db.ts";

describe("local owner", () => {
  it("creates exactly one user row on first call and reuses it thereafter", () => {
    const first = ensureLocalOwner();
    const second = ensureLocalOwner();
    expect(second.id).toBe(first.id);
  });

  it("exposes only the local-first fields on the public shape", () => {
    const owner = ensureLocalOwner();
    setUserTheme(owner.id, "dark");
    const reloaded = getUserById(owner.id)!;
    const pub = toPublicUser(reloaded);
    expect(pub).toEqual({
      id: owner.id,
      displayName: reloaded.display_name,
      avatarUrl: reloaded.avatar_url,
      theme: "dark",
    });
    expect(pub).not.toHaveProperty("email");
    expect(pub).not.toHaveProperty("emailVerified");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd landing && npx vitest run server/db.test.ts`
Expected: FAIL — `ensureLocalOwner` is not exported from `./db.ts`.

- [ ] **Step 3: Replace the `users` table definition**

In `landing/server/db.ts`, find the `CREATE TABLE IF NOT EXISTS users (...)` block
(the first table in the big `db.exec` call near the top) and replace it:

Old:
```ts
  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT,                       -- null for OAuth-only accounts
    google_sub      TEXT UNIQUE,                -- Google subject id, if linked
    display_name    TEXT,
    avatar_url      TEXT,
    theme           TEXT NOT NULL DEFAULT 'light',
    email_verified  INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );
```

New:
```ts
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    display_name TEXT,
    avatar_url   TEXT,
    theme        TEXT NOT NULL DEFAULT 'light',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
```

- [ ] **Step 4: Add the merge-and-rebuild migration for existing databases**

Immediately after that same `db.exec(...)` block closes (right before the existing
`// Additive migration: older databases predate the pinned column.` comment for
`files.pinned`), insert a new migration block:

```ts
// Additive migration: collapse multi-tenant accounts into a single local owner.
// Older DBs had password_hash/google_sub/email columns (removed — login no longer
// exists). Any existing user rows (e.g. dev guest accounts) are merged onto one
// surviving id first so their vaults/tokens/etc. are preserved, then the table is
// rebuilt without the auth-only columns.
{
  const cols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === "password_hash")) {
    db.exec("BEGIN");
    try {
      const existing = db
        .prepare(
          "SELECT id, display_name, avatar_url, theme, created_at, updated_at FROM users ORDER BY created_at ASC",
        )
        .all() as Array<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        theme: string;
        created_at: number;
        updated_at: number;
      }>;

      db.exec(`
        CREATE TABLE users_new (
          id           TEXT PRIMARY KEY,
          display_name TEXT,
          avatar_url   TEXT,
          theme        TEXT NOT NULL DEFAULT 'light',
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL
        )
      `);

      if (existing.length > 0) {
        const owner = existing[0];
        db.prepare(
          "INSERT INTO users_new (id, display_name, avatar_url, theme, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(owner.id, owner.display_name, owner.avatar_url, owner.theme, owner.created_at, owner.updated_at);

        // Re-point every other pre-existing user's rows onto the surviving owner id.
        for (const row of existing.slice(1)) {
          db.prepare("UPDATE vaults SET user_id = ? WHERE user_id = ?").run(owner.id, row.id);
          db.prepare("UPDATE pat_tokens SET user_id = ? WHERE user_id = ?").run(owner.id, row.id);
          db.prepare("UPDATE audit_log SET user_id = ? WHERE user_id = ?").run(owner.id, row.id);
          db.prepare("UPDATE memories SET user_id = ? WHERE user_id = ?").run(owner.id, row.id);
          db.prepare("UPDATE dump_jobs SET user_id = ? WHERE user_id = ?").run(owner.id, row.id);
          db.prepare("UPDATE dump_sources SET user_id = ? WHERE user_id = ?").run(owner.id, row.id);
          db.prepare("UPDATE connector_tokens SET user_id = ? WHERE user_id = ?").run(owner.id, row.id);
          db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);
        }
      }

      db.exec("DROP TABLE users");
      db.exec("ALTER TABLE users_new RENAME TO users");
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
```

- [ ] **Step 5: Replace the `User`/`PublicUser` interfaces and `toPublicUser`**

Find (near the bottom third of the file, after the migrations):

Old:
```ts
export interface User {
  id: string;
  email: string;
  password_hash: string | null;
  google_sub: string | null;
  display_name: string | null;
  avatar_url: string | null;
  theme: string;
  email_verified: number;
  created_at: number;
  updated_at: number;
}
```
```ts
/** A user shape that is safe to send to the browser (no secrets). */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  theme: string;
  emailVerified: boolean;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    theme: u.theme,
    emailVerified: Boolean(u.email_verified),
  };
}
```

New:
```ts
export interface User {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  theme: string;
  created_at: number;
  updated_at: number;
}
```
```ts
/** A user shape that is safe to send to the browser (no secrets — there are none). */
export interface PublicUser {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  theme: string;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    theme: u.theme,
  };
}
```

- [ ] **Step 6: Replace the user accessor functions**

Find the `/* ----------------------------- Users ----------------------------- */`
section. Replace the whole block from `stmtUserByEmail` through the end of
`linkGoogleToUser` with:

Old:
```ts
const stmtUserByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
const stmtUserById = db.prepare("SELECT * FROM users WHERE id = ?");
const stmtUserByGoogle = db.prepare("SELECT * FROM users WHERE google_sub = ?");

export function getUserByEmail(email: string): User | undefined {
  return stmtUserByEmail.get(email.toLowerCase()) as User | undefined;
}
export function getUserById(id: string): User | undefined {
  return stmtUserById.get(id) as User | undefined;
}
export function getUserByGoogleSub(sub: string): User | undefined {
  return stmtUserByGoogle.get(sub) as User | undefined;
}

const stmtInsertUser = db.prepare(`
  INSERT INTO users
    (id, email, password_hash, google_sub, display_name, avatar_url, theme, email_verified, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function createUser(input: {
  email: string;
  passwordHash?: string | null;
  googleSub?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  theme?: string;
  emailVerified?: boolean;
}): User {
  const id = newId();
  const ts = now();
  stmtInsertUser.run(
    id,
    input.email.toLowerCase(),
    input.passwordHash ?? null,
    input.googleSub ?? null,
    input.displayName ?? null,
    input.avatarUrl ?? null,
    input.theme ?? "light",
    input.emailVerified ? 1 : 0,
    ts,
    ts,
  );
  return getUserById(id)!;
}

const stmtSetTheme = db.prepare("UPDATE users SET theme = ?, updated_at = ? WHERE id = ?");
export function setUserTheme(id: string, theme: string): void {
  stmtSetTheme.run(theme, now(), id);
}

const stmtLinkGoogle = db.prepare(
  "UPDATE users SET google_sub = ?, avatar_url = COALESCE(avatar_url, ?), display_name = COALESCE(display_name, ?), email_verified = 1, updated_at = ? WHERE id = ?",
);
export function linkGoogleToUser(
  id: string,
  sub: string,
  avatarUrl: string | null,
  displayName: string | null,
): void {
  stmtLinkGoogle.run(sub, avatarUrl, displayName, now(), id);
}
```

New:
```ts
const stmtUserById = db.prepare("SELECT * FROM users WHERE id = ?");
const stmtFirstUser = db.prepare("SELECT * FROM users LIMIT 1");
const stmtInsertOwner = db.prepare(
  "INSERT INTO users (id, display_name, avatar_url, theme, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
);

export function getUserById(id: string): User | undefined {
  return stmtUserById.get(id) as User | undefined;
}

/**
 * Return the single local-owner user, creating it on first boot if absent.
 * There is exactly one user row for the lifetime of a Noto install — see the
 * `users` migration above and `server/auth/localSession.ts`.
 */
export function ensureLocalOwner(): User {
  const existing = stmtFirstUser.get() as User | undefined;
  if (existing) return existing;
  const id = newId();
  const ts = now();
  stmtInsertOwner.run(id, "Local Owner", null, "light", ts, ts);
  return getUserById(id)!;
}

const stmtSetTheme = db.prepare("UPDATE users SET theme = ?, updated_at = ? WHERE id = ?");
export function setUserTheme(id: string, theme: string): void {
  stmtSetTheme.run(theme, now(), id);
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd landing && npx vitest run server/db.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Run the full server type-check to catch every remaining caller**

Run: `cd landing && npx tsc -p tsconfig.server.json --noEmit`
Expected: FAILS, listing every file that still imports `getUserByEmail`,
`getUserByGoogleSub`, `createUser`, or `linkGoogleToUser`. Do not fix these yet —
Task 6 removes their only callers. Confirm the error list only names
`auth/routes.ts` and `auth/google.ts` (their sole remaining callers) before moving
on — `auth/password.ts` is unrelated to this error (it doesn't import from `db.ts`
at all) and is deleted in Task 6 for a separate reason (it becomes dead code once
`routes.ts` stops importing it).

- [ ] **Step 9: Commit**

```bash
git add landing/server/db.ts landing/server/db.test.ts
git commit -m "feat(auth): collapse the users table to a single local owner

Multi-tenant auth columns (password_hash, google_sub, email, email_verified)
are dropped. Existing rows (e.g. dev guest accounts) are merged onto one
surviving id so vaults/tokens/etc. are preserved. This is an intermediate
commit — server/auth/routes.ts still references the removed functions until
the next task."
```

### Task 6: Auto-provision a local session; remove password/Google sign-in

**Files:**
- Create: `landing/server/auth/localSession.ts`
- Modify: `landing/server/app.ts`
- Modify: `landing/server/auth/routes.ts`
- Delete: `landing/server/auth/password.ts`, `landing/server/auth/google.ts`
- Delete: `landing/server/auth/password.test.ts`, `landing/server/auth/google.test.ts` (check they exist first with `ls landing/server/auth/*.test.ts`; delete whichever of these two exist)

- [ ] **Step 1: Write the failing test**

Create `landing/server/auth/localSession.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../app.ts";

let server: Server;
let baseURL = "";

async function withApp<T>(fn: (baseURL: string) => Promise<T>): Promise<T> {
  const app = createApp();
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseURL = `http://127.0.0.1:${port}`;
  try {
    return await fn(baseURL);
  } finally {
    server.close();
  }
}

describe("local session auto-provisioning", () => {
  it("attaches a session to a completely fresh request with no cookies", async () => {
    await withApp(async (url) => {
      const res = await fetch(`${url}/api/auth/me`, {
        headers: { Origin: "http://localhost:5173" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: { id: string } | null };
      expect(body.user?.id).toBeTruthy();
      expect(res.headers.getSetCookie().some((c) => c.startsWith("noto_session="))).toBe(true);
    });
  });

  it("resolves two different cookie-less clients to the same local owner", async () => {
    await withApp(async (url) => {
      const a = (await (await fetch(`${url}/api/auth/me`, { headers: { Origin: "http://localhost:5173" } })).json()) as {
        user: { id: string } | null;
      };
      const b = (await (await fetch(`${url}/api/auth/me`, { headers: { Origin: "http://localhost:5173" } })).json()) as {
        user: { id: string } | null;
      };
      expect(a.user?.id).toBe(b.user?.id);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd landing && npx vitest run server/auth/localSession.test.ts`
Expected: FAIL — `/api/auth/me` currently 401s with no session cookie (no
auto-provisioning exists yet).

- [ ] **Step 3: Create `landing/server/auth/localSession.ts`**

```ts
/**
 * Local-first session provisioning.
 *
 * Noto has no accounts: every browser request is transparently attached to a
 * single local-owner user. This mirrors what the old `/api/auth/guest` route
 * did on demand, except it now happens automatically for any request that
 * doesn't already carry a valid session cookie, so there is no visible
 * sign-in step. PAT-authenticated requests (MCP/CLI clients) are unaffected —
 * they carry no cookies and never go through session/CSRF at all.
 */
import type { Request, Response, NextFunction } from "express";
import { ensureLocalOwner } from "../db.ts";
import { createSession, getCurrentUser } from "./session.ts";

export function ensureLocalSession(req: Request, res: Response, next: NextFunction): void {
  if (!req.apiUser && !getCurrentUser(req)) {
    const owner = ensureLocalOwner();
    createSession(req, res, owner.id);
  }
  next();
}
```

- [ ] **Step 4: Wire it into `app.ts`**

In `landing/server/app.ts`, add the import alongside the other auth imports:

Old:
```ts
import { ensureCsrfCookie, csrfProtection } from "./auth/csrf.ts";
import { resolveApiToken } from "./auth/pat.ts";
```

New:
```ts
import { ensureCsrfCookie, csrfProtection } from "./auth/csrf.ts";
import { resolveApiToken } from "./auth/pat.ts";
import { ensureLocalSession } from "./auth/localSession.ts";
```

Then, in the same file, insert the middleware right after `resolveApiToken` is
mounted and before the CSRF block:

Old:
```ts
  app.use("/api", resolveApiToken); // resolve bearer PAT → req.apiUser (before CSRF)

  /* --------------------------------- CSRF -------------------------------- */
```

New:
```ts
  app.use("/api", resolveApiToken); // resolve bearer PAT → req.apiUser (before CSRF)
  app.use("/api", ensureLocalSession); // no accounts: auto-attach the local owner

  /* --------------------------------- CSRF -------------------------------- */
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd landing && npx vitest run server/auth/localSession.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Replace `auth/routes.ts`**

Read the current file first, then replace its entire content:

```ts
/**
 * Auth API routes.
 *
 * Noto has no accounts — every request is already attached to the single
 * local owner by the time it reaches these routes (see auth/localSession.ts).
 * What's left here is theme preference and the connector OAuth flows (GitHub
 * App / Notion), which link external services to that one local user.
 */
import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import { setUserTheme, toPublicUser } from "../db.ts";
import { getCurrentUser } from "./session.ts";
import { startGithubInstall, handleGithubCallback } from "./github.ts";
import { startNotionInstall, handleNotionCallback } from "./notion.ts";

export const authRouter = Router();

authRouter.use(express.json({ limit: "16kb" }));

authRouter.get("/me", (req: Request, res: Response) => {
  const user = getCurrentUser(req)!; // ensureLocalSession guarantees this
  res.json({ user: toPublicUser(user) });
});

const prefsSchema = z.object({ theme: z.enum(["light", "dark"]) });

authRouter.patch("/preferences", (req: Request, res: Response) => {
  const user = getCurrentUser(req)!;
  const parsed = prefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid preferences" });
    return;
  }
  setUserTheme(user.id, parsed.data.theme);
  res.json({ ok: true });
});

/* ------------------------------ GitHub App ----------------------------- */
authRouter.get("/github/install", startGithubInstall);
authRouter.get("/github/callback", handleGithubCallback);

/* ------------------------------ Notion OAuth --------------------------- */
authRouter.get("/notion/install", startNotionInstall);
authRouter.get("/notion/callback", handleNotionCallback);
```

- [ ] **Step 7: Delete the password and Google OAuth modules**

```bash
ls landing/server/auth/*.test.ts   # check which of these two exist before deleting
git rm landing/server/auth/password.ts landing/server/auth/google.ts
git rm landing/server/auth/password.test.ts 2>/dev/null || true
git rm landing/server/auth/google.test.ts 2>/dev/null || true
```

- [ ] **Step 8: Run the full server type-check**

Run: `cd landing && npx tsc -p tsconfig.server.json --noEmit`
Expected: PASS cleanly. `env.ts`/`index.ts`/`app.ts` still reference
`env.googleConfigured` at this point, but that field still exists (it's only
removed in Task 7) so this is not an error yet. If the check instead fails
naming `getUserByEmail`/`getUserByGoogleSub`/`createUser`/`linkGoogleToUser`/
`hashPassword`/`verifyPassword`/`startGoogleLogin`/`handleGoogleCallback`, some
caller of the deleted functions/modules was missed — search with
`grep -rn "getUserByEmail\|getUserByGoogleSub\|linkGoogleToUser\|hashPassword\|verifyPassword" landing/server --include="*.ts"`
and remove it.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(auth): auto-provision the local session; remove password/Google sign-in

ensureLocalSession attaches the single local owner to every request before
routes run, so /api/auth/me and every downstream route (notes, dump, ai,
memory, etc.) needs no changes — they already just call getCurrentUser().
GitHub/Notion connector routes are unaffected for the same reason."
```

### Task 7: Trim `env.ts` and `index.ts`; bind loopback only

**Files:**
- Modify: `landing/server/env.ts`
- Modify: `landing/server/index.ts`
- Modify: `landing/.env.example`

- [ ] **Step 1: Remove Google config from the env schema**

In `landing/server/env.ts`, delete this block from the zod schema:

```ts
  /** Google OAuth — optional; the button is inert until these are provided. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),

```

And remove the computed flag:

Old:
```ts
export const env = {
  ...raw,
  isProd,
  SESSION_SECRET: sessionSecret,
  googleConfigured: Boolean(
    raw.GOOGLE_CLIENT_ID && raw.GOOGLE_CLIENT_SECRET && raw.GOOGLE_REDIRECT_URI,
  ),
  openaiConfigured: Boolean(raw.OPENAI_API_KEY),
```

New:
```ts
export const env = {
  ...raw,
  isProd,
  SESSION_SECRET: sessionSecret,
  openaiConfigured: Boolean(raw.OPENAI_API_KEY),
```

- [ ] **Step 2: Update `index.ts`: drop the Google log line, bind loopback only**

Old:
```ts
app.listen(env.PORT, () => {
  console.log(`▶ Noto server on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  if (!env.googleConfigured) {
    console.log("  Google OAuth: not configured (set GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI to enable).");
  }
  warm();
```

New:
```ts
const HOST = "127.0.0.1";
app.listen(env.PORT, HOST, () => {
  console.log(`▶ Noto server on http://${HOST}:${env.PORT} (${env.NODE_ENV})`);
  warm();
```

- [ ] **Step 3: Remove the Google block from `app.ts`'s CSP and `/api/health`**

In `landing/server/app.ts`, the CSP's `connectSrc`/`formAction`/`imgSrc` include
Google-specific origins now that Google sign-in doesn't exist:

Old:
```ts
  const scriptSrc = ["'self'", "'wasm-unsafe-eval'"];
  const connectSrc = [
    "'self'",
    "https://accounts.google.com",
    "https://github.com",
    "https://api.github.com",
    "https://api.notion.com",
  ];
```

New:
```ts
  const scriptSrc = ["'self'", "'wasm-unsafe-eval'"];
  const connectSrc = [
    "'self'",
    "https://github.com",
    "https://api.github.com",
    "https://api.notion.com",
  ];
```

And:
```ts
          imgSrc: ["'self'", "data:", "https://lh3.googleusercontent.com"],
```
becomes:
```ts
          imgSrc: ["'self'", "data:"],
```

And:
```ts
          formAction: ["'self'", "https://accounts.google.com"],
```
becomes:
```ts
          formAction: ["'self'"],
```

And in `/api/health`:
Old:
```ts
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, googleConfigured: env.googleConfigured, aiConfigured: env.openaiConfigured });
  });
```
New:
```ts
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, aiConfigured: env.openaiConfigured });
  });
```

- [ ] **Step 4: Update `.env.example`**

In `landing/.env.example`, delete the `## Google OAuth (optional)` section entirely:

```
# ── Google OAuth (optional) ───────────────────────────────────────────────────
# The "Continue with Google" button stays inert until all three are set.
# Create credentials at https://console.cloud.google.com/apis/credentials
# Authorised redirect URI must equal GOOGLE_REDIRECT_URI below.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:8787/api/auth/google/callback

```

- [ ] **Step 5: Run the full server type-check + test suite**

Run:
```bash
cd landing
npx tsc -p tsconfig.server.json --noEmit
npx vitest run server/
```
Expected: type-check passes. The test run will show failures from tests that still
call the now-deleted `/api/auth/signup` or assert cross-user isolation — that is
expected and fixed in Task 10. Confirm no *new* categories of failure appear beyond
what Task 10 already anticipates (auth-flow tests and isolation tests).

- [ ] **Step 6: Commit**

```bash
git add landing/server/env.ts landing/server/index.ts landing/server/app.ts landing/.env.example
git commit -m "chore(server): remove Google OAuth config; bind the server to loopback only"
```

### Task 8: Simplify the frontend auth gate

**Files:**
- Modify: `landing/src/app/AppRoot.tsx`
- Modify: `landing/src/app/api.ts`
- Modify: `landing/src/app/NotoWorkspace.tsx`
- Modify: `landing/src/workspace/types.ts`
- Modify: `landing/src/workspace/Sidebar.tsx`
- Modify: `landing/src/workspace/NotoWindow.tsx`

- [ ] **Step 1: Update `PublicUser` in `landing/src/app/api.ts`**

Old:
```ts
export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  theme: "light" | "dark" | string;
  emailVerified: boolean;
}
```

New:
```ts
export interface PublicUser {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  theme: "light" | "dark" | string;
}
```

Also remove the now-dead `logout` client call:

Old:
```ts
export const api = {
  /* auth */
  me: () => request<{ user: PublicUser | null }>("GET", "/api/auth/me"),
  logout: () => request<void>("POST", "/api/auth/logout"),
  savePreferences: (theme: "light" | "dark") =>
```

New:
```ts
export const api = {
  /* auth */
  me: () => request<{ user: PublicUser | null }>("GET", "/api/auth/me"),
  savePreferences: (theme: "light" | "dark") =>
```

- [ ] **Step 2: Rewrite `AppRoot.tsx`**

Read the current file first, then replace its entire content:

```tsx
import { useEffect, useState } from "react";
import { api, type PublicUser } from "./api";
import { NotoWorkspace } from "./NotoWorkspace";
import { AppLoading } from "./AppStatus";
import type { Theme } from "../landing/useTheme";

const ONBOARDED_KEY = "noto-onboarded";
const FIRST_RUN_DEST = "/get-started";

/**
 * Loads the local owner's profile + theme on mount, then renders the
 * workspace. There is no login: the server auto-provisions the local
 * owner's session on the very first request (see
 * server/auth/localSession.ts), so `/api/auth/me` always resolves.
 * First-ever launch is instead detected client-side and sent through a
 * short first-run tour once.
 */
export function AppRoot() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    try {
      if (!localStorage.getItem(ONBOARDED_KEY)) {
        window.location.href = FIRST_RUN_DEST;
        return;
      }
    } catch {
      /* localStorage unavailable — skip the first-run tour, don't block the app */
    }

    let cancelled = false;
    api
      .me()
      .then(({ user }) => {
        if (cancelled || !user) return;
        const t: Theme = user.theme === "dark" ? "dark" : "light";
        applyTheme(t);
        setTheme(t);
        setUser(user);
        setReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function applyTheme(t: Theme) {
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = t;
    try {
      localStorage.setItem("noto-theme", t);
    } catch {
      /* ignore */
    }
  }

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    api.savePreferences(next).catch(() => {});
  }

  if (!ready || !user) {
    return <AppLoading message="Loading Noto…" />;
  }

  return <NotoWorkspace user={user} theme={theme} onToggleTheme={toggleTheme} />;
}
```

- [ ] **Step 3: Update `NotoWorkspace.tsx`**

Read the file first. Remove `onLogout` from the `Props` type, the destructure, and
the controller object; update the `account` field to use `displayName` instead of the
removed `email`:

Old:
```ts
interface Props {
  user: PublicUser;
  theme: Theme;
  onToggleTheme: () => void;
  onLogout: () => void;
}
```
```ts
export function NotoWorkspace({ user, theme, onToggleTheme, onLogout }: Props) {
```
```ts
    account: { email: user.email },
    theme,
    updateContent: v.updateContent,
    createNote: v.createNote,
    createNoteAtPath: v.createNoteAtPath,
    renameNote: v.renameNote,
    deleteNote: v.deleteNote,
    togglePin: v.togglePin,
    flush: v.flush,
    onToggleTheme,
    onLogout,
```

New:
```ts
interface Props {
  user: PublicUser;
  theme: Theme;
  onToggleTheme: () => void;
}
```
```ts
export function NotoWorkspace({ user, theme, onToggleTheme }: Props) {
```
```ts
    account: { label: user.displayName ?? "Local Vault" },
    theme,
    updateContent: v.updateContent,
    createNote: v.createNote,
    createNoteAtPath: v.createNoteAtPath,
    renameNote: v.renameNote,
    deleteNote: v.deleteNote,
    togglePin: v.togglePin,
    flush: v.flush,
    onToggleTheme,
```

- [ ] **Step 4: Update `VaultController` in `landing/src/workspace/types.ts`**

Old:
```ts
  account?: { email: string | null } | null;
```

New:
```ts
  account?: { label: string } | null;
```

And delete this line entirely:
```ts
  onLogout?(): void;
```

- [ ] **Step 5: Update `Sidebar.tsx`**

Read the file first. There are two places threading `onLogout` (the outer `Sidebar`
component and the inner `AccountFooter`) plus the `AccountFooter` call site.

Remove `onLogout` from `Sidebar`'s own props/destructure:

Old:
```
  onLogout?: () => void;
```
(in the outer Props type, alongside `onOpenConnect`/`onOpenDump`/`onOpenActivity`)

and
```
    account, theme, onToggleTheme, onLogout, onOpenConnect, onOpenDump, onOpenActivity,
```

New: delete the `onLogout?: () => void;` line; remove `onLogout` from the destructure
list (keep the rest in the same order).

Update the `AccountFooter` call site:

Old:
```tsx
        <AccountFooter account={account} theme={theme} onToggleTheme={onToggleTheme} onLogout={onLogout} onOpenConnect={onOpenConnect} onOpenDump={onOpenDump} />
```

New:
```tsx
        <AccountFooter account={account} theme={theme} onToggleTheme={onToggleTheme} onOpenConnect={onOpenConnect} onOpenDump={onOpenDump} />
```

Update the `AccountFooter` component itself:

Old:
```tsx
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
  const [open, setOpen] = useState(false);
  if (!account) return null;
  const email = account.email ?? "Account";
  return (
    <div className="nw-account">
      <button className="nw-account-btn" onClick={() => setOpen((o) => !o)}>
        <div className="nw-account-avatar">{(email[0] || "U").toUpperCase()}</div>
        <span className="nw-account-email" title={email}>{email}</span>
        <Icon name="more" size={16} stroke={1.7} />
      </button>
```

New:
```tsx
function AccountFooter({
  account, theme, onToggleTheme, onOpenConnect, onOpenDump,
}: {
  account: { label: string } | null;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  onOpenConnect?: () => void;
  onOpenDump?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!account) return null;
  const label = account.label;
  return (
    <div className="nw-account">
      <button className="nw-account-btn" onClick={() => setOpen((o) => !o)}>
        <div className="nw-account-avatar">{(label[0] || "N").toUpperCase()}</div>
        <span className="nw-account-email" title={label}>{label}</span>
        <Icon name="more" size={16} stroke={1.7} />
      </button>
```

And remove the "Log out" menu item entirely:

Old:
```tsx
            <button className="nw-menu-item" disabled title="Settings are coming soon">
              <Icon name="settings" size={14} stroke={1.7} />
              <span>Settings</span>
              <span className="nw-menu-soon">Soon</span>
            </button>
            {onLogout && (
              <button
                className="nw-menu-item"
                onClick={() => {
                  setOpen(false);
                  onLogout();
                }}
              >
                <Icon name="logout" size={14} stroke={1.7} />
                <span>Log out</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

New:
```tsx
            <button className="nw-menu-item" disabled title="Settings are coming soon">
              <Icon name="settings" size={14} stroke={1.7} />
              <span>Settings</span>
              <span className="nw-menu-soon">Soon</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Update `NotoWindow.tsx`**

Read the file around the `Sidebar` usage, then remove the `onLogout` pass-through:

Old:
```tsx
            onLogout={controller.onLogout}
```

New: delete this line entirely.

- [ ] **Step 7: Run the frontend type-check and lint**

Run:
```bash
cd landing
npx tsc -b --noEmit
npx eslint src/app src/workspace
```
Expected: no errors. If `tsc` reports an unused `onLogout` anywhere else, that call
site was missed — search with `grep -rn "onLogout" src/` and remove it.

- [ ] **Step 8: Commit**

```bash
git add landing/src/app/AppRoot.tsx landing/src/app/api.ts landing/src/app/NotoWorkspace.tsx landing/src/workspace/types.ts landing/src/workspace/Sidebar.tsx landing/src/workspace/NotoWindow.tsx
git commit -m "feat(app): remove the login gate and logout UI; local-first by default

AppRoot no longer redirects to a sign-in screen — /api/auth/me always
resolves to the auto-provisioned local owner. First-ever launch is
detected via a localStorage flag instead, sending new installs through
a short first-run tour (Task 9)."
```

### Task 9: Trim onboarding to a first-run tour (no accounts)

**Files:**
- Modify: `landing/src/onboarding/Onboarding.tsx`
- Modify: `landing/src/onboarding/api.ts`
- Modify: `landing/src/onboarding/screens/AllSetScreen.tsx`
- Delete: `landing/src/onboarding/screens/AccountScreen.tsx`, `landing/src/onboarding/screens/PasswordScreen.tsx`

`ThemeScreen.tsx` and `CommandTutorial.tsx` are unchanged (their prop interfaces
already match what the trimmed flow below calls them with).

- [ ] **Step 1: Update `landing/src/onboarding/api.ts`**

Read the file first, then replace its entire content — drop `signup`/`login`/
`guest`/`logout`/`googleLoginUrl`, keep `me`/`savePreferences`:

```ts
/**
 * Thin client for the auth API used by the first-run tour.
 *
 * - Same-origin fetch with credentials:"include" so the httpOnly session cookie
 *   rides along (and is never touched by JS).
 * - Reads the readable CSRF cookie and echoes it back in X-CSRF-Token on every
 *   state-changing request (double-submit pattern; see server/auth/csrf.ts).
 */

export interface PublicUser {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  theme: "light" | "dark" | string;
}

const CSRF_COOKIE = "noto_csrf";

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Make sure the server has issued a CSRF cookie, then return its value. */
async function ensureCsrfToken(): Promise<string> {
  let token = readCookie(CSRF_COOKIE);
  if (!token) {
    await fetch("/api/auth/me", { credentials: "include" }).catch(() => {});
    token = readCookie(CSRF_COOKIE);
  }
  return token ?? "";
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    headers["X-CSRF-Token"] = await ensureCsrfToken();
  }
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body (e.g. 204) */
  }
  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? "Something went wrong. Please try again.";
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export const authApi = {
  me: () => request<{ user: PublicUser | null }>("GET", "/api/auth/me"),
  savePreferences: (theme: "light" | "dark") =>
    request<{ ok: true }>("PATCH", "/api/auth/preferences", { theme }),
};
```

- [ ] **Step 2: Rewrite `Onboarding.tsx`**

Read the current file first, then replace its entire content:

```tsx
import { useEffect, useState } from "react";
import { useTheme } from "../landing/useTheme";
import { authApi } from "./api";
import { BrandMark } from "./icons";
import { ThemeScreen } from "./screens/ThemeScreen";
import { CommandTutorial } from "./screens/CommandTutorial";
import { AllSetScreen } from "./screens/AllSetScreen";

const STEPS = ["theme", "command", "done"] as const;
type Step = (typeof STEPS)[number];

const ONBOARDED_KEY = "noto-onboarded";
// Where the tour sends you once it's done: the real Noto workspace.
const POST_TOUR_DEST = "/app";

/**
 * First-run tour, shown once per install (see AppRoot's ONBOARDED_KEY check).
 * There are no accounts to create — this is purely a short welcome/orientation
 * flow: pick a theme, see the command-palette tutorial, then open the app.
 */
export function Onboarding() {
  const [stepIdx, setStepIdx] = useState(0);
  const [theme, setTheme] = useTheme();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then(({ user }) => {
        if (cancelled || !user) return;
        if (user.theme === "light" || user.theme === "dark") setTheme(user.theme);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = STEPS[stepIdx];
  const goNext = () => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
  const goBack = () => setStepIdx((i) => Math.max(0, i - 1));
  const goto = (i: number) => { if (i <= stepIdx) setStepIdx(i); };

  function finishTour() {
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      /* ignore — worst case the tour shows again next launch */
    }
    window.location.href = POST_TOUR_DEST;
  }

  async function handleThemeContinue() {
    authApi.savePreferences(theme).catch(() => {});
    goNext();
  }

  return (
    <div className="ob-root" style={{ visibility: ready ? "visible" : "hidden" }}>
      <header className="ob-top">
        <div className="ob-brand">
          <span className="ob-brand-mark"><BrandMark /></span>
          NOTO
        </div>
        <button className="ob-skip" onClick={finishTour}>
          Skip for now
        </button>
      </header>

      <main className="ob-stage">
        {step === "theme" && (
          <ThemeScreen
            key="theme"
            theme={theme}
            setTheme={setTheme}
            onNext={handleThemeContinue}
            onBack={goBack}
          />
        )}
        {step === "command" && (
          <CommandTutorial key="command" onNext={goNext} onBack={goBack} />
        )}
        {step === "done" && (
          <AllSetScreen key="done" onOpen={finishTour} onBack={goBack} />
        )}
      </main>

      <div className="ob-dots">
        {STEPS.map((s, i) => (
          <button
            key={s}
            className={"ob-dot" + (i === stepIdx ? " is-active" : i < stepIdx ? " is-done" : "")}
            onClick={() => goto(i)}
            aria-label={"Step " + (i + 1)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Check `AllSetScreen.tsx`'s `onOpen` usage matches**

Read `landing/src/onboarding/screens/AllSetScreen.tsx`. Its `onOpen` prop is called
with no arguments and previously triggered a redirect to `/app` — confirm it still
just calls `props.onOpen()` with no arguments (it should; `finishTour` above matches
that signature). No change expected, but verify before moving on.

- [ ] **Step 4: Delete the account/password screens**

```bash
git rm landing/src/onboarding/screens/AccountScreen.tsx landing/src/onboarding/screens/PasswordScreen.tsx
```

- [ ] **Step 5: Run the frontend type-check and lint**

Run:
```bash
cd landing
npx tsc -b --noEmit
npx eslint src/onboarding
```
Expected: no errors.

- [ ] **Step 6: Manually verify the first-run tour in the browser**

Run `npm run dev` (or use an already-running dev server), clear `localStorage`, and
load `/app`. Confirm you're redirected to `/get-started`, the tour shows only
Theme → Command tutorial → All set, and "Skip for now" / finishing the tour lands you
in the real workspace with `noto-onboarded` set in `localStorage`. Reload `/app` again
and confirm it goes straight to the workspace (no repeat redirect).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(onboarding): trim the first-run tour to theme + command palette

Account/password steps are gone (Onboarding.tsx now has no accounts to
create). The tour is triggered once per install via a localStorage flag
instead of an auth redirect."
```

### Task 10: Update existing tests for the local-first auth model

**Files:**
- Modify: `landing/server/test-helpers.ts`
- Modify: `landing/server/auth/routes.test.ts`
- Modify: `landing/server/notes/routes.test.ts`
- Modify: `landing/server/memory/routes.test.ts`
- Modify: `landing/server/audit/routes.test.ts`
- Modify: `landing/server/ai/routes.test.ts`

This task has two parts: (A) three files with fully specified fixes below, and (B) a
grep-driven sweep for the remaining suite, using the rule established by (A).

- [ ] **Step 1 (Part A): Fix the shared `signup()` helper**

In `landing/server/test-helpers.ts`, replace:

Old:
```ts
/** Sign up a fresh user, returning an authenticated cookie client. */
export async function signup(baseURL: string, email: string) {
  const client = makeCookieClient(baseURL);
  await client.req("GET", "/api/health"); // primes the CSRF cookie
  const res = await client.req("POST", "/api/auth/signup", { email, password: "password123" });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status}`);
  return client;
}
```

New:
```ts
/**
 * Return an authenticated cookie client. There are no accounts anymore — every
 * client auto-resolves to the single local owner (see auth/localSession.ts).
 * `email` is accepted for call-site compatibility with existing tests but is
 * otherwise unused.
 */
export async function signup(baseURL: string, _email: string) {
  const client = makeCookieClient(baseURL);
  await client.req("GET", "/api/auth/me"); // establishes the session
  return client;
}
```

This one change fixes every test file that imports `signup` from
`test-helpers.ts` and only wants "some authenticated client" — which is most of
them. It does **not** fix files with their own locally-defined `signup()` (found in
Step 2) or tests that specifically assert cross-user isolation (found in Steps 2–4
and the sweep in Step 5) — those need individual attention because the property
they test no longer exists by design.

- [ ] **Step 2 (Part A): Rewrite `auth/routes.test.ts`**

Read the current file first, then replace its entire content:

```ts
// Integration tests for the local-first auth API: no accounts, no login — every
// request is transparently attached to the single local-owner user.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../app.ts";

const ORIGIN = "http://localhost:5173";

let server: Server;
let baseURL = "";

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseURL = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

/** A tiny cookie-jar HTTP client mirroring the browser's CSRF/session flow. */
function makeClient() {
  const cookies = new Map<string, string>();

  function cookieHeader(): string {
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  function absorb(res: Response): void {
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  async function req(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Origin: ORIGIN };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET" && method !== "HEAD") {
      headers["X-CSRF-Token"] = cookies.get("noto_csrf") ?? "";
    }
    if (cookies.size > 0) headers["Cookie"] = cookieHeader();
    const res = await fetch(baseURL + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    absorb(res);
    return res;
  }

  return { req, cookies };
}

describe("auth API — local-first, no accounts", () => {
  it("auto-provisions a session-backed local owner on the first request", async () => {
    const c = makeClient();
    const me = await c.req("GET", "/api/auth/me");
    expect(me.status).toBe(200);
    const { user } = await me.json();
    expect(user.id).toBeTruthy();
    expect(c.cookies.has("noto_session")).toBe(true);
  });

  it("gives the local owner a working, Welcome-seeded vault", async () => {
    const c = makeClient();
    await c.req("GET", "/api/auth/me"); // establishes the session

    const { vaults } = await (await c.req("GET", "/api/vaults")).json();
    expect(vaults).toHaveLength(1);
    const { files } = await (await c.req("GET", `/api/vaults/${vaults[0].id}/files`)).json();
    expect(files.map((f: { title: string }) => f.title)).toContain("Welcome");
  });

  it("resolves two different browsers/clients to the same local owner", async () => {
    const a = makeClient();
    const aUser = (await (await a.req("GET", "/api/auth/me")).json()).user;

    const b = makeClient();
    const bUser = (await (await b.req("GET", "/api/auth/me")).json()).user;

    // Different session cookies (each client got its own session)...
    expect(a.cookies.get("noto_session")).not.toBe(b.cookies.get("noto_session"));
    // ...but the same underlying local-owner user, since there is only one.
    expect(aUser.id).toBe(bUser.id);
  });

  it("updates the local owner's theme preference", async () => {
    const c = makeClient();
    await c.req("GET", "/api/auth/me");
    const res = await c.req("PATCH", "/api/auth/preferences", { theme: "dark" });
    expect(res.status).toBe(200);
    const me = await (await c.req("GET", "/api/auth/me")).json();
    expect(me.user.theme).toBe("dark");
  });
});
```

- [ ] **Step 3 (Part A): Fix `notes/routes.test.ts`**

Read the current file first (it has its own local `signup()`, not the shared
helper). Apply these changes:

1. Replace the local `signup` function:

Old:
```ts
async function signup(email: string) {
  const client = makeClient();
  // Prime the CSRF cookie (any GET to /api issues it), then sign up.
  await client.req("GET", "/api/health");
  const res = await client.req("POST", "/api/auth/signup", { email, password: "password123" });
  expect(res.status).toBe(201);
  return client;
}
```

New:
```ts
async function signup(_email: string) {
  const client = makeClient();
  await client.req("GET", "/api/auth/me"); // establishes the session
  return client;
}
```

2. Delete the `"isolates data between users (B cannot read or edit A's notes)"` test
   (lines defining `it("isolates data between users...")`) entirely — its premise (two
   different signed-up users with separate vaults) no longer holds; there is only one
   user.

3. Replace the `"rejects unauthenticated access and path traversal"` test — the first
   half (anonymous request → 401) is now wrong (anonymous requests auto-provision and
   succeed); the path-traversal check is still valid and important:

Old:
```ts
  it("rejects unauthenticated access and path traversal", async () => {
    const anon = makeClient();
    await anon.req("GET", "/api/health");
    expect((await anon.req("GET", "/api/vaults")).status).toBe(401);

    const a = await signup("validate@example.com");
    const { vaults } = await (await a.req("GET", "/api/vaults")).json();
    const vaultId = vaults[0].id;
    const bad = await a.req("POST", `/api/vaults/${vaultId}/files`, {
      path: "../escape.md",
      title: "Evil",
      content: "",
    });
    expect(bad.status).toBe(400);
  });
```

New:
```ts
  it("auto-provisions a fresh anonymous client instead of rejecting it", async () => {
    const anon = makeClient();
    expect((await anon.req("GET", "/api/vaults")).status).toBe(200);
  });

  it("rejects path traversal in a new file's path", async () => {
    const a = await signup("validate@example.com");
    const { vaults } = await (await a.req("GET", "/api/vaults")).json();
    const vaultId = vaults[0].id;
    const bad = await a.req("POST", `/api/vaults/${vaultId}/files`, {
      path: "../escape.md",
      title: "Evil",
      content: "",
    });
    expect(bad.status).toBe(400);
  });
```

4. Delete the `"requires authentication"` test entirely (same invalidated premise as
   above — superseded by the new "auto-provisions" test):

```ts
  it("requires authentication", async () => {
    const anon = makeClient();
    await anon.req("GET", "/api/health");
    const res = await anon.req("POST", "/api/vaults", { name: "Nope" });
    expect(res.status).toBe(401);
  });
```

5. Delete the `"404s AI config for a vault the caller does not own"` test entirely —
   same invalidated cross-user premise (`b` is now the same owner as `a`, so this
   would 200, not 404):

```ts
  it("404s AI config for a vault the caller does not own", async () => {
    const a = await signup("mv-own-a@example.com");
    const b = await signup("mv-own-b@example.com");
    const { vault } = (await (await a.req("POST", "/api/vaults", { name: "Private" })).json()) as { vault: { id: string } };
    const res = await b.req("GET", `/api/vaults/${vault.id}/ai`);
    expect(res.status).toBe(404);
  });
```

The remaining tests ("bootstraps a default vault...", "persists a created note...",
"creates a vault with icon/color...", "rejects an empty vault name", "rejects
creating beyond the per-user vault cap", "sets and reads per-vault AI config...")
need no further changes — they only needed a working `signup()`.

- [ ] **Step 4 (Part A): Fix `memory/routes.test.ts`, `audit/routes.test.ts`, `ai/routes.test.ts`**

In `landing/server/memory/routes.test.ts`: delete the
`"isolates memory between users (same scope, different owner)"` test entirely (same
invalidated premise — `a` and `b` are now the same owner). Leave
`"returns 401 for unauthenticated recall (no token)"` unchanged — that route requires
a PAT bearer token specifically (`requireApiUser`), which is unaffected by the
session/cookie changes in this plan.

In `landing/server/audit/routes.test.ts`: delete the
`"isolates users (A cannot see B's activity)"` test entirely (same invalidated
premise).

In `landing/server/ai/routes.test.ts`: delete the
`"rejects unauthenticated AI calls with 401"` test entirely — it used a cookie-based
anonymous client, which now auto-provisions successfully; there is no more
unauthenticated state for cookie-based routes to reject. This file also defines its
own local `signup(email)` helper (confirmed while writing this plan — it POSTs to
`/api/auth/signup` and asserts `201`, the same pattern as `notes/routes.test.ts`
before Step 3): read the file's helper section and apply the same fix as Step 3.1
(replace the body with a single `GET /api/auth/me`, drop the request-body/status
assertion, keep the function signature so its ~7 call sites in this file are
unaffected).

- [ ] **Step 5 (Part B): Sweep the rest of the suite**

Run the full test suite and capture failures:
```bash
cd landing && npx vitest run server/ 2>&1 | tee /tmp/noto-test-sweep.log
```

For every failure, apply this rule:
- If the test signs up/authenticates **two different "users"** and asserts they
  **cannot** see each other's data, or that one is **isolated** from the other →
  delete the test. That property no longer exists by design (single local owner).
- If the test asserts a **cookie-based** (non-PAT) request without a session is
  rejected with 401 → delete or rewrite it to assert the request now **succeeds**
  (auto-provisioning). Do **not** touch tests asserting a missing/invalid **PAT
  bearer token** is rejected with 401 — those are unaffected (already confirmed
  unchanged in `auth/pat.test.ts`, `mcp/routes.test.ts`, `notes/single.test.ts` by the
  file reads done while writing this plan).
- If the test calls a locally-defined `signup()` that still POSTs to
  `/api/auth/signup` → apply the same fix as Step 3.1 (replace the body with a single
  `GET /api/auth/me`, drop the request-body/status assertion).
- Any other failure is unexpected — stop and investigate rather than papering over it
  (this plan's changes should not affect unrelated behavior).

Re-run the full suite after each fix until it's green:
```bash
cd landing && npx vitest run
```
Expected: PASS, 0 failures.

- [ ] **Step 6: Run the full verification gate**

```bash
cd landing
npx tsc -b --noEmit
npx tsc -p tsconfig.server.json --noEmit
npx eslint .
npx vitest run
npm run build
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: update the suite for the local-first, single-owner auth model

Cross-user isolation tests are removed (that property no longer exists
by design); cookie-based unauthenticated-request tests are updated to
reflect auto-provisioning. PAT-bearer-token auth tests are untouched."
```

---

## Phase 3: `pip install noto-app` packaging

### Task 11: Scaffold the `packaging/pypi` Python package

**Files:**
- Create: `packaging/pypi/pyproject.toml`
- Create: `packaging/pypi/README.md`
- Create: `packaging/pypi/.gitignore`
- Create: `packaging/pypi/noto_app/__init__.py`
- Create: `packaging/pypi/tests/__init__.py`

- [ ] **Step 1: Create the directory and `.gitignore`**

Run: `mkdir -p packaging/pypi/noto_app packaging/pypi/tests`

Create `packaging/pypi/.gitignore`:
```
_vendor/*
!_vendor/.gitkeep
dist/
build/
*.egg-info/
__pycache__/
*.pyc
.venv/
```

Run: `mkdir -p packaging/pypi/noto_app/_vendor && touch packaging/pypi/noto_app/_vendor/.gitkeep`

- [ ] **Step 2: Create `pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "noto-app"
version = "0.1.0"
description = "Noto: a local-first Markdown notes workspace with an AI lecture-listening assistant. No accounts, no server to run — pip install noto-app, then run `noto`."
readme = "README.md"
requires-python = ">=3.9"
license = { text = "MIT" }
classifiers = [
    "Programming Language :: Python :: 3",
    "License :: OSI Approved :: MIT License",
    "Operating System :: OS Independent",
    "Environment :: Console",
    "Topic :: Text Editors",
]

[project.urls]
Homepage = "https://github.com/doomwoodzz/Noto"

[project.scripts]
noto = "noto_app.cli:main"

[tool.setuptools.packages.find]
where = ["."]
include = ["noto_app*"]
exclude = ["tests*"]

[tool.setuptools.package-data]
noto_app = ["_vendor/**/*"]
```

- [ ] **Step 3: Create `packaging/pypi/README.md`**

```markdown
# noto-app

Local-first Markdown notes with an AI lecture-listening assistant. No accounts, no
server to operate — your vault stays on your machine.

```bash
pip install noto-app
noto
```

The first run downloads a small, checksum-verified Node.js runtime automatically (no
separate Node.js install required) and opens Noto in your browser. Later runs start
instantly.

See the main project at https://github.com/doomwoodzz/Noto.
```

- [ ] **Step 4: Create `packaging/pypi/noto_app/__init__.py`**

```python
"""noto-app: pip-installable packaging for the Noto local-first notes app."""

__version__ = "0.1.0"
```

- [ ] **Step 5: Create `packaging/pypi/tests/__init__.py`**

```python
```
(empty file — marks the directory as a package for pytest discovery)

- [ ] **Step 6: Commit**

```bash
git add packaging/pypi
git commit -m "chore(packaging): scaffold the noto-app PyPI package"
```

### Task 12: Implement the Node.js runtime manager

**Files:**
- Create: `packaging/pypi/noto_app/node_runtime.py`
- Test: `packaging/pypi/tests/test_node_runtime.py`

- [ ] **Step 1: Write the failing tests**

Create `packaging/pypi/tests/test_node_runtime.py`:

```python
import hashlib
from pathlib import Path
from unittest import mock

import pytest

from noto_app.node_runtime import (
    NodeRuntimeError,
    _archive_name,
    _platform_key,
    _sha256_file,
    _verify_checksum,
)


def test_platform_key_darwin_arm64():
    with mock.patch("platform.system", return_value="Darwin"), mock.patch(
        "platform.machine", return_value="arm64"
    ):
        assert _platform_key() == ("darwin", "arm64")


def test_platform_key_linux_x64():
    with mock.patch("platform.system", return_value="Linux"), mock.patch(
        "platform.machine", return_value="x86_64"
    ):
        assert _platform_key() == ("linux", "x64")


def test_platform_key_windows_x64():
    with mock.patch("platform.system", return_value="Windows"), mock.patch(
        "platform.machine", return_value="AMD64"
    ):
        assert _platform_key() == ("win", "x64")


def test_platform_key_rejects_unknown_os():
    with mock.patch("platform.system", return_value="Plan9"):
        with pytest.raises(NodeRuntimeError):
            _platform_key()


def test_archive_name_uses_zip_for_windows():
    assert _archive_name("win", "x64").endswith(".zip")


def test_archive_name_uses_tar_gz_elsewhere():
    assert _archive_name("darwin", "arm64").endswith(".tar.gz")
    assert _archive_name("linux", "x64").endswith(".tar.gz")


def test_verify_checksum_accepts_matching_hash(tmp_path: Path):
    archive = tmp_path / "node-vX-darwin-arm64.tar.gz"
    archive.write_bytes(b"fake node tarball contents")
    expected = hashlib.sha256(archive.read_bytes()).hexdigest()

    checksums = tmp_path / "SHASUMS256.txt"
    checksums.write_text(f"{expected}  node-vX-darwin-arm64.tar.gz\nsomeotherhash  other-file.tar.gz\n")

    # Should not raise.
    _verify_checksum(archive, "node-vX-darwin-arm64.tar.gz", checksums)


def test_verify_checksum_rejects_mismatched_hash(tmp_path: Path):
    archive = tmp_path / "node-vX-darwin-arm64.tar.gz"
    archive.write_bytes(b"fake node tarball contents")

    checksums = tmp_path / "SHASUMS256.txt"
    checksums.write_text("0" * 64 + "  node-vX-darwin-arm64.tar.gz\n")

    with pytest.raises(NodeRuntimeError):
        _verify_checksum(archive, "node-vX-darwin-arm64.tar.gz", checksums)


def test_verify_checksum_rejects_missing_entry(tmp_path: Path):
    archive = tmp_path / "node-vX-darwin-arm64.tar.gz"
    archive.write_bytes(b"fake node tarball contents")

    checksums = tmp_path / "SHASUMS256.txt"
    checksums.write_text("0" * 64 + "  some-other-archive.tar.gz\n")

    with pytest.raises(NodeRuntimeError):
        _verify_checksum(archive, "node-vX-darwin-arm64.tar.gz", checksums)


def test_sha256_file_matches_hashlib(tmp_path: Path):
    f = tmp_path / "data.bin"
    f.write_bytes(b"some bytes to hash" * 1000)
    assert _sha256_file(f) == hashlib.sha256(f.read_bytes()).hexdigest()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packaging/pypi && python3 -m pip install pytest && python3 -m pytest tests/test_node_runtime.py -v`
Expected: FAIL / collection error — `noto_app.node_runtime` doesn't exist yet.

- [ ] **Step 3: Create `packaging/pypi/noto_app/node_runtime.py`**

```python
"""
Download, verify, and cache a pinned Node.js runtime for the current platform.

Noto vendors no Node.js of its own — instead, on first run it fetches the
official build for whatever machine it's running on and caches it under the
user's Noto cache directory. This is what lets a single `pip install` work
identically on macOS/Linux/Windows without requiring the user to already have
Node.js installed, and without publishing a different wheel per platform.

The download is verified against nodejs.org's own published SHASUMS256.txt,
fetched alongside the archive, rather than a hash hardcoded in this file — so
verification stays correct if NODE_VERSION is ever bumped without needing to
also update a hash table here.
"""

from __future__ import annotations

import hashlib
import platform
import stat
import tarfile
import urllib.request
import zipfile
from pathlib import Path

NODE_VERSION = "24.18.0"
DIST_BASE = f"https://nodejs.org/dist/v{NODE_VERSION}"


class NodeRuntimeError(RuntimeError):
    pass


def _platform_key() -> tuple[str, str]:
    """Return (nodejs-dist-os, nodejs-dist-arch) for the running machine."""
    system = platform.system()
    machine = platform.machine().lower()

    if system == "Darwin":
        os_name = "darwin"
    elif system == "Linux":
        os_name = "linux"
    elif system == "Windows":
        os_name = "win"
    else:
        raise NodeRuntimeError(f"Unsupported platform: {system}")

    if machine in ("arm64", "aarch64"):
        arch = "arm64"
    elif machine in ("x86_64", "amd64"):
        arch = "x64"
    else:
        raise NodeRuntimeError(f"Unsupported architecture: {machine}")

    return os_name, arch


def _archive_name(os_name: str, arch: str) -> str:
    ext = "zip" if os_name == "win" else "tar.gz"
    return f"node-v{NODE_VERSION}-{os_name}-{arch}.{ext}"


def _download(url: str, dest: Path) -> None:
    with urllib.request.urlopen(url) as resp, open(dest, "wb") as f:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _verify_checksum(archive_path: Path, archive_name: str, checksums_path: Path) -> None:
    expected = None
    with open(checksums_path, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) == 2 and parts[1] == archive_name:
                expected = parts[0]
                break
    if expected is None:
        raise NodeRuntimeError(f"No checksum entry found for {archive_name}")
    actual = _sha256_file(archive_path)
    if actual != expected:
        raise NodeRuntimeError(
            f"Checksum mismatch for {archive_name}: expected {expected}, got {actual}"
        )


def _extract(archive_path: Path, dest_dir: Path) -> None:
    if archive_path.suffix == ".zip":
        with zipfile.ZipFile(archive_path) as zf:
            zf.extractall(dest_dir)
    else:
        with tarfile.open(archive_path, "r:gz") as tf:
            # Trusted, checksum-verified official Node.js build — not
            # attacker-controlled input.
            tf.extractall(dest_dir)


def ensure_node_runtime(cache_dir: Path) -> Path:
    """
    Ensure a checksum-verified Node.js runtime is present under `cache_dir`,
    downloading it if necessary. Returns the path to the `node` executable.
    """
    os_name, arch = _platform_key()
    install_dir = cache_dir / f"node-v{NODE_VERSION}-{os_name}-{arch}"
    node_bin = install_dir / "node.exe" if os_name == "win" else install_dir / "bin" / "node"

    if node_bin.exists():
        return node_bin

    cache_dir.mkdir(parents=True, exist_ok=True)
    archive_name = _archive_name(os_name, arch)
    archive_path = cache_dir / archive_name
    checksums_path = cache_dir / f"SHASUMS256.txt-{NODE_VERSION}"

    _download(f"{DIST_BASE}/{archive_name}", archive_path)
    _download(f"{DIST_BASE}/SHASUMS256.txt", checksums_path)
    _verify_checksum(archive_path, archive_name, checksums_path)

    _extract(archive_path, cache_dir)
    archive_path.unlink()
    checksums_path.unlink()

    if os_name != "win":
        node_bin.chmod(node_bin.stat().st_mode | stat.S_IEXEC)

    if not node_bin.exists():
        raise NodeRuntimeError(f"node executable not found after extraction: {node_bin}")

    return node_bin
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packaging/pypi && python3 -m pytest tests/test_node_runtime.py -v`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packaging/pypi/noto_app/node_runtime.py packaging/pypi/tests/test_node_runtime.py
git commit -m "feat(packaging): add the Node.js runtime download/verify/cache manager"
```

### Task 13: Implement local data-directory resolution

**Files:**
- Create: `packaging/pypi/noto_app/paths.py`
- Test: `packaging/pypi/tests/test_paths.py`

- [ ] **Step 1: Write the failing tests**

Create `packaging/pypi/tests/test_paths.py`:

```python
from pathlib import Path
from unittest import mock

from noto_app.paths import data_dir, runtime_cache_dir


def test_data_dir_on_macos(tmp_path: Path):
    with mock.patch("platform.system", return_value="Darwin"), mock.patch(
        "pathlib.Path.home", return_value=tmp_path
    ):
        d = data_dir()
        assert d == tmp_path / "Library" / "Application Support" / "noto"
        assert d.is_dir()


def test_data_dir_on_linux_respects_xdg(tmp_path: Path, monkeypatch):
    xdg = tmp_path / "xdg-data"
    monkeypatch.setenv("XDG_DATA_HOME", str(xdg))
    with mock.patch("platform.system", return_value="Linux"):
        d = data_dir()
        assert d == xdg / "noto"
        assert d.is_dir()


def test_data_dir_on_linux_without_xdg(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    with mock.patch("platform.system", return_value="Linux"), mock.patch(
        "pathlib.Path.home", return_value=tmp_path
    ):
        d = data_dir()
        assert d == tmp_path / ".local" / "share" / "noto"


def test_runtime_cache_dir_on_macos(tmp_path: Path):
    with mock.patch("platform.system", return_value="Darwin"), mock.patch(
        "pathlib.Path.home", return_value=tmp_path
    ):
        d = runtime_cache_dir()
        assert d == tmp_path / "Library" / "Caches" / "noto"
        assert d.is_dir()


def test_data_dir_and_cache_dir_are_different(tmp_path: Path):
    with mock.patch("platform.system", return_value="Darwin"), mock.patch(
        "pathlib.Path.home", return_value=tmp_path
    ):
        assert data_dir() != runtime_cache_dir()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packaging/pypi && python3 -m pytest tests/test_paths.py -v`
Expected: FAIL / collection error — `noto_app.paths` doesn't exist yet.

- [ ] **Step 3: Create `packaging/pypi/noto_app/paths.py`**

```python
"""OS-appropriate local directories for Noto's data (SQLite DB, uploads) and
the cached Node.js runtime + installed app dependencies."""

from __future__ import annotations

import os
import platform
from pathlib import Path


def data_dir() -> Path:
    """Per-OS user-data directory for Noto's database and uploads. Created if missing."""
    system = platform.system()
    if system == "Darwin":
        base = Path.home() / "Library" / "Application Support" / "noto"
    elif system == "Windows":
        base = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))) / "noto"
    else:
        xdg = os.environ.get("XDG_DATA_HOME")
        base = Path(xdg) / "noto" if xdg else Path.home() / ".local" / "share" / "noto"
    base.mkdir(parents=True, exist_ok=True)
    return base


def runtime_cache_dir() -> Path:
    """Per-OS cache directory for the downloaded Node.js runtime + installed app deps."""
    system = platform.system()
    if system == "Darwin":
        base = Path.home() / "Library" / "Caches" / "noto"
    elif system == "Windows":
        base = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "noto" / "cache"
    else:
        xdg = os.environ.get("XDG_CACHE_HOME")
        base = Path(xdg) / "noto" if xdg else Path.home() / ".cache" / "noto"
    base.mkdir(parents=True, exist_ok=True)
    return base
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packaging/pypi && python3 -m pytest tests/test_paths.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packaging/pypi/noto_app/paths.py packaging/pypi/tests/test_paths.py
git commit -m "feat(packaging): add OS-appropriate data/cache directory resolution"
```

### Task 14: Implement the `noto` CLI entry point

**Files:**
- Create: `packaging/pypi/noto_app/cli.py`
- Test: `packaging/pypi/tests/test_cli.py`

- [ ] **Step 1: Write the failing tests**

These test the pure-logic pieces (port selection, npm path, install-marker
comparison) with the filesystem/network/process calls mocked — the real end-to-end
launch is verified manually in Task 16.

Create `packaging/pypi/tests/test_cli.py`:

```python
import socket
from pathlib import Path

from noto_app.cli import _find_free_port, _npm_path


def test_find_free_port_returns_preferred_when_available():
    # Bind nothing on a high, unlikely-to-collide port and confirm it's returned.
    port = _find_free_port(41287)
    assert port == 41287


def test_find_free_port_skips_a_port_already_in_use():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as blocker:
        blocker.bind(("127.0.0.1", 0))
        blocker.listen(1)
        busy_port = blocker.getsockname()[1]
        found = _find_free_port(busy_port)
        assert found != busy_port


def test_npm_path_uses_cmd_extension_on_windows_node():
    node_bin = Path("C:/fake/node.exe")
    assert _npm_path(node_bin).name == "npm.cmd"


def test_npm_path_uses_plain_name_on_posix_node():
    node_bin = Path("/fake/bin/node")
    assert _npm_path(node_bin).name == "npm"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packaging/pypi && python3 -m pytest tests/test_cli.py -v`
Expected: FAIL / collection error — `noto_app.cli` doesn't exist yet.

- [ ] **Step 3: Create `packaging/pypi/noto_app/cli.py`**

```python
"""
`noto` CLI entry point.

Ensures a Node.js runtime is available, installs the vendored app's
production dependencies on first run, then launches the server in the
foreground and opens the browser. Ctrl+C stops the server.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

from .node_runtime import ensure_node_runtime
from .paths import data_dir, runtime_cache_dir

VENDOR_DIR = Path(__file__).parent / "_vendor"
DEFAULT_PORT = 8787


def _find_free_port(preferred: int) -> int:
    """Return `preferred` if free, else the first free port after it."""
    for port in (preferred, *range(preferred + 1, preferred + 20)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"No free port found near {preferred}")


def _npm_path(node_bin: Path) -> Path:
    # The official Node.js distribution ships npm's CLI alongside node in the
    # same bin/ (POSIX) or root (Windows) directory.
    if node_bin.name == "node.exe":
        return node_bin.parent / "npm.cmd"
    return node_bin.parent / "npm"


def _install_dir(cache_dir: Path) -> Path:
    install_dir = cache_dir / "app"
    install_dir.mkdir(parents=True, exist_ok=True)
    return install_dir


def _ensure_app_installed(node_bin: Path, install_dir: Path) -> None:
    """Copy the vendored app into the cache dir and `npm ci` it once."""
    marker = install_dir / ".installed-package-json"
    vendor_package_json = (VENDOR_DIR / "package.json").read_text()
    if marker.exists() and marker.read_text() == vendor_package_json:
        return  # already installed for this exact vendored bundle

    print("Setting up Noto (first run only, this can take a minute)...")
    shutil.copytree(VENDOR_DIR, install_dir, dirs_exist_ok=True)
    npm = _npm_path(node_bin)
    subprocess.run(
        [str(npm), "ci", "--omit=dev", "--no-audit", "--no-fund"],
        cwd=install_dir,
        check=True,
    )
    marker.write_text(vendor_package_json)


def main() -> None:
    cache_root = runtime_cache_dir()
    node_bin = ensure_node_runtime(cache_root / "runtime")
    install_dir = _install_dir(cache_root)
    _ensure_app_installed(node_bin, install_dir)

    port = _find_free_port(DEFAULT_PORT)
    env = {
        **os.environ,
        "NODE_ENV": "production",
        "PORT": str(port),
        "APP_ORIGIN": f"http://127.0.0.1:{port}",
        "DATABASE_PATH": str(data_dir() / "noto.sqlite"),
    }

    is_windows = node_bin.name == "node.exe"
    tsx_bin = install_dir / "node_modules" / ".bin" / ("tsx.cmd" if is_windows else "tsx")

    proc = subprocess.Popen(
        [str(node_bin), str(tsx_bin), str(install_dir / "server" / "index.ts")],
        cwd=install_dir,
        env=env,
    )

    def open_browser() -> None:
        time.sleep(1.5)
        webbrowser.open(f"http://127.0.0.1:{port}")

    threading.Thread(target=open_browser, daemon=True).start()

    try:
        proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        proc.wait()
        sys.exit(0)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packaging/pypi && python3 -m pytest tests/test_cli.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packaging/pypi/noto_app/cli.py packaging/pypi/tests/test_cli.py
git commit -m "feat(packaging): add the noto CLI entry point"
```

### Task 15: Build script to vendor the app bundle

**Files:**
- Create: `landing/vite.config.app.ts`
- Create: `landing/scripts/build-pypi-bundle.mjs`
- Modify: `landing/.gitignore`

- [ ] **Step 1: Create `landing/vite.config.app.ts`**

```ts
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

// Narrower build for the pip-packaged local app: only the workspace (app.html)
// and the first-run tour (get-started.html) — no marketing pages. Used by
// scripts/build-pypi-bundle.mjs. The regular `npm run build` (vite.config.ts)
// still builds the full marketing site + app for the hosted deployment.
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist-app',
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL('./app.html', import.meta.url)),
        'get-started': fileURLToPath(new URL('./get-started.html', import.meta.url)),
      },
    },
  },
})
```

- [ ] **Step 2: Create `landing/scripts/build-pypi-bundle.mjs`**

```js
#!/usr/bin/env node
/**
 * Builds the vendored app bundle consumed by the `noto-app` PyPI package.
 *
 * Produces packaging/pypi/noto_app/_vendor/{dist,server,package.json,package-lock.json}:
 *  - dist/    prebuilt static frontend (app.html + get-started.html only — no
 *             marketing pages), with app.html also copied to index.html so the
 *             packaged server's "/" serves the workspace directly.
 *  - server/  the server's TypeScript source, run via tsx at runtime (same as
 *             `npm start` today) — no separate server build step. The gitignored
 *             server/data/ (the maintainer's own local SQLite database) is
 *             deliberately excluded so it's never vendored into the package.
 *  - package.json / package-lock.json   production-only dependencies, with a
 *             fresh lockfile generated to match (via --package-lock-only) since
 *             the pruned package.json no longer matches the original lockfile.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LANDING_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const VENDOR_DIR = join(LANDING_DIR, "..", "packaging", "pypi", "noto_app", "_vendor");

const PROD_DEPENDENCIES = [
  "@huggingface/transformers",
  "@modelcontextprotocol/sdk",
  "cookie",
  "dotenv",
  "express",
  "express-rate-limit",
  "graphology",
  "graphology-communities-louvain",
  "helmet",
  "openai",
  "tsx",
  "zod",
];

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

function main() {
  rmSync(VENDOR_DIR, { recursive: true, force: true });
  mkdirSync(VENDOR_DIR, { recursive: true });

  // 1. Frontend: build only the app + get-started entry points.
  const distAppDir = join(LANDING_DIR, "dist-app");
  rmSync(distAppDir, { recursive: true, force: true });
  run("npx", ["vite", "build", "--config", "vite.config.app.ts"], LANDING_DIR);
  cpSync(distAppDir, join(VENDOR_DIR, "dist"), { recursive: true });
  copyFileSync(join(VENDOR_DIR, "dist", "app.html"), join(VENDOR_DIR, "dist", "index.html"));
  rmSync(distAppDir, { recursive: true, force: true });

  // 2. Server source, run via tsx at runtime — same as `npm start` today.
  // Excludes tests and the gitignored local database directory.
  cpSync(join(LANDING_DIR, "server"), join(VENDOR_DIR, "server"), {
    recursive: true,
    filter: (src) => !src.endsWith(".test.ts") && !src.includes(join("server", "data")),
  });

  // 3. Production-only package.json, versions pinned from the real one.
  const fullPkg = JSON.parse(readFileSync(join(LANDING_DIR, "package.json"), "utf8"));
  const prodDeps = {};
  for (const dep of PROD_DEPENDENCIES) {
    const version = fullPkg.dependencies?.[dep] ?? fullPkg.devDependencies?.[dep];
    if (!version) {
      throw new Error(`Expected dependency "${dep}" not found in landing/package.json`);
    }
    prodDeps[dep] = version;
  }
  const vendorPkg = {
    name: "noto-server",
    private: true,
    version: fullPkg.version,
    type: "module",
    dependencies: prodDeps,
  };
  writeFileSync(join(VENDOR_DIR, "package.json"), JSON.stringify(vendorPkg, null, 2) + "\n");

  // 4. Fresh lockfile matching the pruned package.json (npm ci requires one in sync).
  run("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"], VENDOR_DIR);

  console.log(`Vendored bundle written to ${VENDOR_DIR}`);
}

main();
```

- [ ] **Step 3: Add `dist-app/` to `landing/.gitignore`**

Read the file first, then add a line alongside the existing `dist` entry:
```
dist-app/
```

- [ ] **Step 4: Run it and verify the output**

Run:
```bash
cd landing
node scripts/build-pypi-bundle.mjs
ls -la ../packaging/pypi/noto_app/_vendor
ls ../packaging/pypi/noto_app/_vendor/dist
```
Expected: `_vendor/` contains `dist/`, `server/`, `package.json`, `package-lock.json`.
`_vendor/dist/` contains `index.html`, `app.html`, `get-started.html`, and asset
files. Confirm `_vendor/server/data` does **not** exist (the exclusion filter
worked) and that no `.test.ts` files were copied:
```bash
find ../packaging/pypi/noto_app/_vendor/server -name "*.test.ts" -o -name "data" -type d
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add landing/vite.config.app.ts landing/scripts/build-pypi-bundle.mjs landing/.gitignore
git commit -m "feat(packaging): add the build script that vendors the app for pip"
```

(The generated `_vendor/` contents themselves are gitignored per Task 11 — this
commit only adds the script that produces them.)

### Task 16: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Build the wheel**

```bash
cd packaging/pypi
python3 -m pip install --upgrade build
python3 -m build
```
Expected: `dist/noto_app-0.1.0-py3-none-any.whl` and a `.tar.gz` sdist are created.

- [ ] **Step 2: Install it into a clean virtual environment**

```bash
python3 -m venv /tmp/noto-install-test
/tmp/noto-install-test/bin/pip install packaging/pypi/dist/noto_app-0.1.0-py3-none-any.whl
```
Expected: installs cleanly, no errors. (On Windows, use
`\tmp\noto-install-test\Scripts\pip.exe` instead.)

- [ ] **Step 3: Run `noto` and confirm it serves the real app**

```bash
/tmp/noto-install-test/bin/noto &
NOTO_PID=$!
sleep 45   # first run downloads Node.js + runs npm ci — genuinely slow once
curl -sf http://127.0.0.1:8787/api/health
```
Expected: `{"ok":true,"aiConfigured":false}` (or `true` if you happen to have
`OPENAI_API_KEY` set in your shell environment — either is fine, this just confirms
the real server booted, not a stub).

- [ ] **Step 4: Confirm the workspace itself loads**

```bash
curl -sf http://127.0.0.1:8787/ | grep -o "<title>.*</title>"
```
Expected: the app's title tag (not a 404, not the marketing homepage).

- [ ] **Step 5: Confirm a note round-trips through the real API**

```bash
COOKIES=$(mktemp)
curl -sf -c "$COOKIES" -b "$COOKIES" http://127.0.0.1:8787/api/auth/me
CSRF=$(grep noto_csrf "$COOKIES" | awk '{print $NF}')
VAULT_ID=$(curl -sf -c "$COOKIES" -b "$COOKIES" http://127.0.0.1:8787/api/vaults | python3 -c "import sys,json; print(json.load(sys.stdin)['vaults'][0]['id'])")
curl -sf -c "$COOKIES" -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Origin: http://127.0.0.1:8787" -H "Content-Type: application/json" \
  -X POST "http://127.0.0.1:8787/api/vaults/$VAULT_ID/files" \
  -d '{"path":"Test/E2E.md","title":"E2E","content":"hello from the packaged app"}'
```
Expected: `201` with a JSON body containing the created file.

- [ ] **Step 6: Stop the server and confirm the second run is fast**

```bash
kill $NOTO_PID
time /tmp/noto-install-test/bin/noto &
sleep 3
curl -sf http://127.0.0.1:8787/api/health && kill %1
```
Expected: no Node.js download or `npm ci` output on this run (the cache/install
marker from Step 3 is reused); `/api/health` responds within a few seconds.

- [ ] **Step 7: Clean up**

```bash
rm -rf /tmp/noto-install-test
rm -f "$COOKIES"
```

- [ ] **Step 8: Report results**

No commit for this task (verification only) — report the outcome of each step above
to confirm the packaged app genuinely works end-to-end before considering Phase 3
complete.

---

## Notes on scope

- **PyPI publishing itself is out of scope.** Task 16 verifies the built wheel installs
  and runs correctly; actually running `twine upload` to the public PyPI index (which
  requires real account credentials and is a one-way, externally-visible action) is a
  manual step the user takes on their own, when ready.
- **The `noto-implementation` branch is left untouched** per the locked decision in the
  spec — it is not deleted, just no longer referenced by anything active.
- **GitHub App / Notion connector credentials** (App ID, client secret) belong to
  whoever registers the OAuth app with each provider — this plan keeps the existing
  connector code working exactly as before, re-anchored to the local owner, but does
  not address whether the maintainer's registered app credentials are production-ready
  for a public release. Flagged in the spec as a pre-launch checklist item, not a task
  here.
