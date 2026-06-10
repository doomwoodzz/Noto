// Faithful port of Sources/NotoCore/Lib/MarkdownParser.swift
import type { ChecklistItem } from "./types";

/** Extract `[[Wiki Link]]` targets in order, trimmed, brackets stripped. */
export function extractWikiLinks(content: string): string[] {
  return matches(/\[\[([^[\]]+)\]\]/g, content)
    .map(normalizeTitle)
    .filter((s) => s.length > 0);
}

/** Extract `# Heading` text (levels 1–6), markers removed, in document order. */
export function extractHeadings(content: string): string[] {
  return splitLines(content)
    .map(headingText)
    .filter((h): h is string => h !== null);
}

/**
 * Extract `#tag` tokens (excluding heading lines), unique, order-preserving.
 * Mirrors the Swift `(?<!\w)#([A-Za-z][A-Za-z0-9_-]*)` pattern.
 */
export function extractTags(content: string): string[] {
  const tags: string[] = [];
  for (const rawLine of splitLines(content)) {
    const text = rawLine.trim();
    if (headingText(text) !== null) continue;
    for (const tag of matches(/(?<!\w)#([A-Za-z][A-Za-z0-9_-]*)/g, text)) {
      if (!tags.includes(tag)) tags.push(tag);
    }
  }
  return tags;
}

/** Word count over the rendered prose (markup stripped). */
export function wordCount(content: string): number {
  let text = content;
  text = text.replace(/\[\[([^[\]]+)\]\]/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^-\s+\[[ xX]\]\s+/gm, "");
  text = text.replace(/^[-*]\s+/gm, "");
  text = text.replace(/#([A-Za-z][A-Za-z0-9_-]*)/g, "");
  return text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0).length;
}

/** Extract `- [ ]` / `- [x]` checklist items. */
export function extractChecklistItems(content: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const rawLine of splitLines(content)) {
    const text = rawLine.trim();
    if (text.startsWith("- [ ] ")) {
      items.push(makeChecklistItem(text.slice(6), false));
    } else if (text.startsWith("- [x] ") || text.startsWith("- [X] ")) {
      items.push(makeChecklistItem(text.slice(6), true));
    }
  }
  return items;
}

export function normalizeTitle(title: string): string {
  return title.trim();
}

export function makeChecklistItem(text: string, isComplete: boolean): ChecklistItem {
  return { id: `${isComplete}-${text}`, text, isComplete };
}

/* ------------------------------- internals ------------------------------ */

// Swift splits on `\.isNewline`, which includes \n, \r, \r\n, and the Unicode
// line/paragraph separators (U+2028/U+2029).
function splitLines(content: string): string[] {
  return content.split(/\r\n|\r|\n/);
}

function headingText(line: string): string | null {
  const text = line.trim();
  let hashCount = 0;
  for (const ch of text) {
    if (ch === "#") hashCount += 1;
    else break;
  }
  if (hashCount < 1 || hashCount > 6) return null;
  const after = text[hashCount];
  if (after === undefined || !/\s/.test(after)) return null;
  const heading = text.slice(hashCount).trim();
  return heading.length === 0 ? null : heading;
}

function matches(regex: RegExp, text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(regex)) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}
