// PURE view helpers for DumpModal. No React, no timers, no I/O — unit-tested.
import type { ManifestItem, DumpCounts, DumpStatus } from "./dumpTypes.ts";

export interface ManifestRow {
  itemId: string;
  title: string;
  summary: string;
  tags: string[];
  linkCount: number;
  notePath: string;
  redacted: boolean;
  redactionCount: number;
  badge: "Duplicate" | "Update" | null;
  /** Whether this row starts checked in the review list. */
  defaultSelected: boolean;
  /** Duplicates cannot be committed (already imported, unchanged). */
  disabled: boolean;
}

const BADGE: Record<ManifestItem["status"], "Duplicate" | "Update" | null> = {
  new: null,
  update: "Update",
  duplicate: "Duplicate",
  skipped: null,
};

export function manifestToRows(manifest: ManifestItem[]): ManifestRow[] {
  return manifest.map((m) => ({
    itemId: m.itemId,
    title: m.title,
    summary: m.summary,
    tags: m.tags,
    linkCount: m.linkCount,
    notePath: m.notePath,
    redacted: m.redactionCount > 0,
    redactionCount: m.redactionCount,
    badge: BADGE[m.status],
    defaultSelected: m.status === "new" || m.status === "update",
    disabled: m.status === "duplicate" || m.status === "skipped",
  }));
}

/** Ids a user may select to commit (everything that isn't a hard duplicate/skip). */
export function selectableItemIds(manifest: ManifestItem[]): string[] {
  return manifest.filter((m) => m.status === "new" || m.status === "update").map((m) => m.itemId);
}

const COUNT_ORDER: { key: keyof DumpCounts; label: string }[] = [
  { key: "fetched", label: "fetched" },
  { key: "shaped", label: "shaped" },
  { key: "redacted", label: "redacted" },
  { key: "duplicates", label: "duplicates" },
  { key: "updates", label: "updates" },
  { key: "committed", label: "committed" },
  { key: "failed", label: "failed" },
];

export function countsLabel(counts: DumpCounts): string {
  const parts: string[] = [];
  for (const { key, label } of COUNT_ORDER) {
    const v = counts[key];
    if (typeof v === "number" && v > 0) parts.push(`${v} ${label}`);
  }
  return parts.length ? parts.join(" · ") : "—";
}

const PHASE: Record<DumpStatus, string> = {
  queued: "Queued…",
  fetching: "Fetching…",
  shaping: "Shaping notes…",
  awaiting_review: "Ready to review",
  committing: "Creating notes…",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function phaseLabel(status: DumpStatus): string {
  return PHASE[status];
}
