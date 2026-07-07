// landing/server/db.graph-edges.test.ts
import { describe, it, expect } from "vitest";
import {
  db,
  ensureLocalOwner, createVault, createFile, getFilesForVault,
  upsertNoteGraphState, getNoteGraphState, setNoteCommunities,
  replaceFileEdges, getVaultEdges, getStaleGraphVaultIds,
  deleteFile, deleteFileEdges,
} from "./db.ts";

// There is one local owner (see ensureLocalOwner in db.ts); each freshVault()
// call gives that same owner a new, independent vault to isolate this test's
// data, which is all these tests ever needed — none compares two users.
function freshVault() {
  const u = ensureLocalOwner();
  const v = createVault(u.id, { name: "V" });
  return { userId: u.id, vaultId: v.id };
}

/** Give every current file in the vault up-to-date graph state, so the vault is
 *  NOT flagged by the missing/stale-graph-state conditions (isolates other causes). */
function markVaultGraphFresh(vaultId: string) {
  for (const f of getFilesForVault(vaultId)) {
    upsertNoteGraphState({ fileId: f.id, vaultId, contentHash: "h", wellLinked: false });
  }
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

describe("deleteFileEdges", () => {
  it("clears edges where the file is the source AND where it is the target", () => {
    const { vaultId } = freshVault();
    const a = createFile(vaultId, { path: "a.md", title: "A", content: "hi" });
    const b = createFile(vaultId, { path: "b.md", title: "B", content: "hi" });
    // a -> b (a is source), b -> a (a is target)
    replaceFileEdges(vaultId, a.id, [
      { id: `${a.id}->${b.id}:links_to`, sourceId: a.id, targetId: b.id, relation: "links_to", confidence: "EXTRACTED", confidenceScore: 1 },
    ]);
    replaceFileEdges(vaultId, b.id, [
      { id: `${b.id}->${a.id}:links_to`, sourceId: b.id, targetId: a.id, relation: "links_to", confidence: "EXTRACTED", confidenceScore: 1 },
    ]);
    expect(getVaultEdges(vaultId)).toHaveLength(2);
    deleteFileEdges(a.id);
    // both the a-sourced edge and the a-targeted edge are gone
    expect(getVaultEdges(vaultId)).toHaveLength(0);
  });
});

describe("deleteFile self-heals the graph", () => {
  it("removes dangling edges pointing at a deleted note (source or target)", () => {
    const { vaultId } = freshVault();
    const a = createFile(vaultId, { path: "a.md", title: "A", content: "hi" });
    const b = createFile(vaultId, { path: "b.md", title: "B", content: "hi" });
    replaceFileEdges(vaultId, a.id, [
      { id: `${a.id}->${b.id}:links_to`, sourceId: a.id, targetId: b.id, relation: "links_to", confidence: "EXTRACTED", confidenceScore: 1 },
    ]);
    replaceFileEdges(vaultId, b.id, [
      { id: `${b.id}->${a.id}:links_to`, sourceId: b.id, targetId: a.id, relation: "links_to", confidence: "EXTRACTED", confidenceScore: 1 },
    ]);
    deleteFile(a.id);
    // no edge references the deleted note as source or target
    expect(getVaultEdges(vaultId).some((e) => e.sourceId === a.id || e.targetId === a.id)).toBe(false);
  });
});

describe("getStaleGraphVaultIds", () => {
  it("flags a vault with a file that has no graph state yet", () => {
    const { vaultId } = freshVault();
    createFile(vaultId, { path: "c.md", title: "C", content: "hi" });
    expect(getStaleGraphVaultIds()).toContain(vaultId);
  });

  it("flags a vault whose edges reference a note that no longer exists", () => {
    const { vaultId } = freshVault();
    const a = createFile(vaultId, { path: "d.md", title: "D", content: "hi" });
    const b = createFile(vaultId, { path: "e.md", title: "E", content: "hi" });
    // b -> a is a neighbor's links_to edge; if `a` vanishes it dangles (no FK cascade).
    replaceFileEdges(vaultId, b.id, [
      { id: `${b.id}->${a.id}:links_to`, sourceId: b.id, targetId: a.id, relation: "links_to", confidence: "EXTRACTED", confidenceScore: 1 },
    ]);
    // Give EVERY file (incl. the seeded Welcome note) up-to-date graph state so the
    // vault is NOT flagged by the missing/stale-graph-state condition.
    markVaultGraphFresh(vaultId);
    expect(getStaleGraphVaultIds()).not.toContain(vaultId);
    // Mimic a stale DB / older deletion path that removed the file row but left the
    // edge behind: drop `a`'s file row directly (bypassing deleteFile's self-heal).
    // note_graph_state cascades via FK; note_edges does not — so b->a now dangles.
    db.prepare("DELETE FROM files WHERE id = ?").run(a.id);
    expect(getStaleGraphVaultIds()).toContain(vaultId);
  });
});
