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
