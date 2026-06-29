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
