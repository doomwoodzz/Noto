import { describe, it, expect } from "vitest";
import { describeActivity } from "./activityFormat";
import type { ActivityEntry } from "./activityClient";

function entry(over: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: "a", tool: "create_note", createdAt: 0, client: "claude-code", device: "Laptop",
    target: { kind: "note", id: "f", title: "Memory/decisions.md", path: "Memory/decisions.md", text: null, status: null, exists: true },
    revertible: true, hasSnapshot: false, ...over,
  };
}

describe("describeActivity", () => {
  it("describes a note create with client + title", () => {
    expect(describeActivity(entry({}))).toBe("claude-code created Memory/decisions.md");
  });
  it("describes a memory remember with truncated text", () => {
    expect(describeActivity(entry({
      tool: "remember", client: "cursor",
      target: { kind: "memory", id: "m", title: null, path: null, text: "we use postgres", status: "active", exists: true },
    }))).toBe("cursor remembered “we use postgres”");
  });
  it("falls back to device, then a generic actor", () => {
    expect(describeActivity(entry({ client: null, device: "Work laptop" }))).toContain("Work laptop");
    expect(describeActivity(entry({ client: null, device: null }))).toContain("An AI tool");
  });
  it("labels a deleted note target", () => {
    expect(describeActivity(entry({
      tool: "append_note",
      target: { kind: "note", id: "f", title: null, path: null, text: null, status: null, exists: false },
    }))).toContain("a deleted note");
  });
});
