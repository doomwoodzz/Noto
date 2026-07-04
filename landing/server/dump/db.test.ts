import { describe, it, expect } from "vitest";
import { db } from "../db.ts";
import {
  createDumpJob, getOwnedDumpJob, setDumpJobStatus, setDumpJobCounts,
  insertDumpItem, listDumpItems, updateDumpItem,
  getDumpSource, upsertDumpSource,
  saveConnectorToken, getConnectorToken, listConnectors, deleteConnector,
  createUser, createVault, createFile,
} from "../db.ts";

describe("dump migrations", () => {
  it("creates the four dump tables", () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toContain("dump_jobs");
    expect(names).toContain("dump_items");
    expect(names).toContain("dump_sources");
    expect(names).toContain("connector_tokens");
  });
});

describe("dump accessors", () => {
  function freshUserVault() {
    const u = createUser({ email: `dump-${crypto.randomUUID()}@t.local` });
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

  it("upserts + reads a dump_source by (user, key)", () => {
    const { userId, vaultId } = freshUserVault();
    // dump_sources.file_id has a real FK to files(id) (foreign_keys=ON), so use a real file.
    const file = createFile(vaultId, { path: "Dump/p/x.md", title: "X", content: "body" });
    upsertDumpSource({ userId, sourceKey: "raw:k", fileId: file.id, contentHash: "h1", jobId: "j1" });
    expect(getDumpSource(userId, "raw:k")?.content_hash).toBe("h1");
    upsertDumpSource({ userId, sourceKey: "raw:k", fileId: file.id, contentHash: "h2", jobId: "j2" });
    expect(getDumpSource(userId, "raw:k")?.content_hash).toBe("h2");
  });

  it("saves + reads + deletes a connector token", () => {
    const { userId } = freshUserVault();
    saveConnectorToken({ userId, provider: "github", externalAccount: "octocat", installationId: "42", accessTokenCipher: null, scopes: "contents:read" });
    expect(getConnectorToken(userId, "github")?.external_account).toBe("octocat");
    expect(listConnectors(userId).map((c) => c.provider)).toContain("github");
    deleteConnector(userId, "github");
    expect(getConnectorToken(userId, "github")).toBeUndefined();
  });
});
