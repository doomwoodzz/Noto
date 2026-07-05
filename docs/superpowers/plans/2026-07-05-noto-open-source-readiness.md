# Noto Open-Source Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Noto repository safe and presentable to publish as open source on GitHub — close the one confirmed security vulnerability, remove tracked junk and a deliberately-failing test, add the missing LICENSE/README, clean up lint, and fix the one high-impact design bug.

**Architecture:** Fixes are grouped into independent tasks that touch disjoint files so they can be executed in parallel by subagents. Git-index operations (Task 3) are serial and run in the real working tree. The security fix (Task 1) is the critical path and is adversarially verified. Nothing is pushed; each task commits on the current `feat/noto-web-app` branch, leaving the user's 11 pre-existing dirty files untouched.

**Tech Stack:** Node/Express + SQLite server (TypeScript, ESM `.ts` imports), Vite + React front end, Vitest, ESLint (flat config), Swift 6 SwiftPM package, Swift Testing.

**User decisions (locked):** MIT license · leave git history as-is (no rewrite) · commit fixes in logical commits, do not push.

---

## Findings → Task map

| # | Finding | Severity | Task |
|---|---------|----------|------|
| SEC-1 | GitHub App connector installation IDOR (`auth/github.ts`) | High | Task 1 |
| PUB-1 | Deliberately-failing Swift test + marker files | Blocker | Task 2 |
| PUB-2 | Tracked junk: `.DS_Store`×5, DMGs×4, worktree gitlink, `.tmp-failing-test-note`, `.claude/launch.json`, dup images | Should-fix | Task 3 |
| PUB-3 | `.gitignore` misses `.DS_Store`/`.claude/`/`.env`/sqlite | Should-fix | Task 3 |
| PUB-4 | No LICENSE (all-rights-reserved) | Blocker | Task 4 |
| PUB-5 | No root README; `landing/README.md` is stock Vite template | Blocker | Task 5 |
| PUB-6 | `npm run lint` red: 9 errors | Should-fix | Task 6 |
| DES-1 | Features-page "Download" button invisible in dark mode | High | Task 7 |
| DES-2 | "1 notes" pluralization in Dump MOC | Polish | Task 7 |
| PUB-7 | Absolute `<home>/...` paths in 3 tracked docs | Note | Task 8 |
| — | Final verification + report | — | Task 9 |

---

### Task 1: Fix the GitHub App installation IDOR (SEC-1)

**Why:** `handleGithubCallback` stores the attacker-supplied `installation_id` from the callback query without proving the authenticated user controls that installation. The `code` exchange is optional (guarded by `if (typeof code === "string" && code.length > 0)`), so an attacker can call `/api/auth/github/callback?state=<own-nonce>&installation_id=<victim-id>` with no `code` at all and bind a victim's installation to their own account. `installationId` later feeds `mintInstallationToken` (App-JWT minted, works for any installation), exposing the victim's private-repo prose via `/api/dump/github/repos` and dump jobs.

**Fix:** Make the `code` exchange mandatory and verify the installation is one the user actually controls by calling `GET /api/user/installations` with the user token and requiring `installation_id` to be in the list. Fail closed otherwise.

**Files:**
- Modify: `landing/server/auth/github.ts` (the `handleGithubCallback` function, ~lines 112-150)
- Test: `landing/server/auth/github.test.ts`

- [ ] **Step 1: Read the current callback and test file** to learn the injection/mock pattern (`ghFetch` is injectable; tests fake `fetch`). Confirm `API_USER` constant exists and add a sibling `API_USER_INSTALLATIONS = "https://api.github.com/user/installations"`.

- [ ] **Step 2: Write failing tests** in `landing/server/auth/github.test.ts` covering the new behavior:

```ts
// 1. Callback with NO code is rejected (was: silently saved).
//    -> expect redirect with error=github_code and saveConnectorToken NOT called.
// 2. Callback where /user/installations does NOT contain installation_id is rejected.
//    -> expect redirect error=github_install_mismatch, saveConnectorToken NOT called.
// 3. Callback where /user/installations DOES contain installation_id succeeds.
//    -> saveConnectorToken called once with that installationId.
```

Use the existing test's mock style (spy on `saveConnectorToken`, stub the token-exchange `fetch` and `ghFetch`). Match how the current suite injects fakes — do not invent a new harness.

- [ ] **Step 3: Run tests to verify they fail.** `cd landing && npx vitest run server/auth/github.test.ts`. Expected: the three new tests FAIL.

- [ ] **Step 4: Implement the fix** in `handleGithubCallback`. Replace the best-effort identity block + unconditional save with:
  - Require `code` present; if absent → `return fail(res, "github_code")`.
  - Exchange `code`; if the exchange fails or returns no `access_token` → `return fail(res, "github_code")`.
  - With the user token, `GET https://api.github.com/user/installations` via `ghFetch` (paginated defensively: read `installations[].id`); if the request fails → `return fail(res, "github_install")`.
  - If `String(id) === installation_id` is not found among the results → `return fail(res, "github_install_mismatch")`.
  - Only then `saveConnectorToken({...})` as before. Keep `login`/`userTokenCipher` capture.

  Keep the 8s abort/timeout behavior of `ghFetch`. Do not weaken the existing state/session/CSRF checks.

- [ ] **Step 5: Run the full auth suite.** `cd landing && npx vitest run server/auth/` — all pass.

- [ ] **Step 6: Commit.**
```bash
git add landing/server/auth/github.ts landing/server/auth/github.test.ts
git commit -m "fix(security): verify GitHub App installation ownership in OAuth callback"
```

---

### Task 2: Remove the deliberately-failing Swift test + markers (PUB-1)

**Why:** `Tests/NotoCoreTests/TemporaryFailureTests.swift` contains `@Test func temporaryFailureProbe() { #expect(false) }` — it fails on any working Swift test runner (CI). `.tmp-failing-test-note` ("temporary debugging marker") is its tracked companion.

**Files:**
- Delete: `Tests/NotoCoreTests/TemporaryFailureTests.swift`
- Delete: `.tmp-failing-test-note`
- Check: `Checks/NotoCoreChecks/` for any reference to `temporaryFailureProbe` (grep; there should be none).

- [ ] **Step 1: Confirm no references.** `grep -rn "temporaryFailure\|TemporaryFailure" . --include="*.swift"` — expect only the test file itself.
- [ ] **Step 2: Delete both files.** `git rm Tests/NotoCoreTests/TemporaryFailureTests.swift .tmp-failing-test-note`
- [ ] **Step 3: Verify the package still builds.** `swift build` — "Build complete!".
- [ ] **Step 4: Commit.**
```bash
git commit -m "test: remove deliberately-failing debug probe and marker"
```

---

### Task 3: Untrack junk + harden .gitignore (PUB-2, PUB-3) — SERIAL, run in main tree

**Why:** Build artifacts, macOS cruft, a broken worktree gitlink (breaks clones), and local AI-tooling config are tracked; `.gitignore` doesn't prevent recurrence.

**Files:**
- Untrack (keep on disk): 5×`.DS_Store`, 4× `dist/*.dmg`, `.claude/worktrees/pensive-ardinghelli-10ac87` (gitlink), `.claude/launch.json`, duplicate images.
- Modify: root `.gitignore` (already has an uncommitted `.gstack/` addition from the user — preserve it).

- [ ] **Step 1: Untrack the gitlink and junk (cached only):**
```bash
git rm --cached .claude/worktrees/pensive-ardinghelli-10ac87
git rm --cached .DS_Store Sources/.DS_Store Tests/.DS_Store docs/.DS_Store docs/superpowers/.DS_Store
git rm --cached dist/Noto.dmg dist/Noto-dark-theme.dmg dist/Noto-20260516-101332.dmg dist/Noto-20260516-130114.dmg
git rm --cached .claude/launch.json
git rm 'landing/public/images/ChatGPT Image May 21, 2026, 03_06_51 PM.jpg' landing/public/images/noto-editor.png
```
(`ChatGPT Image….jpg` and `noto-editor.png` are byte-identical duplicates of the referenced `features-hero.jpg`; verify nothing references them: `grep -rn "noto-editor.png\|ChatGPT Image" landing/ --include=*.css --include=*.tsx --include=*.ts --include=*.html` before deleting.)

- [ ] **Step 2: Rewrite root `.gitignore`** to (preserving the user's `.gstack/` line):
```gitignore
# macOS
.DS_Store

# Local tooling / AI config
.superpowers/
.worktrees/
.gstack/
.claude/

# Dependencies / build
node_modules/
/server/
.build/
.swiftpm/
DerivedData/
dist/

# Secrets & local data (belt-and-braces; landing/.gitignore covers landing/)
.env
.env.*
!.env.example
*.sqlite
*.sqlite-shm
*.sqlite-wal
```

- [ ] **Step 3: Verify** `git status` shows the removals staged and `git check-ignore .DS_Store .claude/launch.json` returns matches.
- [ ] **Step 4: Commit.**
```bash
git add .gitignore
git commit -m "chore: untrack build artifacts and local config; harden .gitignore for public repo"
```

---

### Task 4: Add MIT LICENSE (PUB-4)

**Files:** Create `LICENSE`.

- [ ] **Step 1: Write `LICENSE`** — standard MIT text, `Copyright (c) 2026 Aleksandr Vanin`.
- [ ] **Step 2: Add `"license": "MIT"`** to `landing/package.json` and `noto-mcp/package.json` (the latter is npm-publishable and lacks one).
- [ ] **Step 3: Commit.**
```bash
git add LICENSE landing/package.json noto-mcp/package.json
git commit -m "docs: add MIT license"
```

---

### Task 5: Add root README + rewrite landing README (PUB-5)

**Why:** No root README (bare file listing on GitHub); `landing/README.md` is the untouched Vite template.

**Files:** Create `README.md`; overwrite `landing/README.md`.

- [ ] **Step 1: Write root `README.md`** covering: what Noto is (from CLAUDE.md — local-first Markdown notes workspace + AI lecture assistant; slogan "When you listen, Noto remembers."), the two halves (macOS SwiftUI app at root; web app + Express/SQLite server under `landing/`), build/run for both (`swift build`/`swift run Noto`; `cd landing && npm i && npm run dev`), the connectors/AI/Dump/MCP features at a high level, a note that connectors and AI need env vars (`landing/.env.example`), license (MIT), and that the app is local-first / data stays on device. Keep it accurate to the code — do not invent features.
- [ ] **Step 2: Rewrite `landing/README.md`** to describe the actual web app + server (scripts from `landing/package.json`: `dev`, `build`, `test`, `lint`, `server`; env setup via `.env.example`; that `server/data/` is the local SQLite store). Remove all stock Vite boilerplate.
- [ ] **Step 3: Commit.**
```bash
git add README.md landing/README.md
git commit -m "docs: add project README and replace stock Vite landing README"
```

---

### Task 6: Fix ESLint errors (PUB-6)

**Why:** `npm run lint` exits 1 with 9 errors — a bad first impression for contributors.

**Files (each an isolated fix):**
- `landing/src/onboarding/screens/CommandTutorial.tsx:52` — `react-hooks/immutability`: the self-referential `add(() => run(), 7100)` inside `run`'s own `useCallback`. Fix by hoisting the recursive scheduler into a `useRef` holding the latest `run`, or restructure so the loop restarts via a stable ref — must preserve the animation loop. Verify the tutorial still animates.
- `landing/src/onboarding/Onboarding.tsx:35` — `react-hooks/set-state-in-effect`: wrap the synchronous `setOauthError`/`setMode` so they don't run in the effect body (e.g. guard/derive, or move to an event/queueMicrotask), preserving behavior.
- `landing/src/workspace/ActivityView.tsx:55` — `react-hooks/set-state-in-effect` on `useEffect(() => load(), [load])`.
- `landing/src/workspace/ActivityView.tsx:57` — `no-unused-expressions`: `(confirm ? setConfirm(null) : onClose())` → rewrite as an `if/else` statement.
- `landing/server/auth/google.ts:46,93,134` — 3× `no-explicit-any`: replace `any` with precise types or `unknown` + narrowing.
- `landing/src/onboarding/api.ts:58` — `no-explicit-any`.
- `landing/server/notes/write.test.ts:2` — remove unused import `makeCookieClient`.

- [ ] **Step 1:** Fix each file with the minimal change; do not alter behavior. For the React-hooks rules, prefer a correct refactor over an `eslint-disable`; use a scoped `// eslint-disable-next-line <rule>` with a one-line justification ONLY if a correct refactor risks the animation/UX.
- [ ] **Step 2: Verify lint is clean.** `cd landing && npx eslint .` — exit 0.
- [ ] **Step 3: Verify nothing broke.** `cd landing && npx tsc -b && npx vitest run` — green.
- [ ] **Step 4: Commit.**
```bash
git add landing/src/onboarding/screens/CommandTutorial.tsx landing/src/onboarding/Onboarding.tsx landing/src/workspace/ActivityView.tsx landing/server/auth/google.ts landing/src/onboarding/api.ts landing/server/notes/write.test.ts
git commit -m "chore: fix ESLint errors for a clean lint run"
```

---

### Task 7: Fix the dark-mode button contrast + pluralization (DES-1, DES-2)

**Why (DES-1):** On `features.html` in dark mode the "Download for macOS" button renders near-white text `rgb(235,240,250)` on white `#fff` (~1.06:1, invisible). `.f-btn-light` sets `color: var(--page-ink)`, which the dark theme overrides to near-white — but the button background is always white.

**Why (DES-2):** `landing/server/dump/assemble.ts:54` emits `${memberTitles.length} notes` → "1 notes".

**Files:**
- Modify: `landing/src/styles/landing.css` (`.f-btn-light`, ~line 1404).
- Modify: `landing/server/dump/assemble.ts:54`.
- Test: `landing/server/dump/assemble.test.ts` (add/adjust a pluralization assertion).

- [ ] **Step 1 (DES-1):** Change `.f-btn-light` `color: var(--page-ink)` to a fixed dark ink (`color: #0C0D0F;`) so it's always dark on the white button, in both themes. Confirm the same class isn't relied on elsewhere to be theme-adaptive (grep `f-btn-light`).
- [ ] **Step 2 (DES-2):** Change the MOC line to pluralize: `${memberTitles.length} ${memberTitles.length === 1 ? "note" : "notes"}`.
- [ ] **Step 3:** Add/adjust an `assemble.test.ts` case asserting a single-member MOC says "1 note". Run `cd landing && npx vitest run server/dump/assemble.test.ts` — green.
- [ ] **Step 4: Commit.**
```bash
git add landing/src/styles/landing.css landing/server/dump/assemble.ts landing/server/dump/assemble.test.ts
git commit -m "fix(ui): make features hero download button legible in dark mode; pluralize MOC note count"
```

---

### Task 8: Scrub absolute local paths from docs (PUB-7)

**Why:** Three tracked docs hardcode `<repo-root>`, leaking the macOS username.

**Files:**
- `docs/superpowers/plans/2026-06-28-noto-shared-memory-sp4.md:706`
- `docs/superpowers/plans/2026-06-28-noto-shared-memory-sp5a.md:671`
- `docs/superpowers/NEXT-SESSION-sp3-sp5.md:3`

- [ ] **Step 1:** Replace `<repo-root>` with a relative/generic path (e.g. `<repo-root>` or `./`) on each line, preserving surrounding meaning.
- [ ] **Step 2: Confirm** `grep -rn "<home>" docs/` returns nothing.
- [ ] **Step 3: Commit.**
```bash
git add docs/
git commit -m "docs: replace absolute local paths with repo-relative references"
```

---

### Task 9: Final verification + report

- [ ] **Step 1: Adversarially verify the security fix** (independent subagent): re-trace the callback; confirm no path saves an unverified `installation_id` (missing `code`, exchange failure, `/user/installations` failure, or id-not-in-list all fail closed) and that the state/session checks are intact.
- [ ] **Step 2: Run the full gate:**
```bash
cd landing && npx vitest run && npx tsc -b && npx tsc -p tsconfig.server.json --noEmit && npx eslint . && npm run build
cd .. && swift build && swift run NotoCoreChecks
```
All green.
- [ ] **Step 3:** Confirm `git status` shows only the intended commits and that the user's original 11 dirty files remain unstaged/untouched.
- [ ] **Step 4:** Write the final report (findings, fixes, verification evidence, and the remaining user-owned decisions: publish visibility, force-push if they later choose history rewrite, logos provenance).
