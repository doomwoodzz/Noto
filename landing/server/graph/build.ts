// landing/server/graph/build.ts
import {
  getFilesForVault, getNoteGraphState, upsertNoteGraphState, replaceFileEdges,
  getVaultEdges, setNoteCommunities, getStaleGraphVaultIds, pruneDanglingVaultEdges, sha256Hex,
  type PublicFile,
} from "../db.ts";
import { buildMetadataCache } from "../../src/noto-core/metadata.ts";
import { buildStructuralEdges, isWellLinked, type PersistedEdge } from "../../src/noto-core/graphEdges.ts";
import { computeSemanticEdges } from "./similarity.ts";
import { assignCommunities } from "./cluster.ts";

export interface RebuildResult {
  filesProcessed: number;
  edgeCount: number;
}

/**
 * Recompute the graph for one vault: skip notes whose content hasn't changed
 * since the last build (content-hash cache), extract structural edges for the
 * rest, add semantic edges only for under-linked notes, then re-cluster.
 * Never throws — best-effort, mirrors reembedNote/backfillEmbeddings.
 */
export async function rebuildVaultGraph(vaultId: string): Promise<RebuildResult> {
  try {
    return await rebuildVaultGraphInner(vaultId);
  } catch (err) {
    console.warn("[graph] rebuildVaultGraph failed:", err);
    return { filesProcessed: 0, edgeCount: 0 };
  }
}

async function rebuildVaultGraphInner(vaultId: string): Promise<RebuildResult> {
  const files: PublicFile[] = getFilesForVault(vaultId);
  const cache = buildMetadataCache(files);

  const changed = files.filter((f) => getNoteGraphState(f.id)?.contentHash !== sha256Hex(f.content));
  const structuralByFile = new Map<string, PersistedEdge[]>();
  const underLinked: { fileId: string; content: string }[] = [];

  for (const file of changed) {
    const meta = cache.filesById[file.id];
    const wellLinked = meta !== undefined && isWellLinked(meta);
    structuralByFile.set(file.id, buildStructuralEdges(file, cache));
    upsertNoteGraphState({ fileId: file.id, vaultId, contentHash: sha256Hex(file.content), wellLinked });
    if (!wellLinked) underLinked.push({ fileId: file.id, content: file.content });
  }

  const semanticByFile = new Map<string, PersistedEdge[]>();
  if (underLinked.length > 0) {
    for (const e of await computeSemanticEdges(vaultId, underLinked)) {
      const list = semanticByFile.get(e.sourceId);
      if (list) list.push(e);
      else semanticByFile.set(e.sourceId, [e]);
    }
  }

  for (const file of changed) {
    const structural = structuralByFile.get(file.id) ?? [];
    const semantic = semanticByFile.get(file.id) ?? [];
    replaceFileEdges(vaultId, file.id, [...structural, ...semantic]);
  }

  // Clear edges left dangling by a deletion (a neighbor's inbound links_to edge
  // to a now-gone note). Deleting a note bumps no surviving file's updated_at, so
  // the changed-files pass above never touches those — prune them here so a
  // stale-flagged rebuild actually converges.
  pruneDanglingVaultEdges(vaultId);

  const allEdges = getVaultEdges(vaultId);
  setNoteCommunities(assignCommunities(files.map((f) => f.id), allEdges));

  return { filesProcessed: changed.length, edgeCount: allEdges.length };
}

/** Boot-time backfill: rebuild every vault whose graph is missing or stale. Mirrors backfillEmbeddings. */
export async function rebuildStaleVaultGraphs(): Promise<void> {
  for (const vaultId of getStaleGraphVaultIds()) {
    await rebuildVaultGraph(vaultId);
  }
}
