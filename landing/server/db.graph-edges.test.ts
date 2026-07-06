// landing/server/db.graph-edges.test.ts
import { describe, it, expect } from "vitest";
import {
  createUser, createVault, createFile,
  upsertNoteGraphState, getNoteGraphState, setNoteCommunities,
  replaceFileEdges, getVaultEdges, getStaleGraphVaultIds,
} from "./db.ts";

function freshVault() {
  const u = createUser({ email: `graph-${crypto.randomUUID()}@t.local` });
  const v = createVault(u.id, { name: "V" });
  return { userId: u.id, vaultId: v.id };
}

describe("note_graph_state", () => {
  it("upserts and reads back content hash + well-linked flag", () => {
    const { vaultId } = freshVault();
    const file = createFile(vaultId, { path: "a.md", title: "A", content: "hi" });
    upsertNoteGraphState({ fileId: file.id, vaultId, contentHash: "h1", wellLinked: false });
    expect(getNoteGraphState(file.id)).toMatchObject({ fileId: file.id, contentHash: "h1", wellLinked: false, community: null });
    upsertNoteGraphState({ fileId: file.id, vaultId, contentHash: "h2", wellLinked: true });
    expect(getNoteGraphState(file.id)).toMatchObject({ contentHash: "h2", wellLinked: true });
  });

  it("assigns communities by file id", () => {
    const { vaultId } = freshVault();
    const file = createFile(vaultId, { path: "b.md", title: "B", content: "hi" });
    upsertNoteGraphState({ fileId: file.id, vaultId, contentHash: "h1", wellLinked: false });
    setNoteCommunities(new Map([[file.id, 3]]));
    expect(getNoteGraphState(file.id)?.community).toBe(3);
  });
});

describe("note_edges", () => {
  it("replaces a file's outgoing edges idempotently", () => {
    const { vaultId } = freshVault();
    const a = createFile(vaultId, { path: "a.md", title: "A", content: "hi" });
    const b = createFile(vaultId, { path: "b.md", title: "B", content: "hi" });
    replaceFileEdges(vaultId, a.id, [
      { id: `${a.id}->${b.id}:links_to`, sourceId: a.id, targetId: b.id, relation: "links_to", confidence: "EXTRACTED", confidenceScore: 1 },
    ]);
    expect(getVaultEdges(vaultId)).toHaveLength(1);
    replaceFileEdges(vaultId, a.id, []); // re-run with no edges clears the old ones
    expect(getVaultEdges(vaultId)).toHaveLength(0);
  });
});

describe("getStaleGraphVaultIds", () => {
  it("flags a vault with a file that has no graph state yet", () => {
    const { vaultId } = freshVault();
    createFile(vaultId, { path: "c.md", title: "C", content: "hi" });
    expect(getStaleGraphVaultIds()).toContain(vaultId);
  });
});
