import { describe, expect, it } from "vitest";
import { ensureLocalOwner, rememberMemory, recallMemories, listMemories } from "../db.ts";

// One local owner by design (see ensureLocalOwner in db.ts). `email` is kept
// as a no-op parameter so every call site below stays unchanged — none of
// these tests compares two users, they just want a userId to scope memories.
function freshUser(_email: string) {
  return ensureLocalOwner().id;
}

describe("memory store", () => {
  it("inserts a memory and recalls it by query within scope ∪ global", () => {
    const uid = freshUser("mem-a@example.com");
    rememberMemory({ userId: uid, text: "We use Vitest for tests", type: "decision", scope: "proj/x", sourceClient: "claude-code" });
    const hits = recallMemories(uid, ["proj/x"], "vitest", undefined, 6);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe("We use Vitest for tests");
    expect(hits[0].sourceClient).toBe("claude-code");
  });

  it("dedups exact-normalized text in the same scope (bumps use_count, no duplicate)", () => {
    const uid = freshUser("mem-b@example.com");
    const a = rememberMemory({ userId: uid, text: "Prefer tabs", type: "preference", scope: "proj/y", sourceClient: "claude-code" });
    const b = rememberMemory({ userId: uid, text: "  prefer   TABS  ", type: "preference", scope: "proj/y", sourceClient: "claude-code" });
    expect(b.deduped).toBe(true);
    expect(b.memory.id).toBe(a.memory.id);
    expect(listMemories(uid, "proj/y", undefined, 50)).toHaveLength(1);
  });

  it("supersede retires the old fact and excludes it from recall", () => {
    const uid = freshUser("mem-c@example.com");
    const old = rememberMemory({ userId: uid, text: "DB is Postgres", type: "fact", scope: "proj/z", sourceClient: "claude-code" });
    rememberMemory({ userId: uid, text: "DB is SQLite", type: "fact", scope: "proj/z", sourceClient: "claude-code", supersedesId: old.memory.id });
    const hits = recallMemories(uid, ["proj/z"], "DB", undefined, 6);
    expect(hits.map((h) => h.text)).toEqual(["DB is SQLite"]);
  });

  it("supersede whose text matches another active memory dedups instead of throwing", () => {
    const uid = freshUser("mem-supersede-dup@example.com");
    const keep = rememberMemory({ userId: uid, text: "Use pnpm", type: "preference", scope: "proj/k", sourceClient: "claude-code" });
    const old = rememberMemory({ userId: uid, text: "Use npm", type: "preference", scope: "proj/k", sourceClient: "claude-code" });
    const res = rememberMemory({ userId: uid, text: "use   PNPM", type: "preference", scope: "proj/k", sourceClient: "claude-code", supersedesId: old.memory.id });
    expect(res.deduped).toBe(true);
    expect(res.memory.id).toBe(keep.memory.id);
    expect(listMemories(uid, "proj/k", undefined, 50).map((m) => m.text)).toEqual(["Use pnpm"]);
  });

  // Kept last deliberately: every freshUser() in this file now resolves to the
  // same single local owner, and listMemories() always unions in 'global'-scope
  // memories with no text-relevance filter (unlike recallMemories). Writing a
  // global memory here would otherwise leak into any listMemories() call in a
  // later test (e.g. the proj/k exact-match check above).
  it("reads union global; a project query also surfaces global prefs", () => {
    const uid = freshUser("mem-d@example.com");
    rememberMemory({ userId: uid, text: "Always write conventional commits", type: "preference", scope: "global", sourceClient: "claude-code" });
    rememberMemory({ userId: uid, text: "This service owns billing", type: "fact", scope: "proj/q", sourceClient: "claude-code" });
    const hits = recallMemories(uid, ["proj/q"], "commits", undefined, 6);
    expect(hits.map((h) => h.text)).toContain("Always write conventional commits");
  });
});
