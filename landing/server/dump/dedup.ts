// Dedup / idempotency classification (design §9). Compares an item's content hash
// against the persisted (user_id, vault_id, source_key) row in dump_sources:
//   - no row            → "new"
//   - row, same hash    → "duplicate" (already imported; dedupOf = existing file_id)
//   - row, different hash→ "update"    (re-dump overwrite candidate; dedupOf = file_id)
// Keyed by vault so re-dumping a source into a second vault is "new" there, not a
// cross-vault match against the first vault's note.

import { getDumpSource, sha256Hex } from "../db.ts";

/** sha256 hex of a string (the canonical content identity for dedup). */
export function contentHash(s: string): string {
  return sha256Hex(s);
}

export function classifyItem(
  userId: string,
  vaultId: string,
  sourceKey: string,
  hash: string,
): { status: "new" | "update" | "duplicate"; dedupOf?: string } {
  const existing = getDumpSource(userId, vaultId, sourceKey);
  if (!existing) return { status: "new" };
  if (existing.content_hash === hash) return { status: "duplicate", dedupOf: existing.file_id };
  return { status: "update", dedupOf: existing.file_id };
}
