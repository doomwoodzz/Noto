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
      <div className="nw-menu-scrim nw-mcp-scrim" onClick={onClose} />
      <div className="nw-mcp-panel" role="dialog" aria-modal="true" aria-labelledby="mcp-dialog-title">
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
