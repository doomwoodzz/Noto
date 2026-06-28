// Pure generators for per-client MCP config + steering. No IO.
export interface McpConfigInput { notoUrl: string; token: string }

export const STEERING_BODY = `## Noto shared memory (MCP server: noto)
Noto is your persistent, cross-session memory, shared across your AI tools.
- BEFORE a task that depends on prior context, decisions, or my preferences:
  call \`recall\` and \`search_notes\` (scoped to this project); fetch only the
  sections you need with \`get_section\`. Don't re-read a note whose updatedAt you have.
- AFTER a durable decision/preference/fact emerges: persist it — \`remember\` for a
  one-line fact, or write narrative into a \`Memory/\` page via \`create_note\` /
  \`append_note\` / \`update_section\`. Store durable things only; never secrets.
- NEVER write outside \`Memory/\`. Prefer \`append_note\`/\`update_section\` over rewrites.`;

function jsonConfig(notoUrl: string, token: string, client: string): string {
  return JSON.stringify(
    { mcpServers: { noto: { command: "npx", args: ["-y", "noto-mcp"], env: { NOTO_URL: notoUrl, NOTO_TOKEN: token, NOTO_CLIENT: client } } } },
    null, 2,
  );
}

export function buildConfigs({ notoUrl, token }: McpConfigInput) {
  const t = token || "noto_pat_…";
  return {
    claudeCode: jsonConfig(notoUrl, t, "claude-code"),
    cursor: jsonConfig(notoUrl, t, "cursor"),
    codex:
      `[mcp_servers.noto]\n` +
      `command = "npx"\n` +
      `args = ["-y", "noto-mcp"]\n` +
      `env = { NOTO_URL = "${notoUrl}", NOTO_TOKEN = "${t}", NOTO_CLIENT = "codex" }\n\n` +
      `[memories]\n` +
      `disable_on_external_context = true\n`,
    steering: STEERING_BODY,
    cursorRule: `---\ndescription: When to read/write Noto shared memory via MCP\nalwaysApply: false\n---\n${STEERING_BODY}`,
  };
}
