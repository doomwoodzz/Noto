import {
  getOwnedFile, getSnapshot, getOwnedMemory, retireMemory, reactivateMemory,
  getActiveMemoryByNorm,
  updateFile, deleteFile, sha256Hex, writeAudit,
  type AuditRow, type ActivityRaw,
} from "../db.ts";

export interface ActivityTarget {
  kind: "note" | "memory";
  id: string | null;
  title: string | null;
  path: string | null;
  text: string | null;
  status: string | null;
  exists: boolean;
}
export interface ActivityEntry {
  id: string;
  tool: string;
  createdAt: number;
  client: string | null;
  device: string | null;
  target: ActivityTarget;
  revertible: boolean;
  hasSnapshot: boolean;
}

const NOTE_TOOLS = new Set(["create_note", "append_note", "update_section"]);
const MEMORY_TOOLS = new Set(["remember", "supersede"]);

export function previewRevert(userId: string, audit: AuditRow): { before: string | null; current: string | null } {
  if (NOTE_TOOLS.has(audit.tool) && audit.target) {
    const file = getOwnedFile(userId, audit.target);
    const current = file ? file.content : null;
    const before = audit.tool === "create_note" ? null : getSnapshot(audit.id);
    return { before, current };
  }
  if (MEMORY_TOOLS.has(audit.tool) && audit.target) {
    const mem = getOwnedMemory(userId, audit.target);
    const current = mem ? mem.text : null;
    let before: string | null = null;
    if (audit.tool === "supersede" && mem?.supersedes_id) {
      const old = getOwnedMemory(userId, mem.supersedes_id);
      before = old ? old.text : null;
    }
    return { before, current };
  }
  return { before: null, current: null };
}

export type RevertResult =
  | { status: "reverted" }
  | { status: "conflict"; before: string | null; current: string | null }
  | { status: "not_revertible"; reason: string };

// Ownership precondition: callers MUST pass an `audit` row already verified to
// belong to `userId` (via getOwnedAuditRow). getSnapshot below is keyed by
// audit id only, so this validation is what scopes snapshot/target access.
export function performRevert(userId: string, audit: AuditRow, force: boolean): RevertResult {
  switch (audit.tool) {
    case "create_note": {
      if (!audit.target) return { status: "not_revertible", reason: "no target" };
      const file = getOwnedFile(userId, audit.target);
      if (!file) return { status: "not_revertible", reason: "note already removed" };
      if (!force && audit.after_hash && sha256Hex(file.content) !== audit.after_hash) {
        return { status: "conflict", before: null, current: file.content };
      }
      deleteFile(file.id);
      writeAudit({ userId, tokenId: null, tool: "revert", target: audit.target, sourceClient: "web" });
      return { status: "reverted" };
    }
    case "append_note":
    case "update_section": {
      if (!audit.target) return { status: "not_revertible", reason: "no target" };
      const file = getOwnedFile(userId, audit.target);
      if (!file) return { status: "not_revertible", reason: "note already removed" };
      const before = getSnapshot(audit.id);
      if (before === null) return { status: "not_revertible", reason: "no snapshot (edit predates SP3)" };
      // after_hash is null on pre-Task-2 rows; in that case skip the guard rather
      // than block revert indefinitely (there's no baseline to compare against).
      if (!force && audit.after_hash && sha256Hex(file.content) !== audit.after_hash) {
        return { status: "conflict", before, current: file.content };
      }
      updateFile(file.id, { content: before });
      writeAudit({ userId, tokenId: null, tool: "revert", target: audit.target, sourceClient: "web", beforeHash: sha256Hex(file.content) });
      return { status: "reverted" };
    }
    case "remember": {
      if (!audit.target) return { status: "not_revertible", reason: "no target" };
      const mem = getOwnedMemory(userId, audit.target);
      if (!mem || mem.status !== "active") return { status: "not_revertible", reason: "memory already inactive" };
      retireMemory(userId, audit.target);
      writeAudit({ userId, tokenId: null, tool: "revert", target: audit.target, sourceClient: "web" });
      return { status: "reverted" };
    }
    case "supersede": {
      if (!audit.target) return { status: "not_revertible", reason: "no target" };
      const newer = getOwnedMemory(userId, audit.target);
      if (!newer || newer.status !== "active") return { status: "not_revertible", reason: "correction already undone" };
      // A deduped supersede points at a PRE-EXISTING memory (supersedes_id null):
      // there is no predecessor to restore, and retiring it would delete a fact the
      // user never intended to remove — so refuse rather than mutate wrongly.
      if (!newer.supersedes_id) return { status: "not_revertible", reason: "deduped correction — no predecessor to restore" };
      const older = getOwnedMemory(userId, newer.supersedes_id);
      if (!older) return { status: "not_revertible", reason: "predecessor no longer exists" };
      // Reactivating the predecessor would violate the dedup unique index
      // (UNIQUE(user_id, scope, norm_text) WHERE status='active') if another active
      // memory now occupies that slot (e.g. the same fact was re-remembered after the
      // supersede). Refuse mutation-free rather than half-apply the revert.
      const occupant = getActiveMemoryByNorm(userId, older.scope, older.norm_text);
      if (occupant && occupant.id !== older.id) {
        return { status: "not_revertible", reason: "the predecessor's slot is occupied by a newer memory" };
      }
      // Retire the newer FIRST, then reactivate the old, so the unique index never
      // sees two active rows with the same norm_text.
      retireMemory(userId, newer.id);
      reactivateMemory(userId, newer.supersedes_id);
      writeAudit({ userId, tokenId: null, tool: "revert", target: audit.target, sourceClient: "web" });
      return { status: "reverted" };
    }
    default:
      return { status: "not_revertible", reason: "not a revertible action" };
  }
}

export function toActivityEntry(r: ActivityRaw): ActivityEntry {
  const hasSnapshot = r.has_snapshot === 1;
  const kind: "note" | "memory" = NOTE_TOOLS.has(r.tool)
    ? "note"
    : MEMORY_TOOLS.has(r.tool)
      ? "memory"
      : r.memory_text !== null ? "memory" : "note"; // 'revert' rows: infer kind from the surviving target. Memories are never hard-deleted (soft 'superseded'), so memory_text persists; notes can be deleted → falls to "note", which is correct.
  const exists = kind === "note" ? r.file_title !== null : r.memory_status !== null;
  const target: ActivityTarget = {
    kind,
    id: r.target,
    title: r.file_title,
    path: r.file_path,
    text: r.memory_text,
    status: r.memory_status,
    exists,
  };
  let revertible: boolean;
  switch (r.tool) {
    case "create_note": revertible = exists; break;
    case "append_note":
    case "update_section": revertible = exists && hasSnapshot; break;
    case "remember":
    case "supersede": revertible = exists && r.memory_status === "active"; break;
    default: revertible = false; // 'revert' rows are display-only
  }
  return {
    id: r.id,
    tool: r.tool,
    createdAt: r.created_at,
    client: r.source_client,
    device: r.device,
    target,
    revertible,
    hasSnapshot,
  };
}
