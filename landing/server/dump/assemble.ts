// Pure, deterministic assemblers for Dump note bodies + per-source MOC index.
// NO Date.now()/Math.random() — timestamps are passed in (Global Constraints §1).
// Note-body shape: design spec §7 ("Assembled note"). MOC shape: §8.
import type { ShapedNote } from "./types.ts";
import { buildProvenanceMarker } from "../../src/noto-core/provenance.ts";
import { extractWikiLinks } from "../../src/noto-core/parser.ts";

/**
 * Assemble the final note body for a shaped item.
 *
 *   # <title>
 *
 *   > <summary>                 ← only when summary is non-empty
 *
 *   <verbatim cleaned body>
 *
 *   ## Related                  ← only when `links` is non-empty
 *   - [[L1]]
 *   - [[L2]]
 *
 *   <provenance marker>         ← always (last structural element)
 *   #tag1 #tag2                 ← only when tags is non-empty
 *
 * `links` is the ALREADY-RESOLVED title list (resolution is two-pass, done in
 * commit.ts) — NOT `shaped.links`. The marker is built from `shaped.origin`.
 */
export function assembleNoteBody(shaped: ShapedNote, links: string[], dumpedAt: number): string {
  const blocks: string[] = [`# ${shaped.title}`];
  const summary = shaped.summary.trim();
  if (summary) blocks.push(`> ${summary}`);
  blocks.push(shaped.body.trim());
  if (links.length > 0) {
    blocks.push(["## Related", ...links.map((l) => `- [[${l}]]`)].join("\n"));
  }
  const tail: string[] = [buildProvenanceMarker(shaped.origin, dumpedAt)];
  if (shaped.tags.length > 0) {
    tail.push(shaped.tags.map((t) => `#${t}`).join(" "));
  }
  // The marker + optional tag line form the final block, so the marker stays
  // within the last 4 lines that parseProvenanceMarker scans.
  blocks.push(tail.join("\n"));
  return blocks.join("\n\n") + "\n";
}

/**
 * Build the per-source MOC "index" note body. `updatedAt` is passed in (no
 * Date.now). Member titles render as `[[links]]`; the stamp is rendered from
 * the supplied epoch-ms so the function stays pure/deterministic.
 */
export function buildMocBody(sourceLabel: string, memberTitles: string[], updatedAt: number): string {
  const stamp = new Date(updatedAt).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
  const header =
    `# ${sourceLabel} — Index\n\n` +
    `> Source index · ${memberTitles.length} notes · Last updated ${stamp}`;
  const list = memberTitles.map((t) => `- [[${t}]]`).join("\n");
  return list ? `${header}\n\n${list}\n` : `${header}\n`;
}

/** Parse the `[[links]]` membership out of an existing MOC body (deduped, ordered). */
export function mocMembers(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const title of extractWikiLinks(body)) {
    if (!seen.has(title)) {
      seen.add(title);
      out.push(title);
    }
  }
  return out;
}
