# Noto — Open-Source Readiness Report

**Date:** 2026-07-05 · **Branch:** `feat/noto-web-app` · **Scope:** whole repo + full git history, ahead of a public GitHub release.

Four parallel audits were run (security, sensitive-info/history, codebase correctness, design), each finding was false-positive filtered, and every actionable item was fixed and verified. Nothing was pushed; fixes are 8 logical commits on this branch.

## Headline

- **1 real security vulnerability** found and fixed (High): a GitHub App connector installation IDOR.
- **No secrets** anywhere in the working tree or in any of the 200 commits / 826 blobs across all refs.
- **3 publication blockers** cleared (failing test, missing LICENSE, missing README).
- **Tests/typecheck/lint/build all green** after the fixes: 425 JS tests, both TS configs, ESLint 0 errors, Vite build, `swift build`, `NotoCoreChecks`.

---

## Security findings

### SEC-1 — GitHub App installation IDOR (High) — FIXED
**File:** `landing/server/auth/github.ts` (`handleGithubCallback`) · **Fix commit:** `fix(security): verify GitHub App installation ownership…`

The OAuth callback persisted the `installation_id` taken verbatim from the query string without proving the authenticated user controlled that installation. The `code`→user-token exchange was *optional* and best-effort (used only to read a display name). Because installation tokens are minted on demand from the App JWT — which can mint for **any** installation of the app — an authenticated attacker could bind a victim's installation to their own account (no `code` needed) and exfiltrate the victim's **private-repo** prose (READMEs, `docs/**`, `*.md`, issues) through the Dump connector. Installation IDs are small enumerable integers.

**Fix:** the `code` exchange is now mandatory; the callback calls `GET /user/installations` with the user token and requires the supplied `installation_id` to be in that list before saving — failing closed on missing code, exchange failure, list failure, or no match. The existing HMAC state, constant-time compare, and session-binding checks were preserved. Adversarially re-verified: all four reject paths are unreachable-to-save, and 7/7 auth tests pass (3 new negative-path tests assert `saveConnectorToken` is *not* called).

### Cleared (examined, sound)
SQL injection (all queries parameterized; FTS tokenized), user/vault IDOR on notes/files/vaults/jobs/memories (ownership-checked accessors), client XSS (`InlineText`/`liveMarkdown` escape all runs; citation chips are `https?:` + `noopener`), OAuth state for Google/GitHub/Notion (HMAC + constant-time + PKCE/nonce for Google), SSRF guards (`assertPublicHost` on every outbound path incl. per-redirect-hop revalidation), crypto/secrets (AES-256-GCM key vault, sha256 session tokens, RS256 App JWT), Dump secret redaction + slug path-safety, AI response cache keying, MCP bridge (PAT-authed, loopback).

---

## Sensitive-info / history findings — FIXED or noted

| Item | Action |
|------|--------|
| Broken worktree gitlink `.claude/worktrees/…` (breaks clones) | Untracked |
| 5× `.DS_Store`, 4× `dist/*.dmg`, `.claude/launch.json` | Untracked |
| Duplicate 2.4 MB `ChatGPT Image….jpg` + `noto-editor.png` (unreferenced dups of `features-hero.jpg`) | Deleted |
| `.gitignore` missing `.DS_Store`/`.claude/`/`.env`/sqlite | Hardened (your `.gstack/` line preserved) |
| Absolute `<home>/Desktop/Noto` paths in 3 docs (leaks macOS username) | Genericized to `<repo-root>` |
| Commit-author emails (`SV@Als-MacBook-Air.local`, personal Gmail) in history | **Left as-is (your decision).** No secrets in history; no rewrite performed. |
| `landing/public/logos/` (Claude/Codex/Cursor brand marks, untracked) | **Note:** source from official brand kits + note provenance, or accept low trademark risk. |

**Verified clean:** no `sk-`/`ghp_`/`AKIA`/PEM/`client_secret`/JWT secrets in tree or history (all hits were Noto's own redaction regexes and test fixtures); `landing/.env` never committed on any ref; benchmarks JSON are mock fixtures; `release.yml` references secrets by name only; SQLite user DB never committed.

---

## Codebase / publication findings — FIXED

| Item | Action |
|------|--------|
| PUB-1: `TemporaryFailureTests.swift` (`#expect(false)`) + `.tmp-failing-test-note` | Deleted; `swift build` green |
| PUB-4: No LICENSE (all-rights-reserved) | Added MIT (`landing`/`noto-mcp` `package.json` license fields set) |
| PUB-5: No root README; `landing/README.md` = stock Vite template | Root README added; landing README rewritten to the real app |
| PUB-6: `npm run lint` red (9 errors) | All fixed; ESLint exits 0 |

**Already clean (no action):** 425 tests pass, both TS configs typecheck, Vite build succeeds, `npm audit --omit=dev` = 0 vulns, no `debugger;`/`.only`/`test.skip`/TODO-FIXME in shipping source.

**Not changed (informational):** `release.yml` + `appcast.xml` hardcode `doomwoodzz/Noto` — correct only if published under that owner/repo; there is no PR CI running tests. `Package.swift` test target hardcodes CommandLineTools `unsafeFlags` (local toolchain quirk; makes the package unusable as a SwiftPM dependency).

---

## Design findings

| Item | Action |
|------|--------|
| DES-1 (High): features-page "Download for macOS" button rendered near-white text on white in dark mode (~1.06:1, invisible) — `.f-btn-light` used `var(--page-ink)` which flips near-white in dark theme | Fixed: `.f-btn-light` now uses fixed `#0C0D0F` (always dark on the white button) |
| DES-2 (Polish): "1 notes" in the Dump MOC index | Fixed: pluralizes (`1 note` / `N notes`) with a test |

**Noted, not changed (polish, your call):** the account footer in the app shows the raw guest UUID email (`guest-…@guest.noto.local`) instead of a friendly "Guest" label. The marketing pages otherwise scored well — real typeface (Fraunces/Inter, not system-ui), coherent dark palette, no AI-slop 3-column grid, responsive with no horizontal scroll, `focus-visible` rings present.

---

## Verification evidence (post-fix)

```
landing: vitest 425 passed · tsc -b ✓ · tsc -p tsconfig.server.json ✓ · eslint . = 0 · vite build ✓
root:    swift build ✓ · swift run NotoCoreChecks → "NotoCoreChecks passed"
git:     8 logical commits on feat/noto-web-app; your 10 pre-existing dirty files untouched; nothing pushed
```

## Commits added (this branch)

1. `test: remove deliberately-failing debug probe and marker`
2. `chore: untrack build artifacts and local config; harden .gitignore for public repo`
3. `fix(security): verify GitHub App installation ownership in OAuth callback`
4. `docs: add MIT license`
5. `docs: add project README and replace stock Vite landing README`
6. `chore: fix ESLint errors for a clean lint run`
7. `fix(ui): make features hero download button legible in dark mode; pluralize MOC note count`
8. `docs: replace absolute local paths with repo-relative references`

## Remaining decisions (owner-only, before/after making the repo public)

- **Making the repo public** and any **force-push** (only needed if you later choose to rewrite author emails — you opted to leave history as-is).
- **Prune stale remote branches** before flipping public (e.g. `origin/claude/session-secret-railway-crash-…`, `origin/codex/knowledge-web-preview`).
- **`landing/public/logos/`** provenance (trademark) — noted above.
- **Add PR CI** (run `npm test` + `swift build`) and confirm `release.yml`'s `doomwoodzz/Noto` owner/repo + Sparkle secrets match the public repo.
