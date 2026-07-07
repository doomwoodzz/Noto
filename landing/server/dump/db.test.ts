import { describe, it, expect } from "vitest";
import { db } from "../db.ts";

describe("dump migrations", () => {
  it("creates the four dump tables", () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toContain("dump_jobs");
    expect(names).toContain("dump_items");
    expect(names).toContain("dump_sources");
    expect(names).toContain("connector_tokens");
  });
});

import {
  createDumpJob, getOwnedDumpJob, setDumpJobStatus, setDumpJobCounts,
  insertDumpItem, listDumpItems, updateDumpItem,
  getDumpSource, upsertDumpSource,
  saveConnectorToken, getConnectorToken, listConnectors, deleteConnector,
  ensureLocalOwner, createVault, createFile, getOwnedFile, deleteOwnedFile,
} from "../db.ts";

describe("dump accessors", () => {
  // One local owner by design; each call gives it a fresh, independent vault
  // so per-test data stays isolated (no test here compares two users).
  function freshUserVault() {
    const u = ensureLocalOwner();
    const v = createVault(u.id, { name: "V" });
    return { userId: u.id, vaultId: v.id };
  }

  it("creates + reads a job, scoped by owner", () => {
    const { userId, vaultId } = freshUserVault();
    const job = createDumpJob({ userId, vaultId, sourceType: "raw", sourceRef: { type: "raw" }, sourceSlug: "pasted" });
    expect(getOwnedDumpJob(userId, job.id)?.status).toBe("queued");
    expect(getOwnedDumpJob("someone-else", job.id)).toBeUndefined();
  });

  it("advances status + counts", () => {
    const { userId, vaultId } = freshUserVault();
    const job = createDumpJob({ userId, vaultId, sourceType: "raw", sourceRef: {}, sourceSlug: "p" });
    setDumpJobStatus(job.id, "shaping");
    setDumpJobCounts(job.id, { fetched: 3, shaped: 2 });
    const row = getOwnedDumpJob(userId, job.id)!;
    expect(row.status).toBe("shaping");
    expect(JSON.parse(row.counts).shaped).toBe(2);
  });

  it("inserts + lists + updates items", () => {
    const { userId, vaultId } = freshUserVault();
    const job = createDumpJob({ userId, vaultId, sourceType: "raw", sourceRef: {}, sourceSlug: "p" });
    const item = insertDumpItem({ jobId: job.id, sourceKey: "raw:abc", status: "pending" });
    updateDumpItem(item.id, { status: "shaped", shaped: JSON.stringify({ title: "X" }), redaction_count: 1 });
    const items = listDumpItems(job.id);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("shaped");
    expect(items[0].redaction_count).toBe(1);
  });

  it("upserts + reads a dump_source by (user, vault, key)", () => {
    const { userId, vaultId } = freshUserVault();
    // dump_sources.file_id has a FK to files(id) (foreign_keys = ON), so reference a real file.
    const f1 = createFile(vaultId, { path: "n/a.md", title: "A", content: "x" });
    upsertDumpSource({ userId, vaultId, sourceKey: "raw:k", fileId: f1.id, contentHash: "h1", jobId: "j1" });
    expect(getDumpSource(userId, vaultId, "raw:k")?.content_hash).toBe("h1");
    upsertDumpSource({ userId, vaultId, sourceKey: "raw:k", fileId: f1.id, contentHash: "h2", jobId: "j2" });
    expect(getDumpSource(userId, vaultId, "raw:k")?.content_hash).toBe("h2");
  });

  it("saves + reads + deletes a connector token", () => {
    const { userId } = freshUserVault();
    saveConnectorToken({ userId, provider: "github", externalAccount: "octocat", installationId: "42", accessTokenCipher: null, scopes: "contents:read" });
    expect(getConnectorToken(userId, "github")?.external_account).toBe("octocat");
    expect(listConnectors(userId).map((c) => c.provider)).toContain("github");
    deleteConnector(userId, "github");
    expect(getConnectorToken(userId, "github")).toBeUndefined();
  });

  it("round-trips a Uint8Array cipher through the connector BLOB column", () => {
    const { userId } = freshUserVault();
    const cipher = new Uint8Array([1, 2, 3, 250, 0, 255]);
    saveConnectorToken({ userId, provider: "notion", externalAccount: "ws", accessTokenCipher: cipher });
    const row = getConnectorToken(userId, "notion");
    expect(row?.access_token_cipher).toBeInstanceOf(Uint8Array);
    expect(Array.from(row!.access_token_cipher!)).toEqual([1, 2, 3, 250, 0, 255]);
  });

  it("deletes a file by owner (cascades passages/sources)", () => {
    const u = ensureLocalOwner();
    const v = createVault(u.id, { name: "V" });
    const f = createFile(v.id, { path: "Dump/x/a.md", title: "A", content: "# A" });
    expect(deleteOwnedFile(u.id, f.id)).toBe(true);
    expect(getOwnedFile(u.id, f.id)).toBeUndefined();
    expect(deleteOwnedFile(u.id, f.id)).toBe(false);
  });
});
