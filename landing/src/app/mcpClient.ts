import { api } from "./api";
import type { McpClient } from "../workspace/mcpClient";

export const realMcpClient: McpClient = {
  notoUrl: window.location.origin,
  async listTokens() {
    return (await api.pat.list()).tokens;
  },
  async mintToken(name, scopes) {
    const r = await api.pat.mint({ name, scopes });
    return { id: r.id, token: r.token };
  },
  async revokeToken(id) {
    await api.pat.revoke(id);
  },
  async listMemories() {
    return (await api.memory.list()).memories;
  },
};
