import { describe, expect, it } from "vitest";
import { buildConfigs, buildRemoteConfigs, STEERING_BODY, buildCursorDeepLink, buildClaudeAddCommand } from "./mcpConfigs.ts";

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

describe("buildRemoteConfigs", () => {
  it("produces an http server config per client with auth + client + scope headers", () => {
    const r = buildRemoteConfigs({ notoUrl: "https://noto.app", token: "noto_pat_abc", scope: "github.com/acme/widgets" });
    const cc = JSON.parse(r.claudeCode);
    expect(cc.mcpServers.noto.type).toBe("http");
    expect(cc.mcpServers.noto.url).toBe("https://noto.app/mcp");
    expect(cc.mcpServers.noto.headers.Authorization).toBe("Bearer noto_pat_abc");
    expect(cc.mcpServers.noto.headers["X-Noto-Client"]).toBe("claude-code");
    expect(cc.mcpServers.noto.headers["X-Noto-Scope"]).toBe("github.com/acme/widgets");

    const cur = JSON.parse(r.cursor);
    expect(cur.mcpServers.noto.headers["X-Noto-Client"]).toBe("cursor");

    expect(r.codex).toContain('url = "https://noto.app/mcp"');
    expect(r.codex).toContain('X-Noto-Client = "codex"');
    expect(r.codex).toContain('X-Noto-Scope = "github.com/acme/widgets"');
    expect(r.codex).toContain("disable_on_external_context = true");
  });

  it("omits X-Noto-Scope when no scope is given (server defaults to global)", () => {
    const r = buildRemoteConfigs({ notoUrl: "https://noto.app", token: "noto_pat_abc" });
    expect(JSON.parse(r.claudeCode).mcpServers.noto.headers["X-Noto-Scope"]).toBeUndefined();
    expect(r.codex).not.toContain("X-Noto-Scope");
  });
});

describe("buildCursorDeepLink", () => {
  it("targets the cursor install scheme with a base64 server config", () => {
    const url = buildCursorDeepLink({ notoUrl: "https://noto.test", token: "noto_pat_abc" });
    expect(url.startsWith("cursor://anysphere.cursor-deeplink/mcp/install?")).toBe(true);
    expect(new URL(url).searchParams.get("name")).toBe("noto");
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

  it("POSIX-escapes a single quote in notoUrl so the shell command stays intact", () => {
    const cmd = buildClaudeAddCommand({ notoUrl: "https://x.test/a'b", token: "t" });
    expect(cmd).toContain("'\\''");
    expect(cmd.endsWith("' --scope user")).toBe(true);
  });
});
