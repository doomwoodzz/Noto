// Real shaping pipeline (design §7–§9, Global Constraints §14/§15). REPLACES the P1 stub.
// fetch (provider) → for each RawItem: split → for each note: redact → clean → classify
// → (dup ? stage 'duplicate' : enrich + build ShapedNote + stage 'shaped'|'update').
// Updates counts as it goes; checks isCancelled between items; ends 'awaiting_review'.
//
// Secret redaction runs FIRST per note (before storage / embedding / LLM). The
// provenance marker is appended later, at COMMIT (P3) — not here.

import {
  setDumpJobStatus, setDumpJobCounts,
  insertDumpItem, listDumpItems, countFilesForVault, MAX_FILES_PER_VAULT,
} from "../db.ts";
import { semanticSearchNotes } from "../search/semantic.ts";
import { getProvider } from "./providers/index.ts";
import { isCancelled } from "./jobs.ts";
import { slugifySource, slugifyTitle } from "./slug.ts";
import { splitIntoNotes } from "./split.ts";
import { redactSecrets } from "./secrets.ts";
import { cleanBody } from "./clean.ts";
import { classifyItem, contentHash } from "./dedup.ts";
import { enrichNote } from "./enrich.ts";
import type {
  DumpJobRow, DumpCounts, FetchCtx, ManifestItem, RawItem, ShapedNote,
} from "./types.ts";

/** Effective per-dump cap (Global Constraints §15): leaves room for the MOC note. */
function computeCap(vaultId: string): number {
  return Math.max(0, Math.min(500, MAX_FILES_PER_VAULT - countFilesForVault(vaultId) - 1));
}

export async function shapeJob(job: DumpJobRow): Promise<void> {
  setDumpJobStatus(job.id, "fetching");

  const counts: DumpCounts = {
    fetched: 0, shaped: 0, redacted: 0, duplicates: 0, updates: 0, overCap: 0, totalAvailable: 0,
  };

  // 1) Fetch RawItems from the provider, capped.
  const cap = computeCap(job.vault_id);
  let sourceRef: unknown = {};
  try {
    sourceRef = JSON.parse(job.source_ref) as unknown;
  } catch { /* leave as {} */ }

  const ctx: FetchCtx = {
    userId: job.user_id,
    sourceRef,
    cap,
    onProgress: (fetched) => {
      counts.fetched = fetched;
      setDumpJobCounts(job.id, counts);
    },
  };

  const provider = getProvider(job.source_type);
  const rawItems: RawItem[] = await provider.fetch(ctx);
  counts.fetched = rawItems.length;
  counts.totalAvailable = rawItems.length;
  setDumpJobCounts(job.id, counts);

  setDumpJobStatus(job.id, "shaping");

  const sourceSlug = slugifySource(job.source_slug);
  const seenHashes = new Set<string>(); // within-this-dump duplicate collapse
  const usedPaths = new Set<string>();  // avoid in-job path collisions before commit

  // 2) Split each RawItem into atomic notes, then shape each note.
  for (const raw of rawItems) {
    if (isCancelled(job.id)) {
      setDumpJobStatus(job.id, "cancelled");
      return;
    }

    for (const note of splitIntoNotes(raw)) {
      if (isCancelled(job.id)) {
        setDumpJobStatus(job.id, "cancelled");
        return;
      }

      // Secret redaction FIRST, then deterministic cleanup.
      const redacted = redactSecrets(note.body);
      const cleaned = cleanBody(redacted.body);
      if (redacted.count > 0) counts.redacted = (counts.redacted ?? 0) + redacted.count;

      const hash = contentHash(cleaned);

      // Within-dump duplicate: identical cleaned content already staged this run.
      if (seenHashes.has(hash)) {
        counts.duplicates = (counts.duplicates ?? 0) + 1;
        insertDumpItem({ jobId: job.id, sourceKey: note.sourceKey, status: "duplicate", redactionCount: redacted.count });
        continue;
      }
      seenHashes.add(hash);

      // Across-dump dedup vs. dump_sources.
      const cls = classifyItem(job.user_id, note.sourceKey, hash);
      if (cls.status === "duplicate") {
        counts.duplicates = (counts.duplicates ?? 0) + 1;
        insertDumpItem({
          jobId: job.id, sourceKey: note.sourceKey, status: "duplicate",
          redactionCount: redacted.count, dedupOf: cls.dedupOf,
        });
        continue;
      }

      // Link candidates: semantic neighbours ∪ sibling-dump titles in THIS job.
      const neighbours = await semanticSearchNotes(job.user_id, `${note.title}\n${cleaned.slice(0, 400)}`, 10);
      const siblingTitles = currentJobTitles(job.id, note.sourceKey);
      const candidateTitles = uniqueTitles([...neighbours.map((n) => n.title), ...siblingTitles]);

      const enriched = await enrichNote({
        userId: job.user_id,
        vaultId: job.vault_id,
        title: note.title,
        body: cleaned,
        candidateTitles,
      });

      // Target path: Dump/<sourceSlug>/<titleSlug>.md, de-collided within this job.
      const notePath = uniquePath(sourceSlug, enriched.title, usedPaths);
      usedPaths.add(notePath);

      const shaped: ShapedNote = {
        notePath,
        title: enriched.title,
        summary: enriched.summary,
        tags: enriched.tags,
        links: enriched.links,
        body: cleaned, // cleaned + redacted; NO provenance marker yet (added at commit)
        origin: raw.origin,
      };

      const status = cls.status === "update" ? "update" : "shaped";
      insertDumpItem({
        jobId: job.id, sourceKey: note.sourceKey, status,
        shaped: JSON.stringify(shaped), redactionCount: redacted.count,
        dedupOf: cls.dedupOf ?? null,
      });
      if (cls.status === "update") counts.updates = (counts.updates ?? 0) + 1;
      counts.shaped = (counts.shaped ?? 0) + 1;
      setDumpJobCounts(job.id, counts);
    }
  }

  setDumpJobCounts(job.id, counts);
  setDumpJobStatus(job.id, "awaiting_review");
}

/** Titles of notes already staged (shaped) in this job — sibling link candidates. */
function currentJobTitles(jobId: string, exceptSourceKey: string): string[] {
  const out: string[] = [];
  for (const i of listDumpItems(jobId)) {
    if (i.source_key === exceptSourceKey || !i.shaped) continue;
    try {
      const s = JSON.parse(i.shaped) as ShapedNote;
      if (s.title) out.push(s.title);
    } catch { /* skip */ }
  }
  return out;
}

function uniqueTitles(titles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of titles) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Build a Dump-relative note path, suffixing " (2)", " (3)" … on in-job collisions. */
function uniquePath(sourceSlug: string, title: string, used: Set<string>): string {
  const base = slugifyTitle(title);
  let candidate = `Dump/${sourceSlug}/${base}.md`;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `Dump/${sourceSlug}/${base} (${n}).md`;
    n += 1;
  }
  return candidate;
}

/**
 * Build the manifest the client renders for approval. Maps each dump_item:
 *   shaped → "new", update → "update", duplicate → "duplicate", skipped → "skipped".
 */
export function buildManifest(jobId: string): ManifestItem[] {
  return listDumpItems(jobId).map((i) => {
    let title = "";
    let summary = "";
    let tags: string[] = [];
    let linkCount = 0;
    let notePath = "";
    if (i.shaped) {
      try {
        const s = JSON.parse(i.shaped) as ShapedNote;
        title = s.title ?? "";
        summary = s.summary ?? "";
        tags = Array.isArray(s.tags) ? s.tags : [];
        linkCount = Array.isArray(s.links) ? s.links.length : 0;
        notePath = s.notePath ?? "";
      } catch { /* leave defaults */ }
    }
    const status: ManifestItem["status"] =
      i.status === "update" ? "update" :
      i.status === "duplicate" ? "duplicate" :
      i.status === "skipped" ? "skipped" : "new";
    const out: ManifestItem = {
      itemId: i.id, title, summary, tags, linkCount, notePath,
      redactionCount: i.redaction_count, status,
    };
    if (i.dedup_of) out.dedupOf = i.dedup_of;
    return out;
  });
}
