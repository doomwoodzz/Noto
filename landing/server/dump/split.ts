// Deterministic boundary split (design §7). One source unit → one note, UNLESS the
// body has multiple top-level markdown sections AND is large — then split at heading
// boundaries (one note per section). Never splits mid-paragraph. Pure + offline.

import type { RawItem } from "./types.ts";

// Split only oversized multi-section docs. ~MAX keeps each note well under the 256 KB
// note cap while avoiding needless fragmentation of ordinary docs.
const SPLIT_THRESHOLD_CHARS = 6_000;

interface HeadingLine { level: number; text: string; lineIndex: number }

/** Parse a markdown ATX heading (mirrors chunk.ts parseHeading; `#`×1–6 + space + text). */
function parseHeading(line: string): { level: number; text: string } | null {
  const t = line.trim();
  let n = 0;
  for (const ch of t) {
    if (ch === "#") n += 1;
    else break;
  }
  if (n < 1 || n > 6) return null;
  const after = t[n];
  if (after === undefined || !/\s/.test(after)) return null;
  const text = t.slice(n).trim();
  return text ? { level: n, text } : null;
}

export function splitIntoNotes(item: RawItem): { title: string; body: string; sourceKey: string }[] {
  const lines = item.body.split(/\r\n|\r|\n/);

  const headings: HeadingLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = parseHeading(lines[i]);
    if (h) headings.push({ level: h.level, text: h.text, lineIndex: i });
  }

  // The "top level" is the shallowest heading depth present (e.g. all-## → 2).
  const topLevel = headings.length ? Math.min(...headings.map((h) => h.level)) : Infinity;
  const topHeadings = headings.filter((h) => h.level === topLevel);

  const shouldSplit = topHeadings.length >= 2 && item.body.length > SPLIT_THRESHOLD_CHARS;
  if (!shouldSplit) {
    return [{ title: item.title, body: item.body, sourceKey: item.sourceKey }];
  }

  // Cut points: the start line of each top-level heading. Any content before the
  // first top-level heading rides along with the first section.
  const cuts = topHeadings.map((h) => h.lineIndex);
  const sections: { title: string; lineStart: number; lineEnd: number }[] = [];
  for (let s = 0; s < cuts.length; s++) {
    const start = s === 0 ? 0 : cuts[s];
    const end = s + 1 < cuts.length ? cuts[s + 1] : lines.length;
    sections.push({ title: topHeadings[s].text, lineStart: start, lineEnd: end });
  }

  return sections.map((sec, n) => ({
    title: sec.title,
    body: lines.slice(sec.lineStart, sec.lineEnd).join("\n").replace(/\s+$/, ""),
    sourceKey: `${item.sourceKey}#${n}`,
  }));
}
