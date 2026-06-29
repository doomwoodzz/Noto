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
