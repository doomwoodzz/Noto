import { describe, expect, it } from "vitest";
import { buildConfigs, STEERING_BODY } from "./mcpConfigs.ts";

describe("buildConfigs", () => {
  const cfg = buildConfigs({ notoUrl: "https://noto.test", token: "noto_pat_abc" });
  it("Claude Code + Cursor JSON carry url, token, and the right NOTO_CLIENT", () => {
    expect(cfg.claudeCode).toContain("https://noto.test");
    expect(cfg.claudeCode).toContain("noto_pat_abc");
    expect(cfg.claudeCode).toContain("\"claude-code\"");
    expect(cfg.cursor).toContain("\"cursor\"");
  });
  it("Codex TOML includes the server + native-memory reconciliation", () => {
    expect(cfg.codex).toContain("[mcp_servers.noto]");
    expect(cfg.codex).toContain("NOTO_CLIENT = \"codex\"");
    expect(cfg.codex).toContain("disable_on_external_context = true");
  });
  it("cursor rule has frontmatter; steering body mentions Memory/", () => {
    expect(cfg.cursorRule).toContain("alwaysApply: false");
    expect(STEERING_BODY).toContain("Memory/");
  });
  it("falls back to a placeholder token when none is given", () => {
    expect(buildConfigs({ notoUrl: "https://x", token: "" }).claudeCode).toContain("noto_pat_…");
  });
});
