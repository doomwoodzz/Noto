import { describe, it, expect } from "vitest";
import { classifyItem, contentHash } from "./dedup.ts";
import { upsertDumpSource, ensureLocalOwner, createVault, createFile } from "../db.ts";

describe("contentHash", () => {
  it("is stable and sensitive to content", () => {
    expect(contentHash("hello")).toBe(contentHash("hello"));
    expect(contentHash("hello")).not.toBe(contentHash("hellp"));
    expect(contentHash("hello")).toHaveLength(64); // sha256 hex
  });
});

describe("classifyItem", () => {
  // dump_sources.file_id has a FK to files(id) (PRAGMA foreign_keys = ON), so each
  // upsertDumpSource needs a real backing file. freshUser returns the vault id so the
  // test can create genuine files; the assertions on status/dedupOf are unchanged.
  function freshUser() {
    const u = ensureLocalOwner();
    const v = createVault(u.id, { name: "V" });
    return { userId: u.id, vaultId: v.id };
  }

  function makeFile(vaultId: string, path: string): string {
    return createFile(vaultId, { path, title: path, content: "x" }).id;
  }

  it("new when no dump_sources row exists", () => {
    const { userId, vaultId } = freshUser();
    expect(classifyItem(userId, vaultId, "raw:k-new", contentHash("x"))).toEqual({ status: "new" });
  });

  it("duplicate when a row with the same content hash exists", () => {
    const { userId, vaultId } = freshUser();
    const fileId = makeFile(vaultId, "Dump/dup.md");
    const h = contentHash("same");
    upsertDumpSource({ userId, vaultId, sourceKey: "raw:k-dup", fileId, contentHash: h, jobId: "j1" });
    expect(classifyItem(userId, vaultId, "raw:k-dup", h)).toEqual({ status: "duplicate", dedupOf: fileId });
  });

  it("update when a row exists with a different content hash", () => {
    const { userId, vaultId } = freshUser();
    const fileId = makeFile(vaultId, "Dump/upd.md");
    upsertDumpSource({ userId, vaultId, sourceKey: "raw:k-upd", fileId, contentHash: contentHash("old"), jobId: "j1" });
    expect(classifyItem(userId, vaultId, "raw:k-upd", contentHash("new"))).toEqual({ status: "update", dedupOf: fileId });
  });

  it("scopes by vault (same source in a second vault is 'new', not a cross-vault match)", () => {
    const u = ensureLocalOwner();
    const vaultA = createVault(u.id, { name: "A" }).id;
    const vaultB = createVault(u.id, { name: "B" }).id;
    const fileA = createFile(vaultA, { path: "Dump/x.md", title: "x", content: "x" }).id;
    const h = contentHash("shared body");
    // Same user + source_key, but dumped into vault A.
    upsertDumpSource({ userId: u.id, vaultId: vaultA, sourceKey: "github:acme/widgets:README.md", fileId: fileA, contentHash: h, jobId: "j1" });
    // Vault A sees the duplicate; vault B must see it as NEW (its own note), not an
    // update pointing at vault A's file (which would overwrite the wrong vault).
    expect(classifyItem(u.id, vaultA, "github:acme/widgets:README.md", h)).toEqual({ status: "duplicate", dedupOf: fileA });
    expect(classifyItem(u.id, vaultB, "github:acme/widgets:README.md", h)).toEqual({ status: "new" });
    expect(classifyItem(u.id, vaultB, "github:acme/widgets:README.md", contentHash("changed"))).toEqual({ status: "new" });
  });
});
