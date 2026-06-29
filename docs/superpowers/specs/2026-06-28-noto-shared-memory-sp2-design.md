# Noto Shared Memory — SP2 Design (write-back loop + multi-client)

**Date:** 2026-06-28
**Status:** Approved design (brainstorm complete) — ready for implementation plan
**Depends on:** SP1 (implemented, uncommitted on `feat/noto-web-app`). Companion: `2026-06-28-noto-shared-memory-sp1-design.md`, `2026-06-28-noto-stage-a-wedge-analysis.md`.

## 0. What SP2 is

SP1 gave AI tools **read** access to notes + an **atomic** `remember`/`recall` store (Claude Code only). SP2 closes the wedge's **write-back loop**: AI tools write durable memory *back* into Noto — both atomic (already shipped) and **narrative `Memory/*.md` pages** — **hard-confined to a `Memory/` folder so they can never clobber human notes**, with provenance on every write, and **Cursor + Codex** wired alongside Claude Code.

This directly delivers the two wedge pillars SP1 deferred: the **auditable write-back loop as default behavior** and the **trust layer** (writes are confined + audited). It is the sharpest, highest-risk-retired slice after SP1.

## 1. Scope

**In:**
- `isMemoryPath()` confinement guard + its application to all PAT-authed note writes.
- `POST /api/notes` (create a note in the user's default vault) and `POST /api/files/:fileId/append` (append text, optionally under a heading); `Memory/` confinement added to the existing `PATCH /api/files/:fileId/section` for PAT writes.
- `appendUnderHeading()` helper in `notes/sections.ts`.
- 3 new `noto-mcp` tools: `create_note`, `append_note`, `update_section` (→ 9 tools total) + matching `notoClient` methods.
- `mcpConfigs.ts` — pure generator for per-client config snippets + steering templates.
- Settings panel extended: per-client tabs (Claude Code / Cursor / Codex) with config + steering + Codex native-memory reconciliation; mint default scopes become `read,memory,write`.

**Out (later sub-projects):** writes outside `Memory/` (future opt-in) · provenance/revert **UI** → SP3 · remote Streamable-HTTP `/mcp` → SP4 · embeddings/semantic/decay/consolidation → SP5 · any `delete` tool · multi-vault selection · response pagination.

## 2. Locked decisions

| # | Decision | Choice |
|---|---|---|
| S2-D1 | Write confinement | **`Memory/` only, server-enforced.** PAT writes whose target path is not under `Memory/**` → **403**. Cookie (browser) sessions are unconfined. Hard guarantee, not steering-dependent. Widening is a later opt-in. |
| S2-D2 | Narrative structure | **Free-form under `Memory/`, steered.** No fixed page taxonomy; the agent maintains `Memory/*.md` as it sees fit, guided by steering text. |
| S2-D3 | Client coverage | **Cursor + Codex both**, plus Claude Code from SP1. Includes Codex native-memory reconciliation. |
| S2-D4 | Write scope | Reuse the existing **`write`** PAT scope (already gates section PATCH). The Settings panel mints `read,memory,write` by default; `write` is safe because it's `Memory/`-confined. |
| S2-D5 | Atomic vs narrative | **Both, distinct roles.** Atomic `remember`/`recall` = short single facts; narrative `Memory/*.md` = longer prose/logs/glossaries. Steering tells the agent which to use. |
| S2-D6 | Delete | **Still out.** No delete tool/endpoint in SP2. |

## 3. Architecture (delta on SP1)

Same chain: `noto-mcp` (stdio) → HTTPS + Bearer PAT + `X-Noto-Client` → Express `/api` → SQLite. SP2 adds:

```
noto-mcp: 6 → 9 tools (+create_note, +append_note, +update_section)
   │
   ▼  HTTPS + Bearer PAT (scope: write) + X-Noto-Client
Express /api:
   • POST /api/notes                     (NEW — create in default vault)
   • POST /api/files/:id/append          (NEW — append text / under heading)
   • PATCH /api/files/:id/section        (EXISTING — + Memory/ confinement for PAT)
   • isMemoryPath() guard                (NEW — PAT writes → Memory/** or 403)
   • writeAudit on every write           (REUSE)
SQLite: no schema changes (files_fts triggers already index new/edited notes).
```

**No new tables.** Narrative pages are ordinary `files` rows under `Memory/`; `files_fts` (SP1) already indexes them, so `search_notes` finds them for free.

**Component boundaries (each small, testable):**
1. `notes/confinement.ts` — pure `isMemoryPath(path)` (+ `MEMORY_PREFIX`). One responsibility: the boundary predicate.
2. `notes/sections.ts` — add pure `appendUnderHeading(content, headingPath, text)` (builds on existing `getSection`/`replaceSection`).
3. `notes/routes.ts` — `POST /api/notes`, `POST /api/files/:id/append`, confinement on section PATCH. Thin HTTP glue over `db.ts` + the pure helpers.
4. `noto-mcp/src/{notoClient,tools,index}.ts` — 3 new methods/handlers/registrations.
5. `landing/src/workspace/mcpConfigs.ts` — pure per-client snippet/steering generator.
6. `landing/src/workspace/McpSettings.tsx` — per-client tabs UI.

## 4. The confinement boundary (the core safety mechanism)

```ts
// landing/server/notes/confinement.ts
export const MEMORY_PREFIX = "Memory/";
/** True if a vault-relative path is inside the agent-writable Memory/ folder. */
export function isMemoryPath(path: string): boolean {
  return path.startsWith(MEMORY_PREFIX) && !path.slice(MEMORY_PREFIX.length).includes("..");
}
```
Applied in `notes/routes.ts` for every PAT-authed write:
- `POST /api/notes`: reject if `req.apiUser && !isMemoryPath(parsed.path)` → `403 {error:"AI writes are confined to Memory/"}`.
- `POST /api/files/:id/append` and `PATCH …/section`: load the owned file first, then reject if `req.apiUser && !isMemoryPath(file.path)` → 403.
- Cookie sessions (`!req.apiUser`) skip the guard — the human can edit anything.

This makes "an AI can't touch notes outside `Memory/`" a server guarantee independent of best-effort steering — the trust pillar of the wedge.

## 5. Endpoints

### 5.1 `POST /api/notes` — create in default vault
- Auth: PAT (`write` scope) or cookie. Body: `{ path, title, content? }` (reuse SP1/existing `createSchema`: pathSchema `.md`/traversal-guarded, titleSchema, contentSchema ≤256 KB).
- Resolve vault: `ensureDefaultVault(uid)` then first vault from `getVaultsForUser(uid)` (created_at ASC = "My Vault").
- Confinement (PAT only), quota (`MAX_FILES_PER_VAULT`), path-collision → 409, then `createFile`. `writeAudit({tool:"create_note", target:fileId})`. → `201 {fileId, path}`.

### 5.2 `POST /api/files/:fileId/append`
- Auth: PAT (`write`) or cookie. Body: `{ text:string(1..256KB), underHeading?:string, expectUpdatedAt?:number }`.
- `getOwnedFile` (404 on miss) → confinement (PAT) → optimistic `expectUpdatedAt` (409 stale).
- If `underHeading`: `appendUnderHeading(content, heading, text)` (404 + outline if heading missing; 409 if ambiguous, reusing SP1's duplicate-heading guard). Else append to end (`content.trimEnd() + "\n\n" + text + "\n"`).
- `writeAudit({tool:"append_note", target, beforeHash})` → `updateFile` → `200 {fileId, updatedAt}`.

### 5.3 `PATCH /api/files/:fileId/section` (existing) — add confinement
- After `getOwnedFile`, add: `if (req.apiUser && !isMemoryPath(file.path)) return 403`. Everything else unchanged (write scope, ambiguity 409, `expectUpdatedAt`, audit).

## 6. `noto-mcp` tools (6 → 9)

| Tool | Input | → endpoint | Returns |
|---|---|---|---|
| **create_note** | `{path, title, content?}` | `POST /api/notes` | `{fileId, path}` |
| **append_note** | `{fileId, text, underHeading?, expectUpdatedAt?}` | `POST /api/files/:id/append` | `{fileId, updatedAt}` |
| **update_section** | `{fileId, heading, content, expectUpdatedAt?}` | `PATCH /api/files/:id/section` | `{fileId, updatedAt}` |

- `notoClient.ts`: add `createNote`/`appendNote`/`updateSection` (Bearer + `X-Noto-Client`, error→throw, same as SP1 methods).
- `tools.ts`: 3 handlers, `try/catch → fail()` (errors surface as `isError`, never crash). These are write tools — they do **not** inject `ctx.scope` (path-addressed, not scope-addressed).
- `index.ts`: register 3 tools with steering descriptions, e.g. create_note: *"Create a note. Agent writes must live under `Memory/` (e.g. `Memory/decisions.md`)."*; update_section: *"Edit one section of a `Memory/` note by heading; prefer this over rewriting."* Tool count 9 ≪ Cursor's ~40 cap.

## 7. Narrative pages ↔ atomic memory (the boundary)

- **Atomic** (`remember`/`recall`, SP1): one-line durable facts/decisions/preferences; structured, deduped, recalled by query+scope. *"We use Postgres."*
- **Narrative** (`Memory/*.md`, SP2): longer prose — design rationale, running decision logs, glossaries, project context. Real notes: `search_notes` finds them, `get_section` reads a slice, `update_section`/`append_note` edit surgically, browsable/editable in Noto's UI.
- **Steering decides which:** quick fact → `remember`; richer/longer/log-style → write into a `Memory/` page. Both are scoped to the project; both audited.

## 8. Part C — Cursor + Codex wiring

### 8.1 `mcpConfigs.ts` (pure, testable) — generates from `{notoUrl, token}`:
- **Claude Code** `.mcp.json`: `{ mcpServers: { noto: { command:"npx", args:["-y","noto-mcp"], env:{ NOTO_URL, NOTO_TOKEN, NOTO_CLIENT:"claude-code" } } } }`
- **Cursor** `.cursor/mcp.json`: same shape, `NOTO_CLIENT:"cursor"`.
- **Codex** `~/.codex/config.toml`:
  ```toml
  [mcp_servers.noto]
  command = "npx"
  args = ["-y", "noto-mcp"]
  env = { NOTO_URL = "<url>", NOTO_TOKEN = "<token>", NOTO_CLIENT = "codex" }

  [memories]
  disable_on_external_context = true   # let Noto be the single source of truth
  ```

### 8.2 Steering templates (copy-paste; live in the user's coding projects, not the Noto repo)
Shared body (used by `CLAUDE.md`, `AGENTS.md`, and the `.mdc` rule):
```
## Noto shared memory (MCP server: noto)
Noto is your persistent, cross-session memory, shared across your AI tools.
- BEFORE a task that depends on prior context, decisions, or my preferences:
  call `recall` and `search_notes` (scoped to this project); fetch only the
  sections you need with `get_section`. Don't re-read a note whose updatedAt you have.
- AFTER a durable decision/preference/fact emerges: persist it — `remember` for a
  one-line fact, or write narrative into a `Memory/` page via `create_note` /
  `append_note` / `update_section`. Store durable things only; never secrets.
- NEVER write outside `Memory/`. Prefer `append_note`/`update_section` over rewrites.
```
- **Cursor** `.cursor/rules/noto-memory.mdc`: prepend frontmatter `---\ndescription: When to read/write Noto shared memory via MCP\nalwaysApply: false\n---`.
- **Codex** `AGENTS.md`: the body verbatim (Codex also reads `AGENTS.md`; Cursor does too, so one `AGENTS.md` can serve both).

### 8.3 Settings panel (`McpSettings.tsx`)
- Mint default scopes → `read,memory,write` (label: "write is limited to your `Memory/` folder").
- Per-client tabs: **Claude Code / Cursor / Codex** — each shows its config snippet (from `mcpConfigs.ts`) + the steering template + (Codex) the native-memory reconciliation note.
- Existing token list + memory browse unchanged.

## 9. Safety, concurrency, provenance

- **Confinement** (§4): the hard boundary. Unit-tested + endpoint-tested (PAT write outside `Memory/` → 403).
- **Concurrency:** `expectUpdatedAt` on append/update_section (409 stale); create 409s on collision. Append is additive (low conflict) but still guarded + audited.
- **Provenance/audit:** `writeAudit` on create/append/update_section records `token_id` + `tool` + a pre-image `beforeHash` in `audit_log` (note edits do NOT carry `source_client` — that column lives on `memories` only; SP3's browse/revert UI consumes this audit data).
- **Scope:** writes need `write` (read/memory-only token → 403). Confinement is enforced *in addition to* the scope check.

## 10. Testing

- **Server** (`notes/confinement.test.ts`, `notes/write.test.ts`, extend `sections.test.ts`): `isMemoryPath` truth table (incl. traversal); `appendUnderHeading` (append within section, missing→null); create (default-vault, `Memory/` confine 403, dup→409, write-scope→403 for read/memory token); append (end + under-heading, audit, stale→409, confine 403); section PATCH confinement (PAT write to a non-`Memory/` note → 403); cross-user isolation (404).
- **`noto-mcp`** (extend `notoClient.test.ts`, `tools.test.ts`): 3 client methods (URL/verb/body + `X-Noto-Client`); 3 handlers (happy + isError); `tools/list` now 9.
- **Client** (`mcpConfigs.test.ts`): each client's snippet contains the right command/url/token/NOTO_CLIENT; Codex includes `disable_on_external_context`. UI: typecheck + build + visual smoke of the per-client tabs.

## 11. Success criteria

- A `write`-scoped PAT can `create_note`/`append_note`/`update_section` **under `Memory/`**, and is **403 outside `Memory/`** (server-enforced).
- The full loop works end-to-end via the real `noto-mcp` server: `remember` + write a `Memory/` page in one session → `recall` + `search_notes`/`get_section` retrieve them in a fresh session, with provenance.
- All three clients have working, copy-paste config + steering in the Settings panel; Codex config includes native-memory reconciliation.
- `noto-mcp` exposes exactly 9 tools; **no `delete`**; writes cannot escape `Memory/`.
- Full suite green (landing + `noto-mcp`), typecheck/lint/build clean.
```
