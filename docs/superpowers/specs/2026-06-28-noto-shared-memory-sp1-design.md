# Noto Shared Memory — SP1 (Foundational Memory Layer) Design Spec

**Date:** 2026-06-28
**Status:** Approved design (Stage B brainstorming output). Ready for `superpowers:writing-plans`.
**Branch:** `feat/noto-web-app`
**Companion docs:** [`2026-06-27-noto-mcp-memory-layer-design.md`](2026-06-27-noto-mcp-memory-layer-design.md) (full architecture decision doc) · [`2026-06-28-noto-stage-a-wedge-analysis.md`](2026-06-28-noto-stage-a-wedge-analysis.md) (competitive analysis + wedge).

---

## 0. Context primer (for a cold session)

**Noto** is a hosted web app (React 19 + Express 5 + SQLite, under `landing/`) for Markdown notes with a wiki-link knowledge graph, client-side semantic Smart Search, an OpenAI-backed AI window (chat/summarize/flashcards/find-links/lecture transcription), and inline link citations. The server is the source of truth (notes are *not* local-first); auth is email+password or Google OAuth via an httpOnly session cookie; storage is SQLite (`node:sqlite`, WAL) with tables `users`, `sessions`, `vaults`, `files`. Every read/write is ownership-scoped per user.

**The wedge (approved):** *"Noto is the app that remembers — the notes vault that doubles as the live, shared, auditable memory your Claude Code, Cursor, and ChatGPT read from and write back to, so you stop re-explaining context."* It wins because the market has shipped the *pipe* (almost every note/meeting app now exposes MCP) but nobody shipped the *memory*: purpose-built hygiene (dedup/decay/scope/rank) + a provenance/trust layer + an automatic write-back loop, in a notes app you'd actually write in. Closest threat is Notion (official R/W MCP, but generic page CRUD with no memory semantics); Noto's defensibility is being purpose-built for memory and auditable by design.

**Why this is SP1.** The wedge maps onto a five-phase MCP memory layer. Rather than spec all of it, the work is decomposed into independently shippable sub-projects (SP1–SP5). **This doc specs SP1 only:** the foundational, lowest-risk slice — an AI tool can **read your notes** and **share atomic memory** (`remember`/`recall`) across sessions, on Claude Code, with provenance recorded from day one.

**Dependency note — partial server scaffolding already exists (corrected 2026-06-28 after reading the code; see the Addendum below).** Earlier this doc assumed greenfield; that is wrong. PAT auth, the `/api/tokens` routes, the `pat_tokens` and `audit_log` tables, single-note GET, and section GET/PATCH already exist and are tested. SP1 *reuses* them and builds only the memory store, FTS search, notes-list, the `noto-mcp` package, and the client/Settings UI. The `noto-mcp` package does not exist; `@modelcontextprotocol/sdk` is not yet a dependency.

---

## 0b. Addendum — reconciliation with existing code (AUTHORITATIVE; overrides §4–§6 where they conflict)

A pre-implementation read of `landing/server/` found substantial scaffolding already built and tested. **This addendum is the source of truth; where §4–§6 below describe these as new, treat them as existing.**

### Already exists — REUSE, do not rebuild
- **PAT auth** — `landing/server/auth/pat.ts`: `PAT_PREFIX="noto_pat_"`, `type Scope = "read"|"write"|"destructive"`, `hashPatToken` (sha256), `generatePatToken` (256-bit base64url), `resolveApiToken` middleware (mounted in `app.ts` **before** CSRF; sets `req.apiUser={userId,scopes,tokenId}`), `requireApiUser(req,res)` (401), `requireScope(req,res,scope)` (403).
- **Token management API** — `landing/server/tokens/routes.ts` mounted at `/api/tokens`: `POST /` mint (returns plaintext **once** as `{id, token, name, scopes}`; zod `mintSchema`), `GET /` list (`{tokens:[{id,name,scopes[],createdAt,lastUsedAt}]}`), `DELETE /:id` revoke (204). Cookie-authed.
- **`pat_tokens` table + helpers** in `db.ts`: `createPat`, `usePat` (touches `last_used_at`), `listPatsForUser`, `revokePat`, `PatRow`.
- **`audit_log` table + helpers** in `db.ts`: columns `(id, user_id, token_id, tool, target, before_hash, created_at)`; `writeAudit({userId, tokenId, tool, target, beforeHash})` and `listAuditForUser(userId, limit)`. **Reuse this for memory writes** — do NOT create a separate `audit` table.
- **Read endpoints** in `notes/routes.ts`: `GET /api/files/:fileId` (PAT `read` scope → `{file: PublicFile}`) and `GET /api/files/:fileId/section?heading=A/B` (→ `{fileId, headingPath[], content}`; 404 `{error, headings:[...]}` on miss). **`get_note`/`get_section` MCP tools just wrap these.**
- **Section write** `PATCH /api/files/:fileId/section` (optimistic concurrency via `expectUpdatedAt`, `requireScope("write")`, calls `writeAudit`) and `landing/server/notes/sections.ts` (`getSection`, `replaceSection`, `listHeadings`). *(Section write is SP2 surface; the endpoint already exists but SP1's `noto-mcp` does not expose an `update_section` tool.)*
- **`resolveUserId(req,res)`** pattern (PAT or cookie) in `notes/routes.ts`; `sha256Hex` + `toPublicFile` in `db.ts`.
- **Test harness** — `landing/server/test-helpers.ts`: `startTestServer()`, `makeCookieClient`, `makePatClient(baseURL, token)`, `signup(baseURL, email)`, `mintToken(client, scopes, name)`. Tests run on `:memory:` SQLite via `vitest.config.ts`.

### Scope reconciliation (supersedes §2 D1 / §4.1)
Existing PAT scopes are `read | write | destructive`. **Add a fourth, least-privilege `memory` scope** (additive: extend the `Scope` union in `auth/pat.ts` and the `mintSchema` enum in `tokens/routes.ts`). SP1 mapping:
- Read tools (`search_notes`, `list_notes`, `get_note`, `get_section`) → `requireScope("read")`.
- `remember` → `requireScope("memory")`.
- A `read,memory` token reads notes and writes memory but **cannot** write note bodies (it lacks `write`) — this is exactly the SP1 "atomic-only" boundary, now enforced by the scope system. The default minted SP1 token is `read,memory`; a `read`-only token is also offered.

### Audit reconciliation (supersedes §4.3)
**Do not create a new `audit` table.** Reuse the existing `audit_log` + `writeAudit`. On `remember`/supersede, call `writeAudit({userId, tokenId, tool:"remember"|"supersede", target: memoryId, beforeHash: <sha256 of superseded text or null>})`. Provenance for the "what did X write" filter lives on **`memories.source_client`** (set from the `X-Noto-Client` header, default `claude-code`); `audit_log.token_id → pat_tokens.name` gives the human-named device.

### Net NEW work for SP1
Server: the `memory` scope; the `memories` table + `memories_fts` + triggers + `db.ts` helpers; `/api/memory` (POST remember, GET recall) + `/api/memory/list`; `files_fts` + triggers + `GET /api/search`; `GET /api/notes` (refs list). Package: `noto-mcp` (stdio server, `notoClient`, scope detection, 6 tools) + add `@modelcontextprotocol/sdk`. Client/UI: `api.pat.*` + `api.memory.list`; the "Connect AI tools (MCP)" Settings panel (mint/copy/read-only memory list) wired into `Sidebar.tsx`'s `AccountFooter`.

---

## 1. Goal & scope

**Goal:** Ship the smallest end-to-end slice that makes the wedge real — Claude Code reads the user's notes and reads/writes a shared atomic-memory store over an MCP server, with ownership isolation and provenance recorded.

### In scope (SP1)
- **PAT auth:** a Personal Access Token path so a headless process can authenticate as the user (the API only accepts session cookies today).
- **Read endpoints:** single-note GET, section-by-heading GET, FTS5 note search, refs-only note listing.
- **Atomic memory:** a `memories` table + `remember`/`recall` with minimal hygiene (exact-dedup + corrections via supersede) and FTS5 + recency ranking.
- **Provenance:** an `audit` table; `source_client` stamped on every memory write.
- **`noto-mcp`:** a standalone stdio MCP server (npm, `npx -y noto-mcp`) exposing 6 tools, bridging the endpoints over HTTPS + PAT.
- **Settings UI:** "Connect AI tools (MCP)" panel — mint/manage PAT, copy-paste Claude Code config, and a **read-only Memory list** so atomic memory is legible in Noto.
- **First client:** Claude Code only.

### Out of scope (do NOT build in SP1 — each is a later sub-project)
- Note-body writes — `create_note`, `append_note`, `update_section` → **SP2**.
- Narrative `Memory/*.md` pages → **SP2**.
- Cursor / Codex wiring, steering files, native-memory reconciliation → **SP2**.
- Provenance **UI** / one-click revert (SP1 *records* provenance; it doesn't surface a revert UI) → **SP3**.
- Remote Streamable-HTTP `/mcp` endpoint, multi-device → **SP4**.
- Embeddings / semantic search / decay scoring / consolidation job → **SP5**.
- Multi-vault selection, response pagination/cursors, any `delete` tool.

---

## 2. Locked decisions (resolved during brainstorming, 2026-06-28)

| # | Decision | Choice |
|---|---|---|
| D1 | Write surface | **Atomic side-table only.** Read tools + `remember`/`recall` against the `memories` table. **No note-body writes of any kind** in SP1. |
| D2 | Memory hygiene | **Minimal + corrections.** Store with type/scope/source/timestamps; recall = bm25 + recency; **exact-normalized dedup** on write (bump `use_count`); `supersedes_id` retires a corrected fact. **No** fuzzy dedup, decay, or consolidation yet. |
| D3 | Provenance | **Record from day one.** `source_client` on every memory; an `audit` row on every write. UI to browse/revert is SP3. |
| D4 | Scope key | **Server/MCP auto-detects** project from `git remote.origin.url` (fallback: cwd hash); agent may pass explicit `scope` (incl. `global`). |
| D5 | Connection architecture | **Approach 1:** thin stdio `noto-mcp` bridging new PAT-authed Express endpoints. (Not direct-DB import; not HTTP-first.) |
| D6 | First client | **Claude Code** only. |
| D7 | Vault | SP1 targets the user's **default vault**; `NOTO_VAULT` env overrides. |

---

## 3. Architecture & components

```
┌─────────────┐
│ Claude Code │  (MCP client)
└──────┬──────┘
       │ stdio (spawns child)
       ▼
┌──────────────────────────────┐
│  noto-mcp  (npx package)      │  thin HTTP client, NO business logic
│  6 tools · scope auto-detect  │  reads NOTO_URL, NOTO_TOKEN, NOTO_CLIENT, NOTO_VAULT
└──────────────┬───────────────┘
               │ HTTPS + Bearer PAT + X-Noto-Client + scope
               ▼
┌──────────────────────────────┐
│  Noto Express API (/api)      │  existing app + SP1 additions
│  • PAT middleware (NEW)       │
│  • GET file / section / search│
│  • /api/memory/* (NEW)        │
│  • ownership scoping (reuse)  │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ SQLite: files (existing) +    │
│ pat_tokens, memories, audit,  │
│ files_fts, memories_fts (NEW) │
└──────────────────────────────┘
```

**Components:**
1. **`noto-mcp/`** — new standalone stdio MCP server package (publishes to npm; separate from the web app). Thin HTTP client of the API. Computes `scope`, sets headers, surfaces endpoint errors as tool errors.
2. **PAT auth** (`landing/server/`) — token minting + a `Bearer` middleware resolving a token to the same user context `getCurrentUser` produces today, so all existing ownership-scoped queries work unchanged.
3. **Read endpoints** (`landing/server/`) — `GET /api/files/:id`, `GET /api/files/:id/section`, `GET /api/search`, `GET /api/notes`.
4. **Memory store** (`landing/server/`) — `memories` table + `POST /api/memory` (remember), `GET /api/memory` (recall), `GET /api/memory/list` (UI browse); `audit` writer.
5. **Settings panel** (`landing/src/app/`) — PAT management + Claude Code config snippet + read-only Memory list.

**Data flow — recall/read (token-savings path):** Claude Code → `noto-mcp` tool → HTTPS GET + Bearer PAT → PAT middleware resolves user → ownership-scoped FTS5/`memories` query → JSON refs + ≤160-char snippets → Claude Code. Never returns whole bodies except `get_note`.

**Data flow — remember (write path):** `noto-mcp remember` → HTTPS POST → exact-normalized dedup check in scope → insert into `memories` (+ `source_client`, scope, timestamps) + append `audit` row → `{memoryId, deduped}`.

---

## 4. Data model

All additions in `landing/server/db.ts` migrations, mirroring existing `files` conventions (TEXT uuid PKs, epoch-ms integers, FK on, WAL).

### 4.1 `pat_tokens`
```
id            TEXT PRIMARY KEY            -- uuid
user_id       TEXT NOT NULL REFERENCES users(id)
name          TEXT NOT NULL              -- user label, e.g. "Claude Code – laptop"
token_hash    TEXT NOT NULL              -- hash of the secret at rest (reuse session-token hashing)
token_prefix  TEXT NOT NULL              -- first ~10 chars, display only
scopes        TEXT NOT NULL              -- 'read,memory' (default) or 'read'; write-note/destructive reserved for SP2+
created_at    INTEGER NOT NULL
last_used_at  INTEGER
revoked_at    INTEGER                    -- null = active
```
- Secret format: `noto_pat_<≥32 random base62>`. Shown **once** at mint. Looked up by `token_hash` (indexed); update `last_used_at` on use.
- SP1 scopes vocabulary: `read` (read tools) + `memory` (`remember`/`recall`). The mint endpoint issues **`read,memory` (default)** or **`read`** (read-only); the Bearer middleware enforces scope per request (a `read`-only token attempting `POST /api/memory` → 403). `write-note` and `destructive` are reserved names, **never issued** in SP1.

### 4.2 `memories`
```
id            TEXT PRIMARY KEY
user_id       TEXT NOT NULL REFERENCES users(id)
text          TEXT NOT NULL              -- the fact/decision/preference (cap 2 KB)
type          TEXT NOT NULL DEFAULT 'fact'  -- decision | preference | fact | glossary
scope         TEXT NOT NULL              -- project key or 'global'
source_client TEXT NOT NULL              -- 'claude-code' (SP1); later cursor/codex
norm_text     TEXT NOT NULL              -- lowercased, whitespace-collapsed; for exact-dedup
created_at    INTEGER NOT NULL
last_used_at  INTEGER NOT NULL           -- bumped on recall hit and on dup-write
use_count     INTEGER NOT NULL DEFAULT 1
status        TEXT NOT NULL DEFAULT 'active'  -- active | superseded
supersedes_id TEXT                       -- the memory this one replaces
```
- **Partial unique index:** `UNIQUE(user_id, scope, norm_text) WHERE status='active'` — enforces exact-dedup atomically (handles concurrent identical writes).
- **Dedup behavior:** on `remember`, compute `norm_text`; if an active row with the same `(user_id, scope, norm_text)` exists → bump `last_used_at`/`use_count`, return `{deduped:true, memoryId: existing}`. Else insert (`deduped:false`).
- **Correction:** `remember(supersedes_id=X)` inserts the new active fact and flips X to `status='superseded'` (kept for audit, excluded from recall).
- **Index:** `(user_id, scope, status)` for recall filtering.

### 4.3 `audit`
```
id            TEXT PRIMARY KEY
user_id       TEXT NOT NULL
token_id      TEXT                       -- which PAT (null if session)
source_client TEXT NOT NULL
tool          TEXT NOT NULL              -- 'remember' | 'supersede'
target_type   TEXT NOT NULL              -- 'memory' (SP1)
target_id     TEXT NOT NULL              -- memoryId
scope         TEXT
before_hash   TEXT                       -- pre-image hash (set on supersede)
summary       TEXT                       -- ~first 80 chars of text
created_at    INTEGER NOT NULL
```
Written on every memory mutation. This is the data SP3's trust UI consumes ("what did Cursor write," revert).

### 4.4 FTS5 virtual tables
- **`files_fts`** `USING fts5(file_id UNINDEXED, vault_id UNINDEXED, title, content)`, kept in sync by AFTER INSERT/UPDATE/DELETE triggers on `files`. `search_notes` queries it, joins back to `files` for ownership + path, and computes the matched section's `headingPath` + a ≤160-char snippet by running the existing `landing/src/noto-core/chunk.ts` heading tokenizer on the hit. (Note-level index; heading-addressable results; no passage index in SP1.)
- **`memories_fts`** `USING fts5(memory_id UNINDEXED, user_id UNINDEXED, text)`, synced by triggers on `memories`. `recall` queries it, filtered to `user_id + scope(s) + status='active'`, ranked bm25 + recency tiebreak.

---

## 5. Tool surface (the contract)

Six tools in `noto-mcp`, each a thin call to one endpoint. References/snippets over bodies; hard limits bound every response.

| Tool | Input | Output | Limits | Endpoint |
|---|---|---|---|---|
| **search_notes** | `{query:string, scope?:string, tag?:string, limit?:int=5}` | `{results:[{fileId,title,headingPath:string[],snippet,score}]}` | 5 (max 20); snippet ≤160 chars | `GET /api/search?q&scope&tag&limit` |
| **list_notes** | `{by:"recent"\|"tag"\|"folder", value?:string, limit?:int=20}` | `{notes:[{fileId,title,path,updatedAt}]}` | 20 (max 50) | `GET /api/notes?by&value&limit` |
| **get_note** | `{fileId:string}` | `{fileId,title,path,content,updatedAt}` | note cap 256 KB | `GET /api/files/:fileId` |
| **get_section** | `{fileId:string, heading:string}` ("A/B") | `{fileId,headingPath:string[],content}`; on miss `{error:"heading_not_found", outline:string[]}` | one section | `GET /api/files/:fileId/section?heading` |
| **remember** | `{text:string, type?:enum=fact, scope?:string, supersedes?:string}` | `{memoryId, deduped:boolean}` | text ≤2 KB | `POST /api/memory` |
| **recall** | `{query:string, scope?:string, type?:string, limit?:int=6}` | `{memories:[{memoryId,text,type,scope,sourceClient,lastUsed,score}]}` | 6 (max 20) | `GET /api/memory?q&scope&type&limit` |

**Scope rule:**
- **Reads** (`search_notes`, `recall`): results from `scope ∪ 'global'` (project facts *and* cross-project preferences). If the agent explicitly passes `scope:'global'`, just global.
- **Writes** (`remember`): land in exactly `scope` — current project by default, or `global` only on explicit override. A write never silently fans out.

**`get_section` heading resolution:** match by full path "Parent/Child"; on ambiguous/missing heading, return the note's heading `outline` so the agent can retry.

---

## 6. Server endpoints

All under `/api`, accept **PAT *or* session cookie**, reuse existing ownership scoping (`getOwnedFile`-style), **404-on-miss** (no existence probing), zod-validated (mirror `patchSchema`), behind a new `mcpLimiter` (reuse the existing rate-limit pattern from `ai/routes.ts`).

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/files/:fileId` | single note by id | new; currently only bulk vault listing exists |
| GET | `/api/files/:fileId/section?heading=A/B` | one heading section | uses `chunk.ts` tokenizer; miss → `{outline}` |
| GET | `/api/search?q&scope&tag&limit` | FTS5 note search | refs + headingPath + snippet |
| GET | `/api/notes?by&value&limit` | refs-only listing | `by` = recent\|tag\|folder; default vault |
| POST | `/api/memory` | remember | body `{text,type?,scope?,supersedes?}`; dedup/supersede + audit |
| GET | `/api/memory?q&scope&type&limit` | recall | bumps `last_used_at`/`use_count` on hits |
| GET | `/api/memory/list?scope&type&limit` | browse (Settings UI) | recent active memories, no query |
| POST | `/api/auth/pat` | mint token | body `{name, scopes?}`; default `read,memory`, or `read`; returns secret **once** |
| GET | `/api/auth/pat` | list tokens | no secrets |
| DELETE | `/api/auth/pat/:id` | revoke | sets `revoked_at` |

**Headers `noto-mcp` sends:** `Authorization: Bearer noto_pat_…`, `X-Noto-Client: <NOTO_CLIENT|claude-code>`, and the computed `scope` (query param on reads, body field on writes).

---

## 7. Scope resolution (`noto-mcp`)

At tool-call time, `noto-mcp` resolves the project key:
1. Run `git config --get remote.origin.url` in the process cwd. If present, normalize to a stable key (strip scheme/credentials/`.git`, lowercase host+path), e.g. `github.com/acme/widgets`.
2. Else fall back to a hash of the absolute cwd.
3. The agent may pass an explicit `scope` arg (any string, or `global`) which overrides auto-detection.
The server treats `scope` as an opaque string; `global` is reserved. Read endpoints expand a project scope to `scope ∪ 'global'`; write endpoints persist exactly the given scope.

---

## 8. Safety & error handling

- **No note clobber possible in SP1.** There are no note-write tools; the only writes are appends/inserts to `memories`/`audit`. The last-write-wins concurrency risk that affects note bodies simply does not apply. (Deliberate property; it's why SP1 is the safe first slice.)
- **Dedup race:** the partial unique index makes a concurrent identical `remember` bump `use_count` rather than duplicate (catch the constraint violation → treat as dedup hit).
- **Auth errors:** missing/invalid/revoked PAT → **401**; valid token with insufficient scope (a `read`-only token attempting `POST /api/memory`) → **403**. `noto-mcp` surfaces both as clear tool errors.
- **Not-found:** notes/sections **404-on-miss**; `get_section` heading miss returns `{outline}` for retry (not a hard error).
- **Limits:** every list/search response is bounded by the hard limits in §5 (no pagination in SP1).
- **Validation:** zod schemas on every endpoint; reject malformed `scope`, oversized `text` (>2 KB), unknown `type`.

---

## 9. Testing strategy (TDD; existing vitest stack)

**Server unit:**
- Memory dedup: identical `remember` in same scope bumps `use_count`, does not duplicate.
- Supersede: `supersedes_id` flips old → `superseded`, excludes it from recall, writes audit `before_hash`.
- Recall ranking: bm25 + recency ordering; scope filter (`scope ∪ global` on read).
- Write scope: `remember` persists exactly the given scope (no global fan-out).
- `files_fts` triggers: insert/update/delete on `files` reflected in search results.
- `get_section`: correct slice by heading path; miss returns outline.
- PAT: mint → hash stored (secret not persisted in plaintext); verify resolves user; revoke → 401.
- Scope normalization: git-remote URL → stable key; cwd fallback when no remote.

**Integration (endpoints):**
- Each endpoint under PAT auth resolves the right user; ownership isolation: user A requesting user B's `fileId`/`memoryId` → 404.
- Limits enforced (e.g., `limit=999` clamped to max).
- Insufficient-scope token → 403 on memory write.

**`noto-mcp`:**
- Each tool maps to the correct endpoint and forwards `X-Noto-Client` + scope.
- Endpoint error (401/403/404/500) surfaces as a clear tool error.
- Scope auto-detect: fake git remote → expected key; no remote → cwd-hash fallback.

---

## 10. Success criteria

1. **Cross-session loop:** a decision `remember`ed in one Claude Code session is returned by `recall` in a *fresh* session.
2. **Token savings:** a representative task acquires context via progressive `recall → search_notes → get_section` in materially fewer tokens than pasting the equivalent notes (rough measure against the companion doc's ~75% target).
3. **Provenance recorded:** every `remember` produced an `audit` row carrying `source_client`; the Settings Memory list displays it.
4. **Isolation:** user A cannot reach user B's notes/memory through the MCP (ownership holds under PAT).
5. **No clobber:** SP1 exposes no note-write tool (verified by the tool list).

---

## 11. File structure (proposed; writing-plans pins exact paths)

**New package — `noto-mcp/`** (repo root):
- `src/index.ts` — stdio MCP server bootstrap + tool registration.
- `src/notoClient.ts` — HTTP client (base URL, PAT header, `X-Noto-Client`, error mapping).
- `src/scope.ts` — git-remote/cwd scope detection + normalization.
- `src/tools/{searchNotes,listNotes,getNote,getSection,remember,recall}.ts` — one file per tool (schema + handler).
- `package.json` (bin `noto-mcp`), `tsconfig.json`, `src/__tests__/*`.

**Server additions — `landing/server/`:**
- `auth/pat.ts` — mint/verify/hash + Bearer middleware.
- `auth/patRoutes.ts` — `/api/auth/pat` CRUD (or fold into existing auth router).
- `memory/store.ts` — dedup/supersede/recall/list logic.
- `memory/routes.ts` — `/api/memory*` endpoints.
- `search/fts.ts` — `files_fts`/`memories_fts` creation, triggers, query helpers.
- `notes/routes.ts` — add `GET /api/files/:id`, `/section`, `/api/notes`.
- `audit/store.ts` — audit writer.
- `db.ts` — migrations: `pat_tokens`, `memories`, `audit`, FTS tables + triggers, partial unique index.

**Client/UI — `landing/src/app/`:**
- `settings/McpPanel.tsx` — PAT management + Claude Code config snippet + read-only Memory list.
- `api.ts` — add `pat.*` and `memory.list` client methods.

**Follow existing patterns:** DI/interface style as in `aiClient.ts`/`citationClient.ts`; route handler `handle()` wrapper + limiter as in `ai/routes.ts`; zod schemas as in the existing PATCH path.

---

## 12. Open questions (none blocking; defaults set)

- **Token-savings measurement method** — a rough before/after token count on one representative task is sufficient for SP1's success criterion; no formal eval harness required.
- **PAT model** — single personal token is enough for SP1; named/multi-token management UI already covered by the mint/list/revoke endpoints. No per-tool scoping UI in SP1.
- **`memories.text` cap** — set at 2 KB; revisit if real usage shows decisions need more room.

Everything else is locked in §2 or deferred to SP2–SP5 per §1.
