import { useEffect, useState } from "react";
import type { McpClient, PatInfo, MemoryInfo } from "./mcpClient";
import { buildConfigs } from "./mcpConfigs";

type ClientKind = "claude-code" | "cursor" | "codex";
const CLIENT_LABEL: Record<ClientKind, string> = { "claude-code": "Claude Code", cursor: "Cursor", codex: "Codex" };
const CONFIG_TARGET: Record<ClientKind, string> = {
  "claude-code": ".mcp.json (project)",
  cursor: ".cursor/mcp.json (project)",
  codex: "~/.codex/config.toml",
};

export function McpSettings({ client, onClose }: { client: McpClient; onClose: () => void }) {
  const [tokens, setTokens] = useState<PatInfo[]>([]);
  const [memories, setMemories] = useState<MemoryInfo[]>([]);
  const [name, setName] = useState("Claude Code");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<ClientKind>("claude-code");

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

  const cfgs = buildConfigs({ notoUrl: client.notoUrl, token: fresh ?? "" });
  const config = kind === "claude-code" ? cfgs.claudeCode : kind === "cursor" ? cfgs.cursor : cfgs.codex;
  const steering = kind === "cursor" ? cfgs.cursorRule : cfgs.steering;
  const steeringTarget = kind === "claude-code" ? "CLAUDE.md" : kind === "cursor" ? ".cursor/rules/noto-memory.mdc" : "AGENTS.md";

  return (
    <>
      <div className="nw-menu-scrim" onClick={onClose} />
      <div className="nw-mcp-panel" role="dialog" aria-labelledby="mcp-dialog-title">
        <header className="nw-mcp-head">
          <h2 id="mcp-dialog-title">Connect AI tools (MCP)</h2>
          <button className="nw-mcp-x" onClick={onClose} aria-label="Close">×</button>
        </header>

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
      </div>
    </>
  );
}
