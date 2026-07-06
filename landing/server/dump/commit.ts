// Real committer — replaces the P1 stub. Materializes selected dump_items into
// files under Dump/<sourceSlug>/, resolves <=5 [[wiki-links]] (two-pass against
// existing + sibling-dump titles), builds/updates the per-source MOC index,
// embeds each note (reembedNote, off the request thread), and audits every write
// (dump:create / dump:update). Mirrors server/notes/routes.ts create/update logic
// (Global Constraints §5). Ownership-scoped throughout; idempotent on re-dump (§9).
import {
  db,
  createFile,
  updateFile,
  getOwnedFile,
  getVaultsForUser,
  countFilesForVault,
  pathTaken,
  writeAudit,
  writeSnapshot,
  sha256Hex,
  setDumpJobStatus,
  setDumpJobCounts,
  listDumpItems,
  updateDumpItem,
  getDumpSource,
  upsertDumpSource,
  MAX_FILES_PER_VAULT,
} from "../db.ts";
import { reembedNote } from "../search/embedNote.ts";
import { rebuildVaultGraph } from "../graph/build.ts";
import { normalizeTitle } from "../../src/noto-core/parser.ts";
import { slugifyTitle } from "./slug.ts";
import { assembleNoteBody, buildMocBody, mocMembers } from "./assemble.ts";
import { isCancelled } from "./jobs.ts";
import type { DumpJobRow, DumpItemRow, ShapedNote, DumpCounts } from "./types.ts";

/** All existing note titles in a vault (lower-cased → canonical) for link resolution. */
function vaultTitleIndex(vaultId: string): Map<string, string> {
  const rows = db.prepare("SELECT title FROM files WHERE vault_id = ?").all(vaultId) as { title: string }[];
  const idx = new Map<string, string>();
  for (const r of rows) {
    const t = normalizeTitle(r.title);
    if (t) idx.set(t.toLowerCase(), t);
  }
  return idx;
}

/** Final unique vault-relative note path under Dump/<slug>/, deduped via pathTaken. */
function uniqueNotePath(vaultId: string, sourceSlug: string, title: string): string {
  const base = slugifyTitle(title);
  let candidate = `Dump/${sourceSlug}/${base}.md`;
  let n = 2;
  while (pathTaken(vaultId, candidate)) {
    candidate = `Dump/${sourceSlug}/${base} (${n}).md`;
    n += 1;
  }
  return candidate;
}

function parseShaped(item: DumpItemRow): ShapedNote | null {
  if (!item.shaped) return null;
  try {
    return JSON.parse(item.shaped) as ShapedNote;
  } catch {
    return null;
  }
}

/** Create one new note: file → audit(dump:create) → dump_sources → mark committed → embed. */
// DB writes are contiguous (no await between file write and dump_sources) so a crash can't
// orphan a file without its dump_sources row; reembedNote is best-effort and runs last.
async function commitNew(
  userId: string,
  vaultId: string,
  item: DumpItemRow,
  shaped: ShapedNote,
  links: string[],
  notePath: string,
  dumpedAt: number,
  jobId: string,
): Promise<{ fileId: string; title: string }> {
  const content = assembleNoteBody(shaped, links, dumpedAt);
  const file = createFile(vaultId, { path: notePath, title: shaped.title, content });
  writeAudit({
    userId,
    tokenId: null,
    tool: "dump:create",
    target: file.id,
    beforeHash: null,
    afterHash: sha256Hex(content),
    sourceClient: "web",
  });
  // dump_sources.content_hash MUST be the CLEANED-BODY hash (sha256Hex(shaped.body)),
  // NOT the assembled note hash: shaping's classifyItem compares against
  // contentHash(cleaned) = sha256Hex(shaped.body), and the assembled note embeds a
  // per-dump `dumpedAt` timestamp in its provenance marker (so its hash changes every
  // dump). Storing the assembled hash would make identical re-dumps misclassify as
  // "update" instead of "duplicate", breaking idempotency (design §9 / decision D6).
  upsertDumpSource({ userId, vaultId, sourceKey: item.source_key, fileId: file.id, contentHash: sha256Hex(shaped.body), jobId });
  updateDumpItem(item.id, { status: "committed", file_id: file.id });
  await reembedNote(file.id, content);
  return { fileId: file.id, title: shaped.title };
}

/** Overwrite an existing note (re-dump update): snapshot → audit(dump:update) → updateFile → dump_sources → mark committed → embed. */
// DB writes are contiguous (no await between file write and dump_sources) so a crash can't
// orphan a file without its dump_sources row; reembedNote is best-effort and runs last.
async function commitUpdate(
  userId: string,
  vaultId: string,
  item: DumpItemRow,
  shaped: ShapedNote,
  links: string[],
  dumpedAt: number,
  jobId: string,
): Promise<{ fileId: string; title: string } | null> {
  const old = item.dedup_of ? getOwnedFile(userId, item.dedup_of) : undefined;
  if (!old) {
    updateDumpItem(item.id, { status: "failed", error: "Target note for update no longer exists" });
    return null;
  }
  // Defense in depth: getOwnedFile is user-scoped only, so never overwrite a note
  // that lives in a different vault than the one this job targets. Vault-scoped
  // dedup already guarantees this, but a bad dedup_of must fail the item, not clobber.
  if (old.vault_id !== vaultId) {
    updateDumpItem(item.id, { status: "failed", error: "Update target is in a different vault" });
    return null;
  }
  const content = assembleNoteBody(shaped, links, dumpedAt);
  const auditId = writeAudit({
    userId,
    tokenId: null,
    tool: "dump:update",
    target: old.id,
    beforeHash: sha256Hex(old.content),
    afterHash: sha256Hex(content),
    sourceClient: "web",
  });
  writeSnapshot(auditId, old.content); // BEFORE updateFile (Global Constraints §5)
  updateFile(old.id, { content });
  // Store the CLEANED-BODY hash so a subsequent identical re-dump classifies as
  // "duplicate" (see commitNew for the full rationale — the assembled hash would
  // drift every dump via the provenance dumpedAt stamp).
  upsertDumpSource({ userId, vaultId, sourceKey: item.source_key, fileId: old.id, contentHash: sha256Hex(shaped.body), jobId });
  updateDumpItem(item.id, { status: "committed", file_id: old.id });
  await reembedNote(old.id, content);
  return { fileId: old.id, title: shaped.title };
}

/**
 * Build or update the per-source MOC index note.
 * - source_key = `<sourceType>:<sourceId>:__index__` (Global Constraints §15).
 * - members = committed titles this job ∪ existing members from the old MOC.
 * - Rewritten ONLY when membership changed (design spec §9); created if absent.
 */
async function commitMoc(
  userId: string,
  vaultId: string,
  job: DumpJobRow,
  committedTitles: string[],
  updatedAt: number,
): Promise<void> {
  const sourceId = mocSourceId(job);
  const mocKey = `${job.source_type}:${sourceId}:__index__`;
  const existing = getDumpSource(userId, vaultId, mocKey);
  const sourceLabel = job.source_slug;

  if (existing) {
    const old = getOwnedFile(userId, existing.file_id);
    if (old) {
      const prior = mocMembers(old.content);
      const merged = dedupeOrdered([...prior, ...committedTitles]);
      if (sameMembership(prior, merged)) return; // no-op churn guard (design spec §9)
      const content = buildMocBody(sourceLabel, merged, updatedAt);
      const auditId = writeAudit({
        userId,
        tokenId: null,
        tool: "dump:update",
        target: old.id,
        beforeHash: sha256Hex(old.content),
        afterHash: sha256Hex(content),
        sourceClient: "web",
      });
      writeSnapshot(auditId, old.content);
      updateFile(old.id, { content });
      await reembedNote(old.id, content);
      // MOC is not classified via classifyItem, so its content_hash tracks the actual
      // note content (sha256Hex(content)) rather than a cleaned body.
      upsertDumpSource({ userId, vaultId, sourceKey: mocKey, fileId: old.id, contentHash: sha256Hex(content), jobId: job.id });
      return;
    }
    // Mapped file vanished — fall through and recreate.
  }

  if (committedTitles.length === 0) return; // nothing to index
  const members = dedupeOrdered(committedTitles);
  const content = buildMocBody(sourceLabel, members, updatedAt);
  const path = uniqueNotePath(vaultId, job.source_slug, `${job.source_slug} — Index`);
  const file = createFile(vaultId, { path, title: `${job.source_slug} — Index`, content });
  writeAudit({
    userId,
    tokenId: null,
    tool: "dump:create",
    target: file.id,
    beforeHash: null,
    afterHash: sha256Hex(content),
    sourceClient: "web",
  });
  // dump_sources write stays contiguous with the file/audit writes (reembed last),
  // matching commitNew/commitUpdate — a crash can't leave the MOC file without its
  // dump_sources row.
  upsertDumpSource({ userId, vaultId, sourceKey: mocKey, fileId: file.id, contentHash: sha256Hex(content), jobId: job.id });
  await reembedNote(file.id, content);
}

/** Stable per-source id for the MOC key. raw has no persistent source identity → scope to the job. */
function mocSourceId(job: DumpJobRow): string {
  if (job.source_type === "raw") return job.id;
  try {
    const ref = JSON.parse(job.source_ref) as { repo?: string };
    if (job.source_type === "github" && ref.repo) return ref.repo;
    // notion: sourceRef carries no workspace id, so notion MOCs are currently keyed by
    // the (constant) source_slug → one per-user "Notion Import" hub. Revisit granularity in P5.
  } catch {
    /* fall through */
  }
  return job.source_slug;
}

function dedupeOrdered(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of items) {
    if (x && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function sameMembership(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

/**
 * Resolve a shaped note's candidate links to real titles. A candidate resolves
 * only if it matches an EXISTING vault title OR a SIBLING-dump title (a title
 * being created in THIS job). Case-insensitive match → canonical casing.
 * Capped at 5 (design spec §8); a note never links to itself.
 */
function resolveLinks(
  shaped: ShapedNote,
  selfTitle: string,
  existing: Map<string, string>,
  siblings: Map<string, string>,
): string[] {
  const out: string[] = [];
  const used = new Set<string>([normalizeTitle(selfTitle).toLowerCase()]);
  for (const raw of shaped.links) {
    const key = normalizeTitle(raw).toLowerCase();
    if (!key || used.has(key)) continue;
    const canonical = siblings.get(key) ?? existing.get(key);
    if (canonical) {
      out.push(canonical);
      used.add(key);
      if (out.length >= 5) break;
    }
  }
  return out;
}

export async function commitJob(job: DumpJobRow): Promise<void> {
  const userId = job.user_id;

  // Resolve the vault: prefer the job's vault, fall back to the user's first.
  const vaults = getVaultsForUser(userId);
  const vaultId = vaults.some((v) => v.id === job.vault_id) ? job.vault_id : vaults[0]?.id;
  if (!vaultId) {
    setDumpJobStatus(job.id, "failed", "No vault to commit into");
    return;
  }

  // Gather user-approved items (status 'selected'; P2 also uses 'update' for the
  // re-dump-overwrite variant that the user selected).
  const selected = listDumpItems(job.id).filter((i) => i.status === "selected" || i.status === "update");
  const parsed = selected
    .map((item) => ({ item, shaped: parseShaped(item) }))
    .filter((x): x is { item: DumpItemRow; shaped: ShapedNote } => x.shaped !== null);

  // PASS 1 — compute the sibling-title set (titles created in THIS job) ∪ existing
  // vault titles, so PASS 2 can resolve cross-references deterministically.
  const existing = vaultTitleIndex(vaultId);
  const siblings = new Map<string, string>();
  for (const { shaped } of parsed) {
    const t = normalizeTitle(shaped.title);
    if (t) siblings.set(t.toLowerCase(), t);
  }

  const dumpedAt = Date.now();
  const committedTitles: string[] = [];
  let committed = 0;
  let failed = 0;

  // PASS 2 — materialize each note (new or update), resolving links against
  // existing ∪ sibling titles.
  for (const { item, shaped } of parsed) {
    if (isCancelled(job.id)) {
      setDumpJobStatus(job.id, "cancelled");
      return;
    }
    try {
      const isUpdate = item.dedup_of !== null;
      if (!isUpdate && countFilesForVault(vaultId) >= MAX_FILES_PER_VAULT) {
        updateDumpItem(item.id, { status: "failed", error: "This vault is full." });
        failed += 1;
        continue;
      }
      const links = resolveLinks(shaped, shaped.title, existing, siblings);
      let result: { fileId: string; title: string } | null;
      if (isUpdate) {
        result = await commitUpdate(userId, vaultId, item, shaped, links, dumpedAt, job.id);
      } else {
        const notePath = uniqueNotePath(vaultId, job.source_slug, shaped.title);
        result = await commitNew(userId, vaultId, item, shaped, links, notePath, dumpedAt, job.id);
      }
      if (result) {
        committed += 1;
        committedTitles.push(result.title);
        // A freshly-created note becomes a valid existing-title target for later
        // notes in the same pass (keeps resolution + path dedupe consistent).
        // Key by the SAME normalization vaultTitleIndex/resolveLinks use so a title
        // carrying surrounding whitespace can't diverge from the resolution index.
        const canon = normalizeTitle(result.title);
        if (canon) existing.set(canon.toLowerCase(), canon);
      } else {
        failed += 1;
      }
    } catch (err) {
      updateDumpItem(item.id, { status: "failed", error: err instanceof Error ? err.message : String(err) });
      failed += 1;
    }
  }

  // MOC — built/updated after notes (so all members exist). Best-effort; a MOC
  // failure must not fail the whole commit.
  if (!isCancelled(job.id)) {
    try {
      await commitMoc(userId, vaultId, job, committedTitles, dumpedAt);
    } catch (err) {
      console.warn("[dump] MOC build failed:", err);
    }
  }

  // Rebuild the vault graph ONCE for the whole batch — not per item. rebuildVaultGraph
  // scans the entire vault (metadata cache + all edges + clustering) every call and is
  // content-hash-cached per note, so a single post-batch pass covers every note this
  // job created/updated plus the MOC, at O(vaultSize) instead of O(N_items × vaultSize).
  // The graph is only read after the job completes, so nothing needs it mid-loop.
  // rebuildVaultGraph never throws (best-effort), so no guard is needed.
  if (committed > 0) await rebuildVaultGraph(vaultId);

  const counts = mergeCounts(job, { committed, failed });
  setDumpJobCounts(job.id, counts);
  setDumpJobStatus(job.id, "done");
}

/** Preserve the counts the shaping phase set; overlay commit results. */
function mergeCounts(job: DumpJobRow, extra: Partial<DumpCounts>): DumpCounts {
  let prior: DumpCounts = {};
  try {
    prior = JSON.parse(job.counts) as DumpCounts;
  } catch {
    /* default {} */
  }
  return { ...prior, ...extra };
}
