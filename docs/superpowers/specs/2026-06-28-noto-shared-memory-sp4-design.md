# Noto Shared Memory — SP4 Design (remote Streamable-HTTP `/mcp` + multi-device)

**Date:** 2026-06-28
**Status:** Approved design (brainstorm complete) — ready for `superpowers:writing-plans`
**Depends on:** SP1 + SP2 + SP3 (implemented, committed on `feat/noto-web-app`; SP3 on `feat/sp3-trust-ui`). Companions: `2026-06-28-noto-shared-memory-sp1-design.md`, `…-sp2-design.md`, `…-sp3-design.md`.

## 0. What SP4 is

SP1–SP3 exposed Noto as a shared memory layer over a **stdio** MCP server (`noto-mcp`, distributed via `npx`), which bridges Noto's PAT-authed HTTP `/api`. SP4 lets users connect their AI tools **without a local `npx` install and from any machine**, by mounting the same 9 tools on the Express app as a **remote Streamable-HTTP MCP endpoint** (`POST /mcp`, bearer PAT). **stdio stays the default**; remote is an added option.

This closes the "zero-install / cross-device" gap and is the transport phase of the companion MCP-memory roadmap (Phase 3). It is pure backend + a small Settings UI addition; it changes neither the tool surface (still 9, no `delete`) nor `noto-mcp`.

## 1. Scope

**In:**
- A `POST /mcp` endpoint on the Express app — **stateless** Streamable HTTP, PAT-gated.
- An **in-process bridge**: each tool call is replayed through the existing `/api` stack (forwarding the bearer token + headers), reusing every SP1–SP3 guard with zero duplication.
- `X-Noto-Scope` (project scope) + `X-Noto-Client` (provenance) request headers.
- Remote config variants per client in `mcpConfigs.ts` + a **Local (npx) / Remote (hosted)** toggle in `McpSettings`.
- Tests (config unit + `/mcp` HTTP integration) + a live HTTP smoke.

**Out (later / never):** changes to `noto-mcp` (untouched) · the legacy separate SSE transport (`/sse`+`/messages`) · multi-vault selection · embeddings/semantic (SP5) · any new tool · OAuth (PAT only).

## 2. Locked decisions (brainstorm, 2026-06-28)

| # | Decision | Choice |
|---|---|---|
| S4-D1 | Data access | **Bridge to the existing `/api`.** The `/mcp` tool handlers replay each call through the same PAT-authed `/api` endpoints stdio uses, forwarding the bearer token. Reuses zod validation, ownership-404, `Memory/` confinement, scope enforcement, and SP3 audit/provenance — zero duplication. (Exactly SP1's "bridge the HTTP API, not direct-DB" applied to `/mcp`.) |
| S4-D2 | Session model | **Stateless.** Each `POST /mcp` is independent — an ephemeral `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` handles one request and is discarded. No session store, no expiry, scales horizontally. Noto's 9 tools are all request/response with no server push. |
| S4-D3 | Remote scope | **`X-Noto-Scope` header from the per-project config**, default `global`. Mirrors stdio's `NOTO_SCOPE`; MCP HTTP configs already carry custom headers (where the bearer token + `X-Noto-Client` go). The agent may still pass an explicit `scope` arg per call. No schema change. |
| S4-D4 | Bridge mechanism | **In-memory inject** of the Express app (no socket, no self-port). Production uses `light-my-request` (`inject(app, …)`); the bridge `NotoClient` is DI-injectable so tests point it at the test server. (Loopback to `http://127.0.0.1:${env.PORT}` is the dep-free fallback if an Express incompatibility surfaces.) |
| S4-D5 | Transport | **Streamable HTTP only** (carries JSON + SSE responses on the one `/mcp`). No legacy separate SSE transport in v1. Codex remote-MCP flakiness is *documented* (recommend stdio for Codex), not engineered around. |
| S4-D6 | Tool surface | **Unchanged — 9 tools, no `delete`.** The human-only SP3 trust surface (`/api/activity`) is NOT exposed via `/mcp`. |

## 3. Architecture

```
Claude Code / Cursor / Codex   (remote MCP client — no local install, any machine)
        │  HTTPS POST /mcp
        │  Authorization: Bearer noto_pat_…   ·   X-Noto-Client: cursor   ·   X-Noto-Scope: github.com/acme/widgets
        ▼
Express app (landing/server)
  mcp/routes.ts   • resolveApiToken → requireApiUser (401 if absent/invalid PAT) · mcpLimiter
                  • per request: new McpServer + stateless StreamableHTTPServerTransport
                  • transport.handleRequest(req, res, req.body); cleanup on response close
  mcp/server.ts   • registers the 9 tools (schemas mirror noto-mcp/src/index.ts)
  mcp/handlers.ts • makeHandlers(bridgeClient, { scope: X-Noto-Scope ?? 'global' })  (mirrors noto-mcp/src/tools.ts)
        │  bridgeClient.<method>()   (the NotoClient shape from noto-mcp/src/notoClient.ts)
        ▼  in-memory inject(app, { method, url, headers: {Authorization, X-Noto-Client}, payload })
  /api (UNCHANGED)   helmet → limiter → resolveApiToken (sets req.apiUser; PAT ⇒ CSRF skipped)
                     → notes/memory/search routes → zod + ownership-404 + Memory/ confinement + scope(403) + writeAudit
        ▼
  SQLite (files, memories, audit_log, files_fts, memories_fts)
```

The remote endpoint is a thin **MCP-protocol shell**; the substance is an in-memory replay of the exact `/api` middleware + routes. Because PAT requests bypass CSRF (`auth/pat.ts:resolveApiToken` runs *before* `csrfProtection` and the bearer sets `req.apiUser`), the injected loopback call sails through and every guard fires. Writes are `Memory/`-confined and SP3-audited identically to stdio.

**Component boundaries (each small, testable):**
1. `mcp/bridge.ts` — builds a `NotoClient` (the noto-mcp shape) whose `fetchImpl` injects into `app`. One responsibility: turn `(method, path, headers, body)` into an in-process `/api` response. DI seam: `makeClient(token, headers)`.
2. `mcp/handlers.ts` — the 9 thin handlers (`makeHandlers(client, ctx)`), mirroring `noto-mcp/src/tools.ts`.
3. `mcp/server.ts` — builds an `McpServer` and registers the 9 tools with their schemas (mirroring `noto-mcp/src/index.ts`).
4. `mcp/routes.ts` — the stateless `/mcp` HTTP glue (auth, limiter, transport lifecycle).
5. `workspace/mcpConfigs.ts` — pure remote-config generator (extends the existing `buildConfigs`).
6. `workspace/McpSettings.tsx` — the Local/Remote toggle.

## 4. The `/mcp` endpoint (stateless Streamable HTTP)

- **Method:** `POST /mcp` only (top-level route, NOT under `/api`). `GET /mcp` and `DELETE /mcp` → `405` (no sessions to stream/terminate in stateless mode).
- **Auth:** `resolveApiToken` (reused) then `requireApiUser` → 401 if no/invalid PAT. Behind a new `mcpLimiter` (reuse the `ai/routes.ts` limiter pattern).
- **Body:** `express.json()` parses the JSON-RPC body; pass it to `transport.handleRequest(req, res, req.body)`.
- **Per-request lifecycle (stateless):**
  ```
  const server = buildMcpServer(makeClient(bearerToken, { client: xNotoClient, scope: xNotoScope }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
  ```
- **Bridge re-auth:** the `/mcp` handler reads the raw `Authorization` header (`req.get("authorization")`) and the bridge forwards it **verbatim** on each injected `/api` call, so `/api`'s own `resolveApiToken` re-resolves the same PAT (one extra indexed `usePat` lookup per tool call — negligible). `req.apiUser` carries no plaintext token, which is why the raw header is forwarded.
- **Per-tool scope** is enforced downstream by `/api` via the bridge: a `read`-only token calling `remember` → `/api/memory` returns 403 → the bridge throws → the tool result is `isError:true` (the same shape stdio produces). No scope logic in `/mcp` itself.

## 5. Scope + provenance on remote

- **Scope:** the `/mcp` handler reads `X-Noto-Scope` (header) as `ctx.scope` (default `'global'`), so `recall`/`remember`/`search_notes` default to the project scope exactly like stdio's `NOTO_SCOPE`. The agent can override per call with the tool's `scope` arg. Reads expand to `scope ∪ global`; writes land in exactly `scope` (server-side behavior unchanged from SP1).
- **Provenance:** `X-Noto-Client` (default `'remote'` if absent) is forwarded through the bridge to `/api`, landing on `memories.source_client` and `audit_log.source_client` — so SP3's "what did Cursor write" filter stays accurate for remote writes.

## 6. Config UI (`mcpConfigs.ts` + `McpSettings.tsx`)

- **`mcpConfigs.ts`** gains a pure remote generator `buildRemoteConfigs({ notoUrl, token, scope? })`:
  - **Claude Code** `.mcp.json`: `{ "mcpServers": { "noto": { "type": "http", "url": "<notoUrl>/mcp", "headers": { "Authorization": "Bearer <token>", "X-Noto-Client": "claude-code", "X-Noto-Scope": "<scope>" } } } }`
  - **Cursor** `.cursor/mcp.json`: same shape, `X-Noto-Client: "cursor"`.
  - **Codex** `~/.codex/config.toml`: `[mcp_servers.noto]` with `url` + `[mcp_servers.noto.headers]` (Authorization / X-Noto-Client / X-Noto-Scope). (Plus the existing `[memories] disable_on_external_context = true`.)
  - `X-Noto-Scope` is omitted from the snippet when no scope is given (→ server default `global`).
- **`McpSettings.tsx`**: a **Local (npx) / Remote (hosted)** toggle per client tab. Local shows the existing stdio snippet (unchanged); Remote shows the URL-based snippet + an optional **"project scope"** input that fills `X-Noto-Scope`. The steering templates, token list, and memory browse are unchanged.

## 7. Transport wrinkles (documented, not fought)

- **Streamable HTTP only.** It carries both JSON and SSE responses on the single `/mcp` endpoint, so Cursor's HTTP transport works without shipping the legacy separate `/sse`+`/messages` pair.
- **Codex:** remote MCP over HTTP is historically flaky — the Remote tab notes "Codex works best over the local (npx) option."
- **Cursor:** older versions probe SSE-first; current versions are fine on Streamable HTTP. No legacy SSE transport in v1 (a future add only if a target client strictly needs it).

## 8. Safety

- **PAT-gated:** no/invalid token → 401 before any MCP processing.
- **All SP1–SP3 guards intact via the bridge:** per-tool scope (403), ownership-404, `Memory/` confinement (PAT writes outside `Memory/` → 403 → tool error), and `writeAudit` provenance — none re-implemented, so none can drift.
- **No new capability:** 9 tools, no `delete`; the cookie-only SP3 trust/revert surface is not reachable via `/mcp`.
- **CSRF:** not applicable (no cookies; the PAT bypasses it, same as stdio).
- **Rate limiting:** `mcpLimiter` on `/mcp` + the existing `/api` limiters on each injected call (note: injected calls share a loopback IP key; the 300–600/min ceilings are generous for an AI tool's pace).

## 9. Testing (TDD, existing vitest stack)

- **Unit (`mcpConfigs.test.ts`):** each remote client snippet contains `url=<origin>/mcp`, the bearer token, the right `X-Noto-Client`, and `X-Noto-Scope` when a scope is given (omitted when not); Codex TOML shape.
- **Integration (`mcp/routes.test.ts`, `startTestServer` + a minted PAT, real HTTP to `/mcp`):**
  - `initialize` → `tools/list` returns exactly **9** tools.
  - A `tools/call` roundtrip (e.g. `remember` then `recall`) returns the expected result.
  - **Auth:** missing/invalid PAT → 401; a `read`-only token calling `remember` → tool `isError` (bridge 403).
  - **Bridge correctness:** `create_note` under `Memory/` works; a non-`Memory/` path → confined tool error; `remember`→`recall` roundtrip.
  - **`X-Noto-Scope`:** a `remember` sent with the header lands in that scope; `recall` with the same header finds it; a different scope does not.
  - **Stateless:** a second independent `tools/call` (no session id) succeeds.
  - **DI:** the test injects a `makeClient` pointed at the test server's base URL (or a real in-memory inject) so the bridge is exercised without a fixed port.
- **`noto-mcp`:** unchanged — its 21 tests must still pass (regression check only).
- **Live smoke:** real `tsx server/index.ts`; an HTTP MCP client (`initialize` → `notifications/initialized` → `tools/call`) against `/mcp`: cross-session `recall`; a write loop under `Memory/`; a non-`Memory/` write → tool error; a `read`-only token → `remember` error.

## 10. Success criteria

1. A remote MCP client connects to `/mcp` with only a PAT (no local install) and lists exactly **9** tools.
2. The full read + write loop works over `/mcp`, with writes confined to `Memory/`, audited, and provenance-stamped from `X-Noto-Client`.
3. `X-Noto-Scope` yields per-project memory; absent → `global`.
4. Auth + scope enforcement match stdio (401 / tool-error parity).
5. stdio and `noto-mcp` are unchanged; the full suite is green; the live HTTP smoke passes.

## 11. File structure (proposed; writing-plans pins exact paths)

**Server — `landing/server/`:**
- `mcp/bridge.ts` — `makeClient(token, { client, scope })` → a `NotoClient` whose `fetchImpl` injects into `app`; the `NotoClient` shape + 9 methods (mirrors `noto-mcp/src/notoClient.ts`).
- `mcp/handlers.ts` — `makeHandlers(client, ctx)` (mirrors `noto-mcp/src/tools.ts`).
- `mcp/server.ts` — `buildMcpServer(client, ctx)` registering the 9 tools + schemas (mirrors `noto-mcp/src/index.ts`).
- `mcp/routes.ts` — the stateless `/mcp` route; `mountMcp(app, { makeClient? })` DI seam.
- `app.ts` — mount `/mcp` (top-level, after `resolveApiToken`); add `@modelcontextprotocol/sdk` + `light-my-request` to `landing/package.json`.

**Client — `landing/src/`:**
- `workspace/mcpConfigs.ts` — `buildRemoteConfigs(...)`.
- `workspace/McpSettings.tsx` — Local/Remote toggle + project-scope input.

**Follow existing patterns:** DI as in `aiClient`/`citationClient`/`mcpClient`; limiter + `handle()` as in `ai/routes.ts`; the 9 tool schemas/handlers mirror `noto-mcp` verbatim (the contract is frozen — a comment cross-references `noto-mcp/src/index.ts` to keep them in sync).

## 12. Open questions (none blocking; defaults set)

- **Schema duplication:** the 9 tool schemas live in both `noto-mcp` (stdio) and `landing/server/mcp` (remote). The contract is frozen (9 tools, locked), so duplication is acceptable with a sync comment; a shared package is out of scope (not a monorepo).
- **Loopback IP rate-limit key:** injected calls share one IP key; acceptable at the current generous ceilings. Revisit only if real usage trips it.

Everything else is locked in §2 or deferred to SP5 per §1.
