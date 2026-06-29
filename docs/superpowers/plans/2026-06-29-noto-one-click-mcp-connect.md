# One-Click MCP Connect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-step "Connect AI tools (MCP)" panel with a minimal logo list where one Connect click mints a token silently and hands off to the best install path per tool (Cursor deep-link, Claude Code / Codex auto-copied command), preserving today's manual UI under an Advanced disclosure.

**Architecture:** Frontend-only. Add pure builders to `mcpConfigs.ts` (`buildCursorDeepLink`, `buildClaudeAddCommand`) and a pure `toolRegistry.ts` (`TOOLS`, `findToolToken`). Rewrite `McpSettings` as the panel shell + a list of `ToolCard`s + a `<details>` wrapping `AdvancedMcpSetup` (today's body, moved verbatim and made controlled). The `{ client, onClose }` contract and the `McpClient` DI seam are unchanged, so `NotoWindow` and the real/fake clients are untouched.

**Tech Stack:** React 18 + TypeScript (Vite), vitest (`environment: "node"` — pure-function tests only; this repo has no jsdom/testing-library harness), existing `McpClient` interface, CSS in `src/styles/workspace.css`.

**Testing note:** Because there is no React component-test harness (vitest runs in node env; zero `.test.tsx` exist), the *pure logic* (builders, registry, linked-state) is covered by unit tests, and the *components* are verified by typecheck + build + a manual preview pass. Do not add a component-test framework — that is out of scope.

---

### Task 1: Pure builders — Cursor deep-link + Claude Code command

**Files:**
- Modify: `landing/src/workspace/mcpConfigs.ts`
- Test: `landing/src/workspace/mcpConfigs.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `mcpConfigs.test.ts`)

```ts
import { buildCursorDeepLink, buildClaudeAddCommand } from "./mcpConfigs.ts";

describe("buildCursorDeepLink", () => {
  it("targets the cursor install scheme with a base64 server config", () => {
    const url = buildCursorDeepLink({ notoUrl: "https://noto.test", token: "noto_pat_abc" });
    expect(url.startsWith("cursor://anysphere.cursor-deeplink/mcp/install?")).toBe(true);
    const config = new URL(url).searchParams.get("config")!;
    const obj = JSON.parse(atob(config));
    expect(obj.command).toBe("npx");
    expect(obj.args).toEqual(["-y", "noto-mcp"]);
    expect(obj.env.NOTO_URL).toBe("https://noto.test");
    expect(obj.env.NOTO_TOKEN).toBe("noto_pat_abc");
    expect(obj.env.NOTO_CLIENT).toBe("cursor");
  });
});

describe("buildClaudeAddCommand", () => {
  it("is a claude mcp add-json command at user scope with valid embedded JSON", () => {
    const cmd = buildClaudeAddCommand({ notoUrl: "https://noto.test", token: "noto_pat_abc" });
    expect(cmd.startsWith("claude mcp add-json noto '")).toBe(true);
    expect(cmd.endsWith("' --scope user")).toBe(true);
    const json = cmd.slice("claude mcp add-json noto '".length, -"' --scope user".length);
    const obj = JSON.parse(json);
    expect(obj.env.NOTO_CLIENT).toBe("claude-code");
    expect(obj.env.NOTO_TOKEN).toBe("noto_pat_abc");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd landing && npx vitest run src/workspace/mcpConfigs.test.ts`
Expected: FAIL — `buildCursorDeepLink`/`buildClaudeAddCommand` are not exported.

- [ ] **Step 3: Implement the builders** (in `mcpConfigs.ts`)

Add a shared inner-server-object helper, refactor `jsonConfig` to reuse it (output is byte-identical, so existing tests still pass), and add the two builders. Insert after the `STEERING_BODY` constant:

```ts
// The inner MCP server entry shared by every stdio config + builder.
function notoServerObject(notoUrl: string, token: string, client: string) {
  return { command: "npx", args: ["-y", "noto-mcp"], env: { NOTO_URL: notoUrl, NOTO_TOKEN: token, NOTO_CLIENT: client } };
}

// base64 of the JSON, URL-encoded so it is safe inside a query string.
function encodeConfig(obj: unknown): string {
  return encodeURIComponent(btoa(JSON.stringify(obj)));
}

/** Cursor one-click install deep-link. The token is embedded (v1). */
export function buildCursorDeepLink({ notoUrl, token }: McpConfigInput): string {
  const cfg = notoServerObject(notoUrl, token || "noto_pat_…", "cursor");
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=noto&config=${encodeConfig(cfg)}`;
}

/** Claude Code one-paste CLI install (global scope; the server auto-detects per-project scope at runtime). */
export function buildClaudeAddCommand({ notoUrl, token }: McpConfigInput): string {
  const cfg = notoServerObject(notoUrl, token || "noto_pat_…", "claude-code");
  return `claude mcp add-json noto '${JSON.stringify(cfg)}' --scope user`;
}
```

Then replace the body of the existing `jsonConfig` so it reuses the helper:

```ts
function jsonConfig(notoUrl: string, token: string, client: string): string {
  return JSON.stringify({ mcpServers: { noto: notoServerObject(notoUrl, token, client) } }, null, 2);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd landing && npx vitest run src/workspace/mcpConfigs.test.ts`
Expected: PASS — all `buildConfigs`, `buildRemoteConfigs`, `buildCursorDeepLink`, `buildClaudeAddCommand` tests green (the `jsonConfig` refactor keeps the original output, so the existing cases still pass).

- [ ] **Step 5: Commit**

```bash
git add landing/src/workspace/mcpConfigs.ts landing/src/workspace/mcpConfigs.test.ts
git commit -m "feat(mcp-connect): pure Cursor deep-link + Claude add-json builders"
```

---

### Task 2: Tool registry + linked-state helper

**Files:**
- Create: `landing/src/workspace/toolRegistry.ts`
- Test: `landing/src/workspace/toolRegistry.test.ts`

- [ ] **Step 1: Write the failing tests** (`toolRegistry.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { TOOLS, findToolToken } from "./toolRegistry.ts";
import type { PatInfo } from "./mcpClient.ts";

const tok = (over: Partial<PatInfo>): PatInfo =>
  ({ id: "x", name: "Cursor", scopes: ["read"], createdAt: 1, lastUsedAt: null, ...over });

describe("TOOLS registry", () => {
  it("has the three v1 tools with the right mechanisms", () => {
    expect(TOOLS.map((t) => t.id)).toEqual(["claude-code", "cursor", "codex"]);
    expect(TOOLS.find((t) => t.id === "cursor")!.mechanism).toBe("deeplink");
    expect(TOOLS.find((t) => t.id === "claude-code")!.mechanism).toBe("command");
    expect(TOOLS.find((t) => t.id === "codex")!.mechanism).toBe("config");
  });
});

describe("findToolToken", () => {
  it("returns the newest token matching the tool label", () => {
    const tokens = [
      tok({ id: "old", name: "Cursor", createdAt: 1 }),
      tok({ id: "new", name: "Cursor", createdAt: 5 }),
      tok({ id: "other", name: "Codex", createdAt: 9 }),
    ];
    expect(findToolToken(tokens, "Cursor")!.id).toBe("new");
  });
  it("returns undefined when no token matches", () => {
    expect(findToolToken([tok({ name: "Codex" })], "Cursor")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd landing && npx vitest run src/workspace/toolRegistry.test.ts`
Expected: FAIL — `./toolRegistry.ts` does not exist.

- [ ] **Step 3: Implement the registry** (`toolRegistry.ts`)

```ts
import type { PatInfo } from "./mcpClient";

export type ConnectMechanism = "deeplink" | "command" | "config";

export interface ToolDef {
  id: "claude-code" | "cursor" | "codex";
  label: string;          // also the minted token name (drives Linked detection)
  descriptor: string;
  mechanism: ConnectMechanism;
  configTarget: string;   // where the install artifact goes
  steeringTarget: string; // where the optional steering goes
}

export const TOOLS: ToolDef[] = [
  { id: "claude-code", label: "Claude Code", descriptor: "Terminal coding agent", mechanism: "command",  configTarget: "your terminal",        steeringTarget: "CLAUDE.md" },
  { id: "cursor",      label: "Cursor",      descriptor: "AI code editor",        mechanism: "deeplink", configTarget: ".cursor/mcp.json",     steeringTarget: ".cursor/rules/noto-memory.mdc" },
  { id: "codex",       label: "Codex",       descriptor: "OpenAI CLI",            mechanism: "config",   configTarget: "~/.codex/config.toml", steeringTarget: "AGENTS.md" },
];

/** Newest active token whose name equals the tool label, or undefined. Drives Linked + disconnect. */
export function findToolToken(tokens: PatInfo[], label: string): PatInfo | undefined {
  return tokens
    .filter((t) => t.name === label)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd landing && npx vitest run src/workspace/toolRegistry.test.ts`
Expected: PASS — both describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add landing/src/workspace/toolRegistry.ts landing/src/workspace/toolRegistry.test.ts
git commit -m "feat(mcp-connect): tool registry + findToolToken linked-state helper"
```

---

### Task 3: Logo components

**Files:**
- Create: `landing/src/workspace/ToolLogos.tsx`

No unit test (presentational SVG; verified visually in Task 8).

- [ ] **Step 1: Create the logos** (`ToolLogos.tsx`)

Placeholder inline SVG marks; `currentColor` lets Cursor/Codex adopt the panel ink, while the Claude mark keeps its clay colour. Swap for official artwork later.

```tsx
import type { ReactNode } from "react";

export const TOOL_LOGOS: Record<string, ReactNode> = {
  "claude-code": (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="#D97757" strokeWidth="2.4" strokeLinecap="round">
        <line x1="12" y1="3" x2="12" y2="21" /><line x1="3" y1="12" x2="21" y2="12" />
        <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" /><line x1="18.4" y1="5.6" x2="5.6" y2="18.4" />
      </g>
    </svg>
  ),
  cursor: (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M12 3 L20 7.5 L20 16.5 L12 21 L4 16.5 L4 7.5 Z" /><path d="M12 3 L12 12 M4 7.5 L12 12 L20 7.5" />
    </svg>
  ),
  codex: (
    <svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <polygon points="12,3.2 19.6,7.6 19.6,16.4 12,20.8 4.4,16.4 4.4,7.6" /><circle cx="12" cy="12" r="3.1" />
    </svg>
  ),
};
```

- [ ] **Step 2: Verify it compiles**

Run: `cd landing && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add landing/src/workspace/ToolLogos.tsx
git commit -m "feat(mcp-connect): inline SVG logo placeholders"
```

---

### Task 4: Panel CSS for the logo list

**Files:**
- Modify: `landing/src/styles/workspace.css` (append after the existing `.nw-mcp-tab-on` rule, ~line 754)

- [ ] **Step 1: Append the styles**

Reuses existing vars (`--nw-ink`, `--nw-muted`, `--nw-line-3`, `--nw-accent-soft`, `--nw-accent-ink`, `--nw-accent-border`).

```css
.nw-mcp-tools { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
.nw-mcp-tool { border: 1px solid var(--nw-line-3); border-radius: 10px; padding: 11px 12px; }
.nw-mcp-tool-on { border-color: var(--nw-accent-border); }
.nw-mcp-tool-head { display: flex; align-items: center; gap: 12px; }
.nw-mcp-tool-logo { width: 40px; height: 40px; flex: none; display: flex; align-items: center; justify-content: center;
  background: rgba(127, 127, 127, .12); border-radius: 8px; color: var(--nw-ink); }
.nw-mcp-tool-meta { flex: 1; min-width: 0; }
.nw-mcp-tool-name { font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 8px; }
.nw-mcp-tool-desc { font-size: 12px; color: var(--nw-muted); }
.nw-mcp-badge { font-size: 11px; background: var(--nw-accent-soft); color: var(--nw-accent-ink); padding: 1px 8px; border-radius: 6px; }
.nw-mcp-connect { border: 1px solid var(--nw-accent-border); color: var(--nw-accent-ink); background: var(--nw-accent-soft);
  border-radius: 6px; padding: 6px 16px; font-size: 13px; cursor: pointer; }
.nw-mcp-connect:disabled { opacity: .6; cursor: default; }
.nw-mcp-linked { font-size: 12px; background: var(--nw-accent-soft); color: var(--nw-accent-ink); padding: 3px 10px; border-radius: 6px; }
.nw-mcp-reveal { margin-top: 10px; }
.nw-mcp-reveal-top { display: flex; justify-content: space-between; font-size: 11px; color: var(--nw-muted); margin-bottom: 6px; }
.nw-mcp-copied { color: var(--nw-accent-ink); }
.nw-mcp-tool-foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 9px; }
.nw-mcp-textbtn { background: none; border: 0; color: var(--nw-accent-ink); font-size: 12px; cursor: pointer; padding: 0; }
.nw-mcp-adv { margin-top: 18px; border-top: 1px solid var(--nw-line-3); padding-top: 12px; }
.nw-mcp-adv summary { font-size: 13px; color: var(--nw-muted); cursor: pointer; }
.nw-mcp-foot { font-size: 12px; color: var(--nw-muted); margin-top: 12px; }
```

- [ ] **Step 2: Commit**

```bash
git add landing/src/styles/workspace.css
git commit -m "feat(mcp-connect): styles for the tool list, badge, linked + advanced disclosure"
```

---

### Task 5: Extract AdvancedMcpSetup (today's body, made controlled)

**Files:**
- Create: `landing/src/workspace/AdvancedMcpSetup.tsx`

This is today's `McpSettings` body moved verbatim, with two changes: it receives `tokens` / `memories` / `refresh` from the parent instead of fetching them, and it drops the panel chrome + Escape handler (the parent keeps those). Not yet imported anywhere — that happens in Task 7.

- [ ] **Step 1: Create the component**

```tsx
import { useState } from "react";
import type { McpClient, PatInfo, MemoryInfo } from "./mcpClient";
import { buildConfigs, buildRemoteConfigs } from "./mcpConfigs";

type ClientKind = "claude-code" | "cursor" | "codex";
const CLIENT_LABEL: Record<ClientKind, string> = { "claude-code": "Claude Code", cursor: "Cursor", codex: "Codex" };
const CONFIG_TARGET: Record<ClientKind, string> = {
  "claude-code": ".mcp.json (project)",
  cursor: ".cursor/mcp.json (project)",
  codex: "~/.codex/config.toml",
};

export function AdvancedMcpSetup(
  { client, tokens, memories, refresh }:
  { client: McpClient; tokens: PatInfo[]; memories: MemoryInfo[]; refresh: () => void },
) {
  const [name, setName] = useState("Claude Code");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<ClientKind>("claude-code");
  const [mode, setMode] = useState<"local" | "remote">("local");
  const [scope, setScope] = useState("");

  const mint = async () => {
    setBusy(true); setErr(null);
    try {
      const { token } = await client.mintToken(name.trim() || "AI tool", ["read", "memory", "write"]);
      setFresh(token);
      refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not mint token."); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setErr(null);
    try { await client.revokeToken(id); refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not revoke token."); }
  };

  const localCfgs = buildConfigs({ notoUrl: client.notoUrl, token: fresh ?? "" });
  const remoteCfgs = buildRemoteConfigs({ notoUrl: client.notoUrl, token: fresh ?? "", scope: scope.trim() || undefined });
  const cfgs = mode === "remote" ? remoteCfgs : localCfgs;
  const config = kind === "claude-code" ? cfgs.claudeCode : kind === "cursor" ? cfgs.cursor : cfgs.codex;
  const steering = kind === "cursor" ? localCfgs.cursorRule : localCfgs.steering;
  const steeringTarget = kind === "claude-code" ? "CLAUDE.md" : kind === "cursor" ? ".cursor/rules/noto-memory.mdc" : "AGENTS.md";

  return (
    <>
      <section className="nw-mcp-sec">
        <h3>1 · Create a token</h3>
        <div className="nw-mcp-row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name" aria-label="Token name" />
          <button onClick={mint} disabled={busy}>Mint token</button>
        </div>
        <p className="nw-mcp-empty">Grants read + memory + write. Writes are limited to your <code>Memory/</code> folder.</p>
        {err && <p className="nw-mcp-err">{err}</p>}
        {fresh && <p className="nw-mcp-token">Copy now — shown once: <code>{fresh}</code></p>}
      </section>

      <section className="nw-mcp-sec">
        <h3>2 · Configure your tool</h3>
        <div className="nw-mcp-tabs" role="tablist">
          {(Object.keys(CLIENT_LABEL) as ClientKind[]).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k}
              className={kind === k ? "nw-mcp-tab nw-mcp-tab-on" : "nw-mcp-tab"}
              onClick={() => setKind(k)}>{CLIENT_LABEL[k]}</button>
          ))}
        </div>
        <div className="nw-mcp-tabs" role="tablist" aria-label="Transport">
          {(["local", "remote"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m}
              className={mode === m ? "nw-mcp-tab nw-mcp-tab-on" : "nw-mcp-tab"}
              onClick={() => setMode(m)}>{m === "local" ? "Local (npx)" : "Remote (hosted)"}</button>
          ))}
        </div>
        {mode === "remote" && (
          <div className="nw-mcp-row">
            <input value={scope} onChange={(e) => setScope(e.target.value)}
              placeholder="Project scope (optional, e.g. github.com/acme/widgets)" aria-label="Project scope" />
          </div>
        )}
        {mode === "remote" && kind === "codex" && (
          <p className="nw-mcp-empty">Codex remote MCP can be flaky — the Local (npx) option is more reliable for Codex.</p>
        )}
        <p className="nw-mcp-empty">Add to <code>{CONFIG_TARGET[kind]}</code>:</p>
        <pre className="nw-mcp-config">{config}</pre>
        <p className="nw-mcp-empty">Then add this steering to <code>{steeringTarget}</code> in your project:</p>
        <pre className="nw-mcp-config">{steering}</pre>
      </section>

      <section className="nw-mcp-sec">
        <h3>Active tokens</h3>
        {tokens.length === 0 && <p className="nw-mcp-empty">No tokens yet.</p>}
        <ul className="nw-mcp-list">
          {tokens.map((t) => (
            <li key={t.id}>
              <span>{t.name} · {t.scopes.join(", ")}</span>
              <button onClick={() => revoke(t.id)}>Revoke</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="nw-mcp-sec">
        <h3>Memory ({memories.length})</h3>
        {memories.length === 0 && <p className="nw-mcp-empty">No memories yet.</p>}
        <ul className="nw-mcp-mem">
          {memories.map((m) => (
            <li key={m.id}>
              <span className="nw-mcp-mem-text">{m.text}</span>
              <span className="nw-mcp-mem-meta">{m.type} · {m.scope} · {m.sourceClient}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd landing && npx tsc -b`
Expected: no errors (component is valid even though not yet imported).

- [ ] **Step 3: Commit**

```bash
git add landing/src/workspace/AdvancedMcpSetup.tsx
git commit -m "feat(mcp-connect): extract AdvancedMcpSetup (controlled props)"
```

---

### Task 6: ToolCard

**Files:**
- Create: `landing/src/workspace/ToolCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from "react";
import type { McpClient, PatInfo } from "./mcpClient";
import type { ToolDef } from "./toolRegistry";
import { findToolToken } from "./toolRegistry";
import { TOOL_LOGOS } from "./ToolLogos";
import { buildConfigs, buildCursorDeepLink, buildClaudeAddCommand, STEERING_BODY } from "./mcpConfigs";

function openDeepLink(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

export function ToolCard(
  { tool, client, tokens, refresh }:
  { tool: ToolDef; client: McpClient; tokens: PatInfo[]; refresh: () => void },
) {
  const linked = findToolToken(tokens, tool.label);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSteering, setShowSteering] = useState(false);

  const steering = tool.id === "cursor"
    ? `---\ndescription: When to read/write Noto shared memory via MCP\nalwaysApply: false\n---\n${STEERING_BODY}`
    : STEERING_BODY;

  const connect = async () => {
    setBusy(true); setErr(null); setCopied(false); setReveal(null);
    try {
      const stale = findToolToken(tokens, tool.label); // captured before minting the replacement
      const { token } = await client.mintToken(tool.label, ["read", "memory", "write"]);
      const notoUrl = client.notoUrl;
      if (tool.mechanism === "deeplink") {
        openDeepLink(buildCursorDeepLink({ notoUrl, token }));
        setReveal(buildConfigs({ notoUrl, token }).cursor); // fallback shown under the card
      } else {
        const text = tool.mechanism === "command"
          ? buildClaudeAddCommand({ notoUrl, token })
          : buildConfigs({ notoUrl, token }).codex;
        setReveal(text);
        setCopied(await copyText(text));
      }
      if (stale) { try { await client.revokeToken(stale.id); } catch { /* ignore */ } } // reconnect drops the old token
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not connect.");
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!linked) return;
    setErr(null);
    try { await client.revokeToken(linked.id); setReveal(null); refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not disconnect."); }
  };

  return (
    <div className={linked ? "nw-mcp-tool nw-mcp-tool-on" : "nw-mcp-tool"}>
      <div className="nw-mcp-tool-head">
        <span className="nw-mcp-tool-logo">{TOOL_LOGOS[tool.id]}</span>
        <div className="nw-mcp-tool-meta">
          <div className="nw-mcp-tool-name">
            {tool.label}
            {tool.mechanism === "deeplink" && <span className="nw-mcp-badge">1-click</span>}
          </div>
          <div className="nw-mcp-tool-desc">{tool.descriptor}</div>
        </div>
        {linked
          ? <span className="nw-mcp-linked">Linked</span>
          : <button className="nw-mcp-connect" onClick={connect} disabled={busy}>{busy ? "…" : "Connect"}</button>}
      </div>

      {err && <p className="nw-mcp-err">{err}</p>}

      {reveal && (
        <div className="nw-mcp-reveal">
          <div className="nw-mcp-reveal-top">
            <span>{tool.mechanism === "deeplink"
              ? `Didn't open? Paste into ${tool.configTarget}`
              : `Paste into ${tool.configTarget}`}</span>
            {copied && <span className="nw-mcp-copied">Copied</span>}
          </div>
          <pre className="nw-mcp-config">{reveal}</pre>
        </div>
      )}

      {linked && (
        <div className="nw-mcp-tool-foot">
          <button className="nw-mcp-textbtn"
            onClick={async () => { setShowSteering((s) => !s); await copyText(steering); }}>
            Add memory instructions to {tool.steeringTarget}
          </button>
          <button className="nw-mcp-textbtn" onClick={connect} disabled={busy}>Reconnect</button>
          <button className="nw-mcp-textbtn" onClick={disconnect}>Disconnect</button>
        </div>
      )}
      {showSteering && <pre className="nw-mcp-config">{steering}</pre>}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd landing && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add landing/src/workspace/ToolCard.tsx
git commit -m "feat(mcp-connect): ToolCard — mint-on-click, deep-link/copy, linked/disconnect"
```

---

### Task 7: Rewrite McpSettings as the logo list shell

**Files:**
- Modify: `landing/src/workspace/McpSettings.tsx` (full rewrite)

The `{ client, onClose }` signature is unchanged, so `NotoWindow.tsx:327` keeps working untouched. Parent owns `tokens`/`memories`/`refresh` and feeds both the cards and the Advanced panel.

- [ ] **Step 1: Replace the file contents**

```tsx
import { useEffect, useState } from "react";
import type { McpClient, PatInfo, MemoryInfo } from "./mcpClient";
import { TOOLS } from "./toolRegistry";
import { ToolCard } from "./ToolCard";
import { AdvancedMcpSetup } from "./AdvancedMcpSetup";

export function McpSettings({ client, onClose }: { client: McpClient; onClose: () => void }) {
  const [tokens, setTokens] = useState<PatInfo[]>([]);
  const [memories, setMemories] = useState<MemoryInfo[]>([]);

  const refresh = () => {
    client.listTokens().then(setTokens).catch(() => {});
    client.listMemories().then(setMemories).catch(() => {});
  };
  useEffect(() => {
    client.listTokens().then(setTokens).catch(() => {});
    client.listMemories().then(setMemories).catch(() => {});
  }, [client]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="nw-menu-scrim" onClick={onClose} />
      <div className="nw-mcp-panel" role="dialog" aria-labelledby="mcp-dialog-title">
        <header className="nw-mcp-head">
          <h2 id="mcp-dialog-title">Connect AI tools</h2>
          <button className="nw-mcp-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <p className="nw-mcp-empty">Give your AI tools shared memory. One click each — no token to copy, no JSON to edit.</p>

        <div className="nw-mcp-tools">
          {TOOLS.map((t) => (
            <ToolCard key={t.id} tool={t} client={client} tokens={tokens} refresh={refresh} />
          ))}
        </div>

        <details className="nw-mcp-adv">
          <summary>Advanced / manual setup</summary>
          <AdvancedMcpSetup client={client} tokens={tokens} memories={memories} refresh={refresh} />
        </details>

        <p className="nw-mcp-foot">Memory · {memories.length} facts</p>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd landing && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add landing/src/workspace/McpSettings.tsx
git commit -m "feat(mcp-connect): McpSettings logo list + Advanced disclosure"
```

---

### Task 8: Full verification + manual preview pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit-test suite**

Run: `cd landing && npm test`
Expected: PASS — all prior tests plus the new `buildCursorDeepLink`, `buildClaudeAddCommand`, `TOOLS`, and `findToolToken` cases. (Baseline before this work was 214 landing tests; expect 214 + the new cases.)

- [ ] **Step 2: Typecheck the client + server**

Run: `cd landing && npx tsc -b && npm run typecheck:server`
Expected: no errors. (Server is unchanged — this is a sanity check.)

- [ ] **Step 3: Lint the touched files**

Run: `cd landing && npm run lint`
Expected: only the known pre-existing errors in unrelated files (ActivityView / google / Onboarding, ~9 from prior SP work). No new errors in `mcpConfigs.ts`, `toolRegistry.ts`, `ToolLogos.tsx`, `ToolCard.tsx`, `AdvancedMcpSetup.tsx`, `McpSettings.tsx`. If a new error appears in a touched file, fix it and re-run.

- [ ] **Step 4: Manual preview smoke (use the preview tools)**

Start the dev server (`npm run dev`), then in the app: sign in (or use Skip/guest), open the workspace, and open Connect AI tools.
- Verify the three cards render with logos, descriptors, and a `1-click` badge on Cursor.
- Click Connect on **Codex** → the config block reveals, shows "Copied", and the card flips to `Linked` (Codex appears in the Advanced → Active tokens list). Confirm the clipboard holds the `[mcp_servers.noto]` block.
- Click Connect on **Cursor** → the `.cursor/mcp.json` fallback reveals under the card (the OS may prompt to open Cursor; that's the deep-link firing).
- Expand **Advanced / manual setup** → today's full flow (mint, tabs, local/remote, token list, memory) is intact.
- Click `Disconnect` on a linked card → it returns to the Connect state and the token leaves the Active tokens list.

Note: mint requires an authenticated session; if Connect shows an inline error, confirm you're signed in (this is the pre-existing "Failed to fetch" risk from the spec §9, not a regression in this work).

- [ ] **Step 5: Final commit (only if Step 3/4 required fixes)**

```bash
git add -A landing/src
git commit -m "fix(mcp-connect): lint/preview follow-ups"
```

---

## Self-Review

**Spec coverage** (against `2026-06-29-noto-one-click-mcp-connect-design.md`):
- §1 logo list of 3 tools → Tasks 2, 6, 7. Mint-on-click → Task 6. Cursor deep-link / Claude command / Codex block → Tasks 1, 6. Linked + Disconnect + Reconnect → Tasks 2, 6. Optional steering → Task 6. Advanced disclosure (verbatim) → Tasks 5, 7. Inline SVG logos → Task 3. Tests + existing green → Tasks 1–2, 8.
- OC-D1..D9 all map to tasks (D3 mechanism → registry+ToolCard; D4 mint scopes → ToolCard; D5 linked → findToolToken; D6 `--scope user` → Task 1; D7 steering → ToolCard; D9 verbatim Advanced → Task 5).
- §6 error handling: mint error inline (ToolCard `err`), clipboard fallback (`copyText` returns false → no "Copied", text still shown in `reveal`), deep-link fallback (`reveal` = `.cursor/mcp.json`). Covered in Task 6.
- §7 deferred items: intentionally not built. §9 risks (Cursor scheme, claude flags, mint bug): flagged in Task 8 Step 4; no code depends on resolving them beyond the documented defaults.

**Placeholder scan:** No TBD/TODO/"handle edge cases". Every code step shows complete code. The SVG marks are intentional placeholders per OC-D8, not plan gaps.

**Type consistency:** `findToolToken(tokens, label)` signature identical in Tasks 2 and 6. `ToolDef` fields (`id/label/descriptor/mechanism/configTarget/steeringTarget`) used consistently. `McpConfigInput` ({notoUrl, token}) reused by both new builders. `ToolCard`/`AdvancedMcpSetup` prop shapes match what `McpSettings` passes in Task 7. `buildConfigs(...).cursor` / `.codex` and `STEERING_BODY` are existing exports.

No gaps found.
