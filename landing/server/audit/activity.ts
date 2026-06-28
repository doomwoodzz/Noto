import { getOwnedFile, getSnapshot, getOwnedMemory, type AuditRow, type ActivityRaw } from "../db.ts";

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

export function toActivityEntry(r: ActivityRaw): ActivityEntry {
  const hasSnapshot = r.has_snapshot === 1;
  const kind: "note" | "memory" = NOTE_TOOLS.has(r.tool)
    ? "note"
    : MEMORY_TOOLS.has(r.tool)
      ? "memory"
      : r.memory_text !== null ? "memory" : "note"; // 'revert' rows: infer from the surviving target
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
