# Noto Shared Memory — SP3 Design (provenance / trust UI)

**Date:** 2026-06-28
**Status:** Approved design (brainstorm complete) — ready for `superpowers:writing-plans`
**Depends on:** SP1 + SP2 (implemented, committed on `feat/noto-web-app`). Companions: `2026-06-28-noto-shared-memory-sp1-design.md`, `2026-06-28-noto-shared-memory-sp2-design.md`, `2026-06-28-noto-stage-a-wedge-analysis.md`.

## 0. What SP3 is

SP1 gave AI tools **read** + an atomic `remember`/`recall` store; SP2 closed the **write-back loop** (narrative `Memory/*.md` pages, `Memory/`-confined, audited, Claude Code + Cursor + Codex). Both **recorded** provenance but surfaced none of it. SP3 builds the **trust layer**: a UI to **browse what each AI wrote** and **revert it**.

This is the wedge's defensibility pillar (Stage-A gap **G4**, idea **#5**): *auditable, revertible AI writes — nobody in the landscape has it, and it directly attacks the Mem-style auto-organize distrust.* The data is already accruing in `audit_log` (one row per AI write) and `memories` (full history kept); SP3 makes it legible and actionable.

## 1. Scope

**In:**
- `audit_log` gains `source_client` + `after_hash` (additive columns).
- New `audit_snapshots` table — pre-edit note content for `append_note` / `update_section` (enables true content revert).
- `GET /api/activity` — enriched, filtered AI-write timeline; `GET /api/activity/:auditId/preview` — diff data; `POST /api/activity/:auditId/revert` — perform the inverse, guarded + audited.
- `db.ts` helpers for the above; write-site changes in `notes/routes.ts` + `memory/routes.ts` to persist `source_client`, `after_hash`, and snapshots.
- A dedicated **AI Activity** view (`workspace/ActivityView.tsx`), a per-note "AI changes" entry point, an `ActivityClient` DI interface + real impl, `api.activity.*`, and gated mounting in `NotoWindow.tsx`.

**Out (later sub-projects / never):** human-edit version history (the timeline is AI-only by construction) · remote Streamable-HTTP `/mcp` → SP4 · embeddings/semantic/decay → SP5 · any AI-facing `delete` tool · bulk/scheduled revert · multi-vault selection.

## 2. Locked decisions (brainstorm, 2026-06-28)

| # | Decision | Choice |
|---|---|---|
| S3-D1 | What "revert" means for note edits | **Snapshot pre-images.** `audit_log.before_hash` is only a sha256 — content can't be restored from it. Store the full pre-edit content in `audit_snapshots` for `append_note`/`update_section` going forward, enabling true one-click revert. `create_note` reverts by delete; memory undo is free (superseded rows are kept). Edits made **before SP3** have no snapshot → **verify-only** (hash badge, no restore). |
| S3-D2 | Where the UI lives | **Dedicated AI Activity view**, peer of Graph / Smart Search, opened from the sidebar. The per-note "AI changes" view is the same timeline filtered to one `fileId`. The MCP modal (`McpSettings.tsx`) is unchanged. |
| S3-D3 | Provenance precision | **Add `source_client` to `audit_log`**, populated from the `X-Noto-Client` header already computed at every write site. Makes the source/client filter precise + uniform across notes and memories. |
| S3-D4 | Who can revert | **Humans only (cookie session).** A PAT cannot revert (no mass-undo by an AI; consistent with "AI can't delete"). Every revert is itself written to `audit_log` (`tool:'revert'`). |
| S3-D5 | Conflict guard | **`after_hash` per audited write.** At revert time, compare current content hash to `after_hash`: match ⇒ clean revert; mismatch ⇒ "changed since this edit" warning + diff, human confirms or cancels (last-write-wins on confirm). |
| S3-D6 | Timeline membership | **AI writes + reverts.** Rows where `token_id IS NOT NULL` (PAT-authed AI writes) **plus** `tool='revert'` rows (a human's undo of an AI write — itself part of the trust log). Human web *edits* write no audit row at all, so they never appear regardless. |

## 3. Architecture (delta on SP1/SP2)

Same stack. No new transport. SP3 is server endpoints + a client view over data that already exists.

```
SQLite:
  audit_log  (EXISTING)  + source_client TEXT, + after_hash TEXT
  audit_snapshots (NEW)  audit_id PK → audit_log(id) ON DELETE CASCADE, content TEXT
  memories / files / pat_tokens  (EXISTING — read for enrichment + revert)
Express /api:
  GET  /api/activity                  (NEW — enriched, filtered timeline; cookie auth)
  GET  /api/activity/:auditId/preview (NEW — { before, current } for the diff dialog)
  POST /api/activity/:auditId/revert  (NEW — inverse action, guarded + audited; cookie only)
  writeAudit(...)                     (EXTEND — also persist source_client + after_hash; snapshot on note edits)
Client (landing/src):
  app/api.ts                 + activity: { list, preview, revert }
  workspace/activityClient.ts (NEW) ActivityClient DI interface (mirrors mcpClient.ts)
  app/activityClient.ts      (NEW) real impl over api.activity (mirrors app/mcpClient.ts)
  workspace/ActivityView.tsx (NEW) dedicated timeline + filters + revert dialog
  workspace/Sidebar.tsx      + an "AI Activity" entry (alongside "Connect AI tools")
  workspace/NotoWindow.tsx   + activityOpen state; mount gated on `activityClient` (like mcpClient)
```

**Component boundaries (each small, testable):**
1. `audit/snapshots` helpers in `db.ts` — `writeSnapshot`, `getSnapshot`; one responsibility: pre-image persistence/lookup.
2. `audit/activity.ts` (server) — pure enrichment + the revert dispatcher (inverse-action per `tool`), thin glue over existing `db.ts` helpers (`getOwnedFile`/`updateFile`/`deleteFile`/`rememberMemory` internals).
3. `audit/routes.ts` (server) — `/api/activity*` HTTP glue (cookie auth, zod, ownership).
4. `workspace/activityClient.ts` + `app/activityClient.ts` — DI seam (so the demo runs without a backend).
5. `workspace/ActivityView.tsx` — presentation only; all data via the injected `ActivityClient`.

## 4. Data model (additive only)

### 4.1 `audit_log` — two new columns
```
source_client TEXT          -- 'claude-code' | 'cursor' | 'codex' | 'web'; from X-Noto-Client at write time
after_hash    TEXT          -- sha256 of the post-write file content (note tools); null for memory tools
```
`before_hash` is retained as-is. `writeAudit({...})` (currently `db.ts:594`) gains optional `sourceClient` + `afterHash`; existing `idx_audit_user(user_id, created_at)` already serves the timeline. The `CREATE TABLE IF NOT EXISTS` migration adds the columns via the existing additive-migration pattern in `db.ts` (a guarded `ALTER TABLE ... ADD COLUMN` for already-existing DBs, mirroring how other late columns were added).

### 4.2 `audit_snapshots` (new)
```
audit_id  TEXT PRIMARY KEY REFERENCES audit_log(id) ON DELETE CASCADE
content   TEXT NOT NULL     -- full pre-edit file content (the same string before_hash hashes)
```
Written **only** for `append_note` and `update_section` (the two content-mutating note edits). Capped implicitly by the existing 256 KB note-content limit. Kept in a side table so the timeline `SELECT` never drags note bodies; fetched lazily by preview/revert.

### 4.3 Enrichment read shape (server → client)
```ts
interface ActivityEntry {
  id: string;            // audit_log.id
  tool: string;          // create_note | append_note | update_section | remember | supersede | revert
  createdAt: number;
  client: string;        // audit_log.source_client
  device: string | null; // pat_tokens.name (joined on token_id)
  target: {
    kind: "note" | "memory";
    id: string | null;             // fileId or memoryId (null if the row's target is gone)
    title: string | null;          // files.title  (note) ;  null otherwise
    path: string | null;           // files.path   (note)
    text: string | null;           // memories.text (memory, truncated ≤160)
    status: string | null;         // memories.status (memory)
    exists: boolean;               // target row still present & owned
  };
  revertible: boolean;   // computed per §5
  hasSnapshot: boolean;  // audit_snapshots row exists (for note edits)
}
```

## 5. Revert semantics (the inverse-action dispatcher)

`POST /api/activity/:auditId/revert` — **cookie session only** (PAT ⇒ 403). Loads the audit row (404 if not owned by the current user). Dispatches on `tool`; each path checks the **conflict guard** (`after_hash` vs current content hash) for note tools and writes a fresh `audit_log` row (`tool:'revert'`, `target:` the reverted target, `source_client:'web'`).

| Audit `tool` | Inverse action | `revertible` precondition | Conflict guard |
|---|---|---|---|
| `create_note` | `deleteFile(target)` | file exists & owned | `after_hash` ≠ current ⇒ "edited since the AI created it"; confirm to delete anyway |
| `append_note` / `update_section` | `updateFile(target, snapshot.content)` | snapshot row exists **and** file exists | `after_hash` ≠ current ⇒ "changed since this edit"; confirm to overwrite |
| `remember` | set memory `status='superseded'` (hidden from recall, kept for audit) | memory still `active` | n/a (memory store keeps history) |
| `supersede` | reactivate `memories.supersedes_id` (→ `active`), retire the target (→ `superseded`) | old superseded & new active | n/a |

- **Verify-only fallback:** a pre-SP3 `append_note`/`update_section` row has `hasSnapshot:false` ⇒ `revertible:false`; the UI shows a hash-verify badge ("matches / changed since") but no restore button.
- **Idempotency without a flag:** an already-reverted row recomputes `revertible:false` from current state (e.g. a deleted note's `create_note` row → file gone → not revertible). No `reverted_at` column needed for v1.
- **`revert` rows are display-only:** they appear in the timeline (so the undo is itself auditable) with `revertible:false` — SP3 does not revert a revert.
- **Response:** `{ status: "reverted" }` on success, `{ status: "conflict", before, current }` when the guard trips and the request did not pass `force:true`. `force:true` in the body performs the last-write-wins revert.

`GET /api/activity/:auditId/preview` returns `{ before: string | null, current: string | null }` — for note edits, `before` = snapshot content, `current` = live `files.content`; for `remember`/`supersede`, `before`/`current` carry the relevant memory text. Lazy so large bodies aren't in the list payload.

## 6. Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/activity?tool=&source=&fileId=&before=&limit=` | cookie | enriched timeline (`token_id IS NOT NULL` **OR** `tool='revert'`), filters, cursor on `created_at`; default `limit` 50 (max 100) |
| GET | `/api/activity/:auditId/preview` | cookie | `{ before, current }` for the diff dialog |
| POST | `/api/activity/:auditId/revert` | cookie | inverse action; body `{ force?: boolean }`; 403 for PAT; 404 cross-user; conflict → `{status:"conflict",…}` |

All under the existing `/api` app, zod-validated, ownership-scoped (audit rows filtered by `user_id`), behind the established limiter pattern (`handle()` wrapper + limiter, as in `ai/routes.ts`). Filters are server-side SQL (`tool = ?`, `source_client = ?`, `target = ?`).

## 7. UI

- **`workspace/ActivityView.tsx`** — a dedicated surface (not a modal), opened from the sidebar. Filter bar: **tool** (all / created / appended / edited / remembered / superseded), **client** (all / claude-code / cursor / codex), and an optional **file** filter (set when arrived via the per-note entry point). Reverse-chron list; each row: client badge + device name + a human verb ("Cursor appended to **Memory/decisions.md**"), relative time, and a **Revert** button — or a **verify-only** badge for snapshot-less rows. "Load more" via the `before` cursor.
- **Revert dialog** — confirm with the before/current diff from `/preview`; if the guard tripped, a "this changed since the AI wrote it" warning gates a second confirm (sends `force:true`). After success, the row updates to non-revertible and a `revert` entry appears.
- **Per-note "AI changes"** — a small affordance on a note (context panel / title area) that opens the Activity view pre-filtered to that file (`fileId`). Empty state when the note has no AI writes.
- **DI + gating:** `ActivityClient` interface in `workspace/activityClient.ts` (mirrors `mcpClient.ts`); real impl `app/activityClient.ts` over `api.activity` (mirrors `app/mcpClient.ts`); injected into `NotoWindow` and **mounted only when present** (`{activityOpen && activityClient && <ActivityView … />}`), exactly like `mcpClient` so the marketing demo never shows it. `api.ts` gains `activity: { list, preview, revert }` next to `pat` / `memory`.

## 8. Safety, concurrency, provenance

- **Revert is human-only + audited** (S3-D4): the trust surface can't be weaponized by a token, and undoing an undo is itself traceable.
- **Conflict guard** (S3-D5): no silent clobber of post-AI human edits; the diff + warning put the human in control.
- **Ownership:** every `/api/activity*` query and revert is filtered by the cookie user's `user_id`; user A can neither list nor revert user B's writes (404). Note/memory targets are re-checked owned before mutation (`getOwnedFile`, `user_id` on memory updates).
- **No new AI capability:** SP3 adds **zero** MCP tools; the `noto-mcp` surface stays at 9. The "no delete" guarantee is untouched (revert's delete is a human cookie action on a human-owned note).
- **Degradation:** pre-SP3 edits lose nothing — they're browsable and hash-verifiable, just not restorable.
- **Supersede-revert ordering:** retire the new memory (`status='superseded'`) **before** reactivating the old one, so the `UNIQUE(user_id, scope, norm_text) WHERE status='active'` index never momentarily sees two active rows with the same `norm_text`.

## 9. Testing (TDD, existing vitest stack)

- **Server (`audit/activity.test.ts`, `audit/routes.test.ts`, extend `notes/write.test.ts` + `memory/*`):**
  - `writeAudit` persists `source_client` + `after_hash`; snapshot written on `append_note`/`update_section`, absent on `create_note`/`remember`.
  - Timeline membership: AI writes (`token_id IS NOT NULL`) + `revert` rows only (human web edits absent); enrichment (device ← token name, client, note title/path, memory text, `exists`); filters (tool / source / fileId); cursor pagination; ownership isolation (A can't see B).
  - Revert clean paths: `create_note`→delete, `append_note`/`update_section`→restore snapshot, `remember`→superseded (excluded from `recall`), `supersede`→old reactivated/new retired.
  - Revert guards: `after_hash` mismatch → `{status:"conflict"}` without `force`; `force:true` overwrites; pre-SP3 row (no snapshot) → not revertible; already-reverted row → not revertible.
  - Revert auth: PAT → 403; cross-user → 404; each revert writes a `tool:'revert'` audit row.
- **Client (`activityClient` mock):** timeline render + filter interactions; revert confirm + diff; conflict warning → force path; revertible vs verify-only states; empty states; per-note filtered open. Typecheck (`npx tsc -b --noEmit`) + `npm run build`.

## 10. Success criteria

1. Every AI write (SP1/SP2 tools) appears in the AI Activity timeline with correct **client + device + target**.
2. Filter by **tool / client / file** works; the per-note entry point opens the file-filtered view.
3. **Revert** works end-to-end for all five tools; the conflict guard warns when content changed since the AI write and only overwrites on explicit confirm.
4. Revert is **human-only** and **itself audited**; ownership isolation holds (no cross-user list or revert).
5. Pre-SP3 note edits degrade gracefully to **verify-only**; `noto-mcp` still exposes exactly **9 tools, no delete**.
6. Full suite green (landing + `noto-mcp`), typecheck/lint/build clean; a live smoke: AI writes via the real `noto-mcp` server → the writes show in the Activity API → revert restores/deletes/undoes as specified.

## 11. File structure (proposed; writing-plans pins exact paths)

**Server — `landing/server/`:**
- `db.ts` — migrations (`audit_log` +2 cols, `audit_snapshots` table); `writeAudit` extended; `writeSnapshot`/`getSnapshot`; `listActivity` (filtered + joined) + `getAuditRow`; reuse `getOwnedFile`/`updateFile`/`deleteFile`/`stmtSupersede`/`sha256Hex`.
- `audit/activity.ts` — enrichment mapper + revert dispatcher (pure-ish over `db.ts`).
- `audit/routes.ts` — `/api/activity*` (mounted in `app.ts` with the other routers).
- write-site edits: `notes/routes.ts` (`create_note`/`append_note`/`update_section` → pass `sourceClient` + `afterHash`; snapshot on the two edits), `memory/routes.ts` (pass `sourceClient` to `writeAudit`).

**Client — `landing/src/`:**
- `workspace/activityClient.ts` — `ActivityClient` interface + `ActivityEntry` types.
- `app/activityClient.ts` — real impl over `api.activity`.
- `app/api.ts` — `activity: { list, preview, revert }`.
- `workspace/ActivityView.tsx` — the view + revert dialog.
- `workspace/Sidebar.tsx` — "AI Activity" entry; `workspace/NotoWindow.tsx` — `activityOpen` state + gated mount + per-note "AI changes" affordance wiring.

**Follow existing patterns:** DI as in `mcpClient.ts`/`aiClient.ts`/`citationClient.ts`; route `handle()` + limiter as in `ai/routes.ts`; zod schemas as in the existing PATCH path; additive migrations as already done in `db.ts`.

## 12. Open questions (none blocking; defaults set)

- **Diff rendering fidelity** — a simple before/current two-pane (or line diff) is enough for v1; no word-level diff library required.
- **Timeline depth** — cursor pagination with `limit` 50 covers v1; no date-range picker beyond the `before` cursor.
- **Per-note affordance placement** — context panel vs title area is a presentation detail for writing-plans/implementation; both reach the same filtered view.

Everything else is locked in §2 or deferred to SP4–SP5 per §1.
