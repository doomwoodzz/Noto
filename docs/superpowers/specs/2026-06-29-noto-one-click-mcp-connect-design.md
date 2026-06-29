# Noto One-Click MCP Connect — Design

**Date:** 2026-06-29
**Status:** Approved design (brainstorm complete) — ready for `superpowers:writing-plans`
**Depends on:** SP1–SP5a (the MCP memory layer). Reuses the existing "Connect AI tools (MCP)" panel `landing/src/workspace/McpSettings.tsx`, the token APIs `/api/tokens` (mint/list/revoke), and the config generators `landing/src/workspace/mcpConfigs.ts`. Companion: the `noto-mcp-memory-layer` memory; specs `…-sp1-design.md` … `…-sp5a-design.md`.

## 0. What this is

Today, connecting an AI tool to Noto is a three-step manual chore: mint a token, paste JSON into a per-tool config file, paste steering into `CLAUDE.md`. This redesign turns the "Connect AI tools (MCP)" panel into a **minimal list of AI tools with logos**, each with a single **Connect** button. One click mints the token silently and hands off to the best install mechanism that tool supports. Everything in today's manual UI is preserved behind a collapsible "Advanced / manual setup."

**The constraint that shaped everything:** the panel runs in a **browser tab**, which is sandboxed — it cannot scan the disk for installed tools or write config files (`.mcp.json`, `~/.codex/config.toml`, `CLAUDE.md`). So literal "auto-detect every AI on the device and wire it up" is impossible from the web page itself. v1 takes the **pure-web, zero-install** path: a real 1-click via deep-link where a tool supports one, and mint-on-click + an auto-copied command everywhere else.

## 1. Scope

**In:**
- Redesign `McpSettings` into a logo list of three tools: **Claude Code, Cursor, Codex**.
- **Mint-on-click** — clicking Connect silently mints a PAT (no token name field, no copy step).
- Per-tool connect: **Cursor deep-link** (true 1-click); **Claude Code** auto-copied `claude mcp add-json` command; **Codex** auto-copied `config.toml` block.
- **"Linked" state** derived from an active token named after the tool, with per-row `Disconnect` (revoke) and `Reconnect` (re-mint + revoke stale).
- **Steering becomes optional** — a one-tap "Add memory instructions" that copies the existing per-tool steering text.
- **Advanced / manual setup** collapsible holding today's full UI verbatim (token name + mint, client tabs, local/remote toggle, project-scope input, JSON + steering blocks, active-token list, memory browser).
- Inline SVG logo placeholders, swappable for official artwork.
- Unit + component tests; all existing tests stay green.

**Out (later / never):**
- True device auto-detection / filesystem writes — needs a CLI helper or native bridge (deferred; see §7).
- One-time **pairing-code** token exchange (device-grant style) — fast-follow hardening; v1 embeds the raw token (no worse than today, where the token already lands in config files).
- **MCP-native steering** via the server `instructions` field (brainstorm "Approach B") — fast-follow once per-client support is verified.
- Tools beyond the three (Claude Desktop, VS Code, Windsurf, …).
- Any **server change** — mint/list/revoke and config generators already exist.
- Fixing the pre-existing "Failed to fetch" mint error (separate bug; see §6).

## 2. Locked decisions (brainstorm, 2026-06-29)

| # | Decision | Choice |
|---|---|---|
| OC-D1 | Surface | **Pure-web, zero-install.** No CLI helper, no native bridge in v1. |
| OC-D2 | Tools | **Claude Code, Cursor, Codex** (matches today's generators). |
| OC-D3 | Per-tool mechanism | **Cursor = deep-link** (`cursor://…/mcp/install`); **Claude Code = auto-copied `claude mcp add-json` command**; **Codex = auto-copied `config.toml` block**. |
| OC-D4 | Token | **Mint-on-click**, scopes `read,memory,write`, auto-named after the tool. **Raw token embedded** in the deep-link/command (v1). |
| OC-D5 | Linked state | Presence of an active token **named after the tool**. Disconnect = revoke; Reconnect = re-mint + revoke stale. |
| OC-D6 | Claude Code scope | `claude mcp add-json … --scope user` (global). The MCP server already auto-detects per-project scope at runtime, so one global install works in every project. |
| OC-D7 | Steering | **Optional**, one-tap copy of the existing `STEERING_BODY` (per-tool target: `CLAUDE.md` / `.cursor/rules/noto-memory.mdc` / `AGENTS.md`). Not a required step. |
| OC-D8 | Logos | **Inline SVG placeholders**, swappable later. |
| OC-D9 | Backward-compat | Today's full manual UI preserved verbatim under **Advanced / manual setup**. |

## 3. Architecture

Component tree (all frontend; no server change):

```
McpSettings (panel shell: header, tool list, footer)
├── ToolCard × 3             reads Linked from the token list; renders logo, name, action
│     └── connect(tool) ─► client.mintToken() ─► per-tool artifact:
│             ├── Cursor:      navigate buildCursorDeepLink(cfg)   (+ fallback .cursor/mcp.json)
│             ├── Claude Code: clipboard ← buildClaudeAddCommand(cfg)
│             └── Codex:       clipboard ← buildConfigs().codex
├── footer: Memory count + "Advanced / manual setup" toggle
└── AdvancedMcpSetup (collapsed)    ← today's McpSettings body, moved verbatim
```

**Pure builders** (no IO, unit-tested) live in `mcpConfigs.ts` beside the existing generators:
- `buildCursorDeepLink({ notoUrl, token })` → `cursor://anysphere.cursor-deeplink/mcp/install?name=noto&config=<base64url(serverObject)>`, where `serverObject` is the inner `{ command, args, env }` (the same object today's `jsonConfig` wraps under `mcpServers.noto`).
- `buildClaudeAddCommand({ notoUrl, token })` → `claude mcp add-json noto '<json>' --scope user`.
- Codex uses the existing `buildConfigs().codex` block.

A pure `toolRegistry` maps each tool id → `{ label, descriptor, Logo, mechanism, configTarget, steeringTarget }`. `ToolCard` is mechanism-driven, so adding a tool later is a registry entry, not new branching.

## 4. Connect flow (per click)

1. User clicks **Connect** on a tool.
2. `client.mintToken(tool.label, ["read","memory","write"])` → `{ token }`. On error: inline message on that card, no other state changes.
3. Build the per-tool artifact with the fresh token and act:
   - **Cursor** — navigate to the deep-link (hidden `<a>` click or `location.href`). Show "Opening Cursor…" plus a fallback `.cursor/mcp.json` block ("Didn't open? Paste this.").
   - **Claude Code / Codex** — `navigator.clipboard.writeText(artifact)`; reveal the snippet with "Copied — paste into `<configTarget>`." Clipboard failure → render the text pre-selected for manual copy.
4. The card flips to **Linked** (the new token is now in the list). It then offers **Add memory instructions** (copies the per-tool steering) and **Disconnect**.

## 5. State & data

- **No new persisted state.** "Linked" is computed each render from `client.listTokens()` by matching `token.name === tool.label`.
- **Reconnect** = mint new, then revoke the previous same-named token id.
- **Disconnect** = revoke the matched token id.
- Footer **memory count** = `client.listMemories().length` (already fetched by the panel today).
- The `McpClient` DI interface is unchanged (`mintToken` / `listTokens` / `revokeToken` / `listMemories` / `notoUrl`).

## 6. Error handling & edge cases

- **Mint fails** → card-level error; no partial state. *NB:* the screenshot's "Failed to fetch" is a pre-existing mint failure (likely an unauthenticated session or dev API base), out of scope here but flagged in §9 — it must be resolved or confirmed env-only before shipping, or every Connect fails.
- **Clipboard unavailable** (non-secure context / Safari quirk) → fall back to a selectable text block.
- **Deep-link doesn't fire** (Cursor not installed, or the scheme is blocked) → the fallback `.cursor/mcp.json` is always shown under the Cursor card, so the manual path is one copy away.
- **Stale / duplicate tokens** named after a tool → Reconnect revokes the prior id; Disconnect revokes the matched id. Pre-existing tokens from the old flow that happen to be named after a tool will correctly read as Linked.

## 7. Deferred upgrades (explicitly not v1)

- **`npx noto connect` CLI** — scans the device, detects installed tools, writes all their configs + steering at once. The truest "find & connect everything"; costs the user one terminal paste. (Brainstorm option 2.)
- **Local / native helper** — a localhost bridge or the native macOS app does detection + file writes, giving the web UI a true GUI one-click with real auto-detect. (Brainstorm option 3.)
- **Pairing-code token exchange** — replace the raw token in URLs/commands with a short-lived one-time code redeemed for the PAT.
- **MCP-native steering** — expose the steering via the `noto-mcp` server `instructions` field so it needs no file edit (Approach B).

## 8. Testing

- **Pure builders** (`mcpConfigs.test.ts`, extended): the Cursor deep-link's `config` param base64url-decodes to the expected inner server object; `buildClaudeAddCommand` produces the right `claude mcp add-json … --scope user` string with valid embedded JSON; the Codex block is unchanged.
- **toolRegistry / Linked mapping**: a given token list resolves to the correct per-tool Linked state.
- **Component** (fake `McpClient` via the existing DI seam): Connect calls `mintToken` once with `["read","memory","write"]`; clipboard is written for Claude Code/Codex; the deep-link is built for Cursor; a mint error renders inline; Reconnect revokes the stale id.
- All existing landing + `noto-mcp` tests stay green; no server tests change (no server change).

## 9. Risks / to verify during implementation

- **Cursor deep-link spec** — confirm the current scheme `cursor://anysphere.cursor-deeplink/mcp/install` and whether `config` is base64url of the inner server object or the `mcpServers` wrapper.
- **`claude mcp add-json` flags** — confirm `--scope user` and JSON-arg quoting across shells (zsh/bash).
- **Codex** — confirm there is no reliable `codex mcp add` we'd prefer over the config-block paste.
- **Pre-existing mint "Failed to fetch"** — must be resolved (or confirmed environment-only) before shipping; otherwise every Connect fails at step 2.
