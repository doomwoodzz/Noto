import { describe, it, expect } from "vitest";
import { classifyItem, contentHash } from "./dedup.ts";
import { upsertDumpSource, createUser, createVault, createFile } from "../db.ts";

describe("contentHash", () => {
  it("is stable and sensitive to content", () => {
    expect(contentHash("hello")).toBe(contentHash("hello"));
    expect(contentHash("hello")).not.toBe(contentHash("hellp"));
    expect(contentHash("hello")).toHaveLength(64); // sha256 hex
  });
});

describe("classifyItem", () => {
  // dump_sources.file_id has a real FK to files(id) (foreign_keys=ON), so each
  // test creates a real file to point at.
  function freshUser() {
    const u = createUser({ email: `dd-${crypto.randomUUID()}@t.local` });
    const v = createVault(u.id, { name: "V" });
    return { userId: u.id, vaultId: v.id };
  }
  function realFile(vaultId: string): string {
    return createFile(vaultId, { path: `Dump/t/${crypto.randomUUID()}.md`, title: "T", content: "x" }).id;
  }

  it("new when no dump_sources row exists", () => {
    const { userId } = freshUser();
    expect(classifyItem(userId, "raw:k-new", contentHash("x"))).toEqual({ status: "new" });
  });

  it("duplicate when a row with the same content hash exists", () => {
    const { userId, vaultId } = freshUser();
    const fileId = realFile(vaultId);
    const h = contentHash("same");
    upsertDumpSource({ userId, sourceKey: "raw:k-dup", fileId, contentHash: h, jobId: "j1" });
    expect(classifyItem(userId, "raw:k-dup", h)).toEqual({ status: "duplicate", dedupOf: fileId });
  });

  it("update when a row exists with a different content hash", () => {
    const { userId, vaultId } = freshUser();
    const fileId = realFile(vaultId);
    upsertDumpSource({ userId, sourceKey: "raw:k-upd", fileId, contentHash: contentHash("old"), jobId: "j1" });
    expect(classifyItem(userId, "raw:k-upd", contentHash("new"))).toEqual({ status: "update", dedupOf: fileId });
  });

  it("scopes by user (another user's source is invisible)", () => {
    const a = freshUser();
    const b = freshUser();
    const h = contentHash("z");
    upsertDumpSource({ userId: a.userId, sourceKey: "raw:shared", fileId: realFile(a.vaultId), contentHash: h, jobId: "j1" });
    expect(classifyItem(b.userId, "raw:shared", h)).toEqual({ status: "new" });
  });
});
