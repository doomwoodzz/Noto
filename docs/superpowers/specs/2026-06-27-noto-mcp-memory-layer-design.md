# Noto as a Shared MCP Memory Layer — Architecture Decision Document

**Date:** 2026-06-27
**Status:** Brainstorm / decision doc (no implementation yet)
**Author:** Staff architecture pass for Noto
**Scope:** Connect Claude Code, OpenAI Codex/ChatGPT, and Cursor to Noto as a shared, persistent, token-efficient memory layer via a single MCP server.

---

## 0. TL;DR — the strong recommendations

1. **One MCP server for all three clients.** The thesis holds: Claude Code, Codex, and Cursor all speak MCP. Build one server; do not build three integrations.
2. **Ship a single `stdio` server first, distributed via `npx`.** stdio is universally supported and version-stable. Codex's Streamable-HTTP is flaky; Cursor's HTTP↔SSE fallback is buggy. Remote Streamable HTTP comes later as an opt-in.
3. **Bridge to Noto's existing HTTP API, not raw SQLite.** Reuse Noto's validation, ownership-scoping, and quotas. Add the one missing primitive: a **Personal Access Token (PAT)** auth path (the API only accepts browser session cookies today).
4. **Retrieval-first tool surface, ~9 tools.** Search returns *references + snippets*, not bodies. Fetch sections by *heading path*, not chunk index. Stay well under Cursor's 40-tool cap.
5. **Memory = a hybrid.** Durable knowledge lives as real notes in a reserved `Memory/` folder (reuses Noto's graph/search/UI). Atomic facts/preferences for `remember`/`recall` live in a small structured side-table built for dedup, decay, and ranking. No full temporal knowledge graph for v1 — Noto already has a wiki-link graph.
6. **Reconcile Codex/ChatGPT native memory** by making Noto the single source of truth: disable Codex Memories on MCP-touched threads and restrict the ChatGPT connector from re-absorbing output.
7. **Local-first & safe by default:** stdio + PAT, agent writes confined to `Memory/`, section-level edits only, optional read-only mode, audit trail of every AI write.

---

## 1. Findings: the current Noto codebase

> The root `CLAUDE.md` describes a SwiftUI macOS app. **That is stale.** The active product is a web app under `landing/` on branch `feat/noto-web-app`. All findings below are from that code.

### 1.1 Stack & storage
- **Frontend:** React 19 + TypeScript + Vite (SPA).
- **Backend:** Node 22+ / Express 5 (`landing/server/`). API on `:8787`, Vite proxies `/api` in dev; in prod Express serves both.
- **Storage:** **SQLite** via Node's built-in `node:sqlite` (`landing/server/db.ts`), WAL mode, FK on. **The server is the source of truth.** Tables: `users`, `sessions`, `vaults`, `files`. Notes are plain Markdown stored in `files.content`.
- **Client persistence** is UI-only (theme, tabs) in `localStorage`; **note content is not local-first** — the client autosaves (700 ms debounce) to the server.

### 1.2 Note data model (`landing/src/noto-core/types.ts`)
```ts
interface VaultFile {
  id: string;          // crypto.randomUUID() — STABLE, immutable after create
  path: string;        // "Folder/Note Title.md" — relative, .md, traversal-guarded
  title: string;
  content: string;     // pure Markdown, no frontmatter modeled, 256 KB cap
  pinned: boolean;
  createdAt: number;   // epoch ms
  updatedAt: number;   // epoch ms
}
```
Derived (not stored) metadata, computed in `noto-core`:
```ts
interface FileMetadata {
  fileId; path; title;
  headings: string[];        // section structure exists here
  outgoingLinks: string[];   // [[wiki-link]] targets
  backlinks: string[];       // resolved inbound links
  tags: string[];            // #hashtags (heading lines excluded)
  wordCount; updatedAt;
}
```
- **Stable IDs: yes** (UUID per note). **Frontmatter: not modeled** — content is raw Markdown.
- **Graph already exists**: `KnowledgeGraph { nodes, edges }` from wiki-links — nodes are notes, edges are links with weights.

### 1.3 Sub-document addressability (`landing/src/noto-core/chunk.ts`)
- A `Passage` = a heading section or merged paragraph group (~400 target / 900 max chars), carrying its `headingPath: string[]`.
- **Passage `id` is `` `${fileId}#${index}` `` — index-based and therefore NOT stable across edits.** Inserting a paragraph renumbers everything below it. **Design consequence: address sections by heading path, never by chunk index.**
- Chunks are **client-side only**, used purely to feed embeddings. They are not exposed by any API.

### 1.4 Search / AI / embeddings
- **Smart Search is client-side & semantic:** `Xenova/all-MiniLM-L6-v2` in a Web Worker (onnxruntime-web WASM), vectors cached in **IndexedDB** per vault, ranked by dot product. **A headless process cannot reach this index or model.**
- **Server-side AI** (`landing/server/ai/routes.ts`, OpenAI `gpt-4o-mini`): `/api/ai/chat`, `/summarize`, `/flashcards`, `/find-links` (LLM over titles, not semantic), `/transcribe`, `/lecture-notes`.
- **Links/citations** (`landing/server/links/routes.ts`): URL unfurl with SSRF guards + in-memory cache.

### 1.5 Existing API surface (all under `/api`, session-cookie auth, CSRF, per-user)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/vaults` | list user's vaults (bootstraps default + Welcome) |
| GET | `/api/vaults/:vaultId/files` | list files in a vault (**bulk**, full bodies) |
| POST | `/api/vaults/:vaultId/files` | create note (`path`, `title`, `content`) |
| PATCH | `/api/files/:fileId` | update `path`/`title`/`content`/`pinned` |
| DELETE | `/api/files/:fileId` | delete note |
| GET/POST/PATCH | `/api/auth/*` | signup, login, logout, me, prefs, Google OAuth |
| POST | `/api/ai/*`, `/api/links/*` | AI + unfurl |
| GET | `/api/health` | status |

**Notably missing for memory use:** there is **no single-note GET by id**, **no section GET**, and **no server-side search** (search is client-only). These are the additions the MCP work needs.

### 1.6 Auth / multi-user / sync
- **Auth:** email+password (`scrypt`) or Google OAuth → **httpOnly, Secure, SameSite=Lax session cookie** carrying an opaque token (hashed at rest, server-revocable, ~30-day TTL).
- **Multi-user, fully isolated:** every read/write goes through ownership-checked queries (`getOwnedFile(userId, …)`), 404-on-miss (no existence probing). Quotas: ~20 vaults/user, 2000 files/vault, 256 KB/note.
- **Sync:** none. Autosave with **last-write-wins**, no OT/CRDT. *Concurrent writers clobber each other.*

### 1.7 Blockers to exposing Noto to an external process
1. **Cookie auth is browser-bound.** A separate process has no session cookie. → **Must add a token (PAT) auth path.** *(This is the one unavoidable new server primitive.)*
2. **Semantic search & embeddings are browser-only** (IndexedDB + WASM model). → Server/MCP search needs its own path (FTS5 now, server-side embeddings later).
3. **Last-write-wins concurrency.** → MCP writes can clobber a note open in a browser tab. Mitigate with confine-to-`Memory/`, section edits, and optimistic concurrency (`updatedAt` check).
4. No streaming endpoints; AI needs an OpenAI key. Neither blocks memory work.

**Bottom line:** the data/API layer is clean and exposable. The only real new primitive is token auth; the only real gap is server-side search.

### 1.8 Stated assumptions
- **A1.** Noto is (or will be) a **hosted multi-tenant web service** with sign-in — the current shape. So the MCP server reaches notes over **HTTP + PAT**, not by importing the DB. *(If you instead run Noto locally per-user, an in-process variant is possible — see §2.4.)*
- **A2.** "Project" for memory scoping is identified by the client's working directory / git remote, passed by the agent. (Open question Q5.)
- **A3.** You want **one shared memory** across all three clients, not per-client silos. (Open question Q7.)
- **A4.** v1 search can be lexical (SQLite FTS5); semantic is a later phase. (Open question Q3.)

---

## 2. Recommended architecture

### 2.1 The decision: one server, stdio-first, bridging the HTTP API via PAT

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ Claude Code │   │    Codex    │   │   Cursor    │     (MCP clients)
└──────┬──────┘   └──────┬──────┘   └──────┬──────┘
       │ stdio (spawns child process)      │
       └───────────────┬──────────────────┘
                       ▼
        ┌──────────────────────────────┐
        │   noto-mcp  (npx package)     │   ONE server, stdio transport
        │  • 9 retrieval-first tools    │   reads NOTO_URL + NOTO_TOKEN
        │  • read-before/write-after    │   from env
        │  • dedup + audit              │
        └──────────────┬───────────────┘
                       │ HTTPS + Bearer PAT
                       ▼
        ┌──────────────────────────────┐
        │   Noto Express API  (/api)    │   existing server, +PAT auth,
        │  • notes CRUD (existing)      │   +GET file, +section, +search,
        │  • token auth (NEW)           │   +memory endpoints
        │  • ownership scoping (reuse)  │
        └──────────────┬───────────────┘
                       ▼
        ┌──────────────────────────────┐
        │  SQLite: files, memories(NEW),│
        │  pat_tokens(NEW), audit(NEW)  │
        └──────────────────────────────┘

         Later (Phase 3): the same tool handlers also mount on the
         Express app as a remote  Streamable HTTP  endpoint at /mcp
         for zero-install / multi-device use.
```

**Why one server for all three:** every client resolves tools the same way over the same MCP protocol. The differences are *configuration* (JSON vs TOML, file locations) and *steering* (CLAUDE.md vs AGENTS.md vs `.mdc` rules), not server code. Three bespoke integrations would triple maintenance for zero functional gain. **Thesis confirmed — no reasoned exception needed.**

**Why bridge the HTTP API, not raw SQLite** (the Obsidian "Local REST API + MCP" pattern):
- Reuses Noto's zod validation, path-traversal guards, quotas, and **ownership scoping** — the security that makes multi-user safe. Raw SQLite access would re-implement and inevitably drift from all of it.
- Works **identically whether Noto is local or cloud-hosted** — the MCP server only needs a URL + token.
- Keeps one source of truth for note semantics (metadata derivation, link resolution).
- Trade-off you accept: one extra network hop per call (negligible vs. token cost) and you must build the PAT path.

**Why stdio first, not HTTP:**
| | stdio | Streamable HTTP |
|---|---|---|
| Claude Code | ✅ | ✅ |
| Codex | ✅ stable | ⚠️ flaky (experimental `rmcp`, protocol-version mismatches) |
| Cursor | ✅ | ✅ but HTTP↔SSE fallback is buggy |
| Multi-device | ❌ per-machine install | ✅ |
| Privacy | ✅ stays local except the HTTPS call to your own Noto | depends |

stdio is the only transport that is first-class on all three *today*. The stdio server is a thin client of your HTTP API, so adding remote HTTP later is mounting the same handlers on Express — not a rewrite.

### 2.2 Server-side additions required (Phase 0, before any MCP)
1. **PAT auth path.** New `pat_tokens` table (`id`, `user_id`, `hash`, `name`, `scopes`, `created`, `last_used`, `revoked`). New middleware: if `Authorization: Bearer noto_pat_…` present, resolve token→user and set the same user context `getCurrentUser` produces. PATs minted in Noto settings UI; shown once; hashed at rest (mirror the session-token design).
2. **`GET /api/files/:fileId`** — single note by id (currently only bulk vault listing exists).
3. **Section read/write** — `GET /api/files/:fileId/section?heading=A/B` and `PATCH …/section` that replace only the addressed heading block, leaving siblings intact. Built on the same heading tokenizer `chunk.ts` already uses.
4. **Search** — `GET /api/search?q=…&scope=…` → ranked `{fileId, title, headingPath, snippet, score}`. **Phase 1 = SQLite FTS5** (`node:sqlite` supports it; cheap, server-side, no model). **Phase 4 = server-side embeddings** (port MiniLM via `@xenova/transformers`, which runs in Node) for true semantic recall.
5. **Memory store** — `memories` table + `/api/memory/*` (see §4).
6. **Audit** — `audit` table; every write via PAT records `{token, tool, target, ts, before_hash}`.

### 2.3 Packaging & distribution
- **Primary:** publish `noto-mcp` to npm; clients launch it with `npx -y noto-mcp`. Config carries `NOTO_URL` + `NOTO_TOKEN` via env. Zero install footprint, auto-updates on version bump.
- **In-app toggle (Obsidian pattern):** a "Connect AI assistants (MCP)" panel in Noto Settings that (a) mints/reveals a PAT, (b) shows copy-paste config blocks for each client, and (c) for self-hosters, toggles the remote `/mcp` endpoint. This is the discoverability surface — most users will copy a snippet from here.
- **Optional bundled binary** (pkg/bun) for users without Node, later.

### 2.4 Variant if Noto runs locally per-user (not assumed)
If you pivot to a local-per-user Noto (Node server on the user's machine), the stdio server can `import` `db.ts` repo functions directly — no HTTP hop, no PAT needed (filesystem trust). The tool layer is identical; only the data-access adapter swaps. Designing the tools against an interface (`NotoClient`) keeps both paths open.

---

## 3. Tool surface

Design principles: **references over content; snippets over bodies; heading paths over chunk indices; hard default limits; lean count** (Cursor's ~40-tool global cap is shared across *all* the user's servers, so ~9 tools leaves headroom). Token costs assume ~4 chars/token.

| Tool | Returns | Input (schema) | Output (schema) | Default limits | ~Token cost (typical) |
|---|---|---|---|---|---|
| **search_notes** | refs + snippets | `{ query: string, scope?: string, tag?: string, limit?: int=5 }` | `{ results: [{ fileId, title, headingPath[], snippet, score }] }` | 5 hits, ~160-char snippets | **~700** in / out |
| **list_notes** | refs only | `{ by: "recent"\|"tag"\|"backlinks"\|"folder", value?: string, limit?: int=20 }` | `{ notes: [{ fileId, title, path, updatedAt }] }` | 20 | **~250** |
| **get_note** | content | `{ fileId: string }` | `{ fileId, title, path, content, updatedAt }` | — (size-capped 256 KB) | = note size (avoid; prefer get_section) |
| **get_section** | content (slice) | `{ fileId: string, heading: string }` (heading path "A/B") | `{ fileId, headingPath[], content }` | one section | **~200–600** |
| **create_note** | ref | `{ path: string, title: string, content?: string }` | `{ fileId }` | path validated (traversal-guarded) | **~40** |
| **append_note** | ref | `{ fileId: string, text: string, underHeading?: string }` | `{ fileId, updatedAt }` | never overwrites | **~40** |
| **update_section** | ref | `{ fileId: string, heading: string, content: string, expectUpdatedAt?: number }` | `{ fileId, updatedAt }` | replaces one section only; optimistic-concurrency guard | **~40** |
| **remember** | ref | `{ text: string, type: "decision"\|"preference"\|"fact"\|"glossary", scope?: string, supersedes?: string }` | `{ memoryId, deduped: bool }` | dedup on write | **~40** |
| **recall** | refs + text | `{ query: string, scope?: string, type?: string, limit?: int=6 }` | `{ memories: [{ memoryId, text, type, scope, lastUsed, score }] }` | 6 | **~350** |

Notes:
- **Reference-returning tools** (`list_notes`, `create/append/update`, `remember`): never return bodies — they return IDs/titles/timestamps the agent uses to decide what to fetch. **Content-returning tools** (`get_note`, `get_section`, `recall`, and `search_notes` snippets) are gated by hard limits.
- `get_note` is the only whole-body tool; steering tells agents to prefer `get_section`. Pagination via `limit` + an opaque `cursor` on `search_notes`/`list_notes` so a single call can't blow context.
- **No `delete` tool in the default surface.** Deletion is destructive + last-write-wins; expose it only under explicit read-write+destructive scope (see §6).
- **Heading addressing**, not chunk index, for `get_section`/`update_section` — because `chunk.ts` IDs are unstable (§1.3). Ambiguous/duplicate headings resolve by full path "Parent/Child"; on miss, return the heading outline so the agent can retry.

---

## 4. Memory system design

### 4.1 Model: hybrid (notes for narrative, table for atoms) — and *not* a knowledge graph
- **Durable, narrative knowledge** (decisions log, conventions, glossaries, project context) = **real notes** in a reserved `Memory/` folder. The agent grows them with `append_note`/`update_section`. Benefit: they are first-class notes — searchable, wiki-linkable, visible in Noto's graph and UI, human-editable. Keeps the design cheap (reuses everything) and keeps memory *legible*.
- **Atomic facts/preferences** (the `remember`/`recall` primitives) = a dedicated **`memories` table** with the structured fields atomic memory needs and Markdown can't cleanly give you:
  ```
  memories(id, user_id, text, type, scope, embedding?, source_client,
           created, last_used, use_count, status, supersedes_id)
  ```
  Benefit: clean dedup, decay, scoping, and ranking without parsing Markdown. Optionally mirrored into a human-browsable `Memory/Facts.md` digest.

**Why not a full temporal knowledge graph (Graphiti/Zep)?** Noto is a notes app, not a pure agent-memory DB, and it **already has a wiki-link graph** (`KnowledgeGraph`). An entity/relation temporal store is heavy infra whose payoff (multi-hop entity reasoning) is marginal for personal notes + decisions vs. notes + links + good retrieval. Revisit only if recall quality demonstrably demands it. **Recommended default: hybrid above.**

### 4.2 The memory-vs-notes boundary
- **Your notes** = anything you author. The agent **never silently edits these.** Writes outside `Memory/` require an explicit user-approved tool call (and even then are section-level).
- **Memory** = durable, cross-session, agent-authored facts/decisions/preferences. Lives in `Memory/` (narrative) + the `memories` table (atomic). This keeps your normal vault uncluttered: one reserved folder, filterable/hidable in the UI, plus an invisible side-table.

### 4.3 Read-before-act / write-after loop
**Read (task start):** the agent calls `recall(scope=project)` + `search_notes(query=task, scope=project)` to pull only the relevant slice before responding. Steering files (§7) instruct this.

**Write (task end):** when a durable decision/preference/fact emerges, the agent calls `remember` (atomic) or `append_note`/`update_section` into `Memory/` (narrative). Steering tells it to write *durable* things only — not transient chatter.

**Dedup & consolidation (server-enforced, not left to the model):**
- On `remember`, the server embeds (Phase 4) or FTS-matches (Phase 1) the text against existing memories in scope. If similarity > **0.9**, **update** the existing entry (`last_used`, optional merge) and return `{deduped:true}` instead of inserting. Corrections use `supersedes_id` to retire the old entry (kept for audit, hidden from recall).
- **Decay/ranking:** `recall` ranks by `score = similarity × recency(last_used) × log(use_count)`; entries unused past a TTL drop in rank. A periodic (or on-write) **consolidation job** merges near-duplicates and caps entries per scope, preventing bloat.
- **Provenance:** every memory records `source_client` and timestamps → audit + the ability to filter "what did Cursor write."

### 4.4 Reconciling Codex/ChatGPT native memory (so they don't fight Noto)
- **Codex Memories** is off by default. If a user enables it, make Noto authoritative:
  ```toml
  [memories]
  disable_on_external_context = true   # keep MCP-touched threads out of Codex's own memory
  # or, to fully defer to Noto:
  use_memories = false
  generate_memories = false
  ```
  Guidance: keep deterministic rules in `AGENTS.md`; let Noto MCP be the durable store; Codex Memories stays a local convenience or off.
- **ChatGPT:** the connector should **restrict memory saving** so ChatGPT doesn't re-absorb Noto's tool output into its own per-account memory. Document the setting; recommend Developer Mode for full read/write MCP.
- **Net rule:** *Noto is the single shared source of truth across clients; native per-client memory is disabled or scoped so it can't duplicate/contradict Noto.*

---

## 5. Token-efficiency strategy & worked example

**Levers:** (1) retrieve only relevant slices; (2) structured returns (IDs/headings) over raw bytes; (3) progressive disclosure — `search → IDs → get_section`; (4) a compact index layer (`list_notes`/search snippets act as the "map"); (5) session caching: tools return `updatedAt`, steering says *don't re-fetch a note whose `updatedAt` you already have*.

**Representative task:** *"Continue the auth refactor we discussed last week; follow our conventions and prior decisions."* Relevant context is spread across ~3 design notes + a conventions note + a decisions log.

| Approach | What enters context | Tokens |
|---|---|---|
| **Naive (paste/re-read everything)** | 3 full design notes (~1,500 tok ea), conventions note (~1,800), decisions log (~1,200), often re-pasted every session | **~7,500** |
| **Noto MCP (progressive)** | `recall(scope)` → 5 atoms (~300) + `search_notes("auth refactor")` → 4 snippets w/ IDs (~650) + `get_section` ×2 on the chosen sections (~900) | **~1,850** |

**≈ 75% reduction on context acquisition**, *and* it's selective, fresh, and de-duplicated. The naive number recurs every session; the MCP number is bounded by hard limits and shrinks further with caching. At larger vaults the ratio improves (naive grows with vault size; MCP stays ~flat).

---

## 6. Auth, privacy, safety

- **Local-first default:** stdio + PAT. Notes leave the machine only via the HTTPS call to *your own* Noto instance (already true for the web app). No third party.
- **PAT model:** minted in Noto settings, hashed at rest, revocable, per-token scopes: `read`, `write`, `destructive` (delete). **Default-issued token is `read` + scoped `write` (Memory/ only).**
- **Read-only mode:** `NOTO_MCP_READONLY=1` (or a read-only PAT) hides all write tools — a client can `recall`/`search` but not mutate.
- **Write protection:**
  - Agent writes default to `Memory/`; writing elsewhere requires a full-`write`-scoped token.
  - **Section-level edits only** (`update_section`/`append_note`) — never whole-note overwrite of human notes.
  - **Optimistic concurrency:** `expectUpdatedAt` guards against clobbering a note edited in the browser (mitigates last-write-wins).
  - **Destructive ops** (delete) excluded by default; require `destructive` scope and client-side confirmation (Cursor/Claude/Codex all prompt per tool call unless auto-run is enabled).
  - **Audit trail:** every write logs tool, target, timestamp, source client, and a pre-image hash → reviewable in Noto + a `Memory/_audit.md` digest.
- **Remote (Phase 3):** bearer PAT over TLS; optional OAuth (Cursor's fixed redirect `https://www.cursor.com/agents/mcp/oauth/callback`; Claude Code `/mcp` OAuth flow). Same scope model.

---

## 7. Per-client integration

> Replace `noto_pat_xxx` with a token from Noto Settings, and `NOTO_URL` with your instance (`http://localhost:8787` for local dev, your domain in prod). All three use the **same stdio server**.

### 7.1 Claude Code — `.mcp.json` (project) or `claude mcp add`
```json
{
  "mcpServers": {
    "noto": {
      "command": "npx",
      "args": ["-y", "noto-mcp"],
      "env": { "NOTO_URL": "https://app.noto.example", "NOTO_TOKEN": "noto_pat_xxx" }
    }
  }
}
```
```bash
claude mcp add --scope user --transport stdio \
  --env NOTO_URL=https://app.noto.example \
  --env NOTO_TOKEN=noto_pat_xxx \
  noto -- npx -y noto-mcp
```

**Steering — `CLAUDE.md` (project or `~/.claude/CLAUDE.md`):**
```markdown
## Noto shared memory (MCP server: noto)
Noto is your persistent, cross-session memory. Tools are prefixed `mcp__noto__`.

- BEFORE starting a task that depends on prior context, decisions, or my
  preferences: call `recall` and `search_notes` scoped to this project. Pull only
  the sections you need with `get_section` — do NOT `get_note` whole files unless
  necessary, and don't re-fetch a note whose updatedAt you already have.
- AFTER a durable decision, preference, or fact emerges: persist it with `remember`
  (atomic) or append to the relevant `Memory/` note. Store durable things only.
- Never edit my notes outside `Memory/`. Prefer `update_section`/`append_note`
  over whole-note rewrites.
```

### 7.2 Codex — `~/.codex/config.toml` (global) or `.codex/config.toml` (trusted project)
```toml
[mcp_servers.noto]
command = "npx"
args = ["-y", "noto-mcp"]
env = { NOTO_URL = "https://app.noto.example", NOTO_TOKEN = "noto_pat_xxx" }
startup_timeout_sec = 15

# Make Noto the single source of truth (only if native Memories is enabled):
[memories]
disable_on_external_context = true
```
```bash
codex mcp add noto --env NOTO_URL=https://app.noto.example --env NOTO_TOKEN=noto_pat_xxx -- npx -y noto-mcp
```
> Field names matter: it's `env` (inline literals) and `env_vars` (names to forward); for HTTP it'd be `url` + `bearer_token_env_var` (not `headers`/`bearer_token`). **Use stdio** — Codex's HTTP transport is experimental/flaky. Project-level config requires the project be marked `trust_level = "trusted"` in the global config.

**Steering — `AGENTS.md` (project root; global at `~/.codex/AGENTS.md`):**
```markdown
## Noto shared memory (MCP server: noto)
At the start of each task, call the Noto `recall`/`search_notes` tools to retrieve
prior decisions and preferences relevant to the files you'll touch; fetch only the
needed sections. After completing work, write durable decisions/preferences back via
`remember` or by appending to the matching `Memory/` note. Noto is the source of
truth — do not rely on Codex's own memory for cross-tool facts. Never edit notes
outside `Memory/`.
```

### 7.3 Cursor — `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global)
```json
{
  "mcpServers": {
    "noto": {
      "command": "npx",
      "args": ["-y", "noto-mcp"],
      "env": { "NOTO_URL": "https://app.noto.example", "NOTO_TOKEN": "${env:NOTO_TOKEN}" }
    }
  }
}
```
> **Keep the tool list lean** — Cursor enforces a **~40-tool cap across all enabled servers combined**; over it, tools are silently dropped. Noto's 9 tools are safe, but if the user runs other servers, they can disable individual Noto tools in **Settings → Tools & MCP**. Cursor **prompts per tool call** unless Auto-Run is on and the tool is allow-listed — fine for write safety.

**Steering — `.cursor/rules/noto-memory.mdc`:**
```md
---
description: When to read from / write to the Noto shared memory via MCP
alwaysApply: false
---
Noto (MCP server `noto`) is the persistent shared memory across AI tools.
- BEFORE answering anything depending on prior project context, decisions, or my
  preferences: call `search_notes`/`recall` (scoped), then `get_section` for detail.
- AFTER a durable decision/preference/fact: persist with `remember` or append to the
  relevant `Memory/` note. Durable items only; never store secrets.
- One focused search beats several broad reads. Never edit notes outside `Memory/`.
```
> Cursor also reads `AGENTS.md`, so the §7.2 file doubles as Cursor steering if you prefer one file.

---

## 8. Phased build plan (each phase independently shippable)

- **Phase 0 — Server prep (no MCP yet).** PAT table + bearer middleware; `GET /api/files/:id`; section read/write endpoints; `GET /api/search` via **SQLite FTS5**; `memories` table + `/api/memory/*`; `audit` table; Settings UI to mint PATs. *Ships value on its own: a token-auth API + search.*
- **Phase 1 — MVP stdio server, Claude Code only.** `noto-mcp` exposing the **read+memory core**: `search_notes`, `get_note`, `get_section`, `list_notes`, `remember`, `recall`. CLAUDE.md steering. *Proves token savings end-to-end, read-only-ish (memory writes only).*
- **Phase 2 — Writes + remaining clients.** Add `create_note`, `append_note`, `update_section`; read-only flag; audit surfacing; optimistic concurrency. Wire **Cursor** + **Codex** with steering files; reconcile Codex/ChatGPT native memory. *Full three-client memory.*
- **Phase 3 — Remote Streamable HTTP.** Mount the same handlers on Express at `/mcp` (bearer/OAuth); in-app toggle; multi-device. *Zero-install / shared instances.*
- **Phase 4 — Semantic memory.** Server-side embeddings (`@xenova/transformers` MiniLM, reusing `chunk.ts` passages) for `search_notes` + `recall`; consolidation/decay job. *Recall quality jump.*

---

## 9. Decisions

**Locked (confirmed 2026-06-27):**
1. **Hosting shape:** ✅ **Hosted multi-tenant.** MCP server reaches notes over HTTPS + PAT (gates the whole auth/transport design).
2. **Memory location:** ✅ **Hybrid** — narrative knowledge as real notes in a reserved `Memory/` folder + atomic facts in a structured side-table (dedup/decay/ranking).
3. **v1 search:** ✅ **FTS5 lexical first;** server-side semantic embeddings in Phase 4.
6. **Write posture:** ✅ **Read + `Memory/`-scoped writes by default.** No edits to other notes, no delete, until scope is explicitly widened.

**Still open (have defaults; confirm before/at planning):**
4. **MVP client:** which first. **Default: Claude Code (most mature MCP).**
5. **Memory scope key:** global vs per-project; if per-project, how is "project" identified (cwd? git remote?). **Default: per-project keyed by git remote, falling back to cwd, with a `global` scope too.**
7. **Sharing model:** one shared memory across all three clients vs per-client partitions. **Default: one shared store, tagged by `source_client`.**

## 10. Risks
- **Concurrency clobber** (last-write-wins) — mitigated by `Memory/` confinement + optimistic `expectUpdatedAt`; still a sharp edge if agents edit live human notes.
- **Embeddings gap** — client-only today; server semantic search is net-new work (Phase 4).
- **Codex HTTP flakiness / Cursor 40-tool cap / chunk-index instability** — all designed around (stdio, lean tools, heading addressing).
- **PAT leakage** — treat like a password; scope minimally; revocable; audit.
- **Steering is best-effort** — CLAUDE.md/AGENTS.md/.mdc *encourage* the read/write loop; none of these clients can hard-enforce it. Acceptable for a memory layer.
```
