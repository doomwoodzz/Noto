// server/notes/sections.ts
// Pure heading/section addressing over Markdown. A "section" is a heading line
// plus everything until the next heading of the same or higher level (so a
// section includes its deeper subsections). Heading paths are "A/B/C" using the
// enclosing-heading trail, matching how the UI labels passages.

interface Heading { level: number; text: string; line: number; }

export interface HeadingInfo { level: number; text: string; path: string; }

function parseHeading(line: string): { level: number; text: string } | null {
  const t = line.trimStart();
  let n = 0;
  while (t[n] === "#") n += 1;
  if (n < 1 || n > 6) return null;
  if (!/\s/.test(t[n] ?? "")) return null;
  const text = t.slice(n).trim();
  return text ? { level: n, text } : null;
}

function scanHeadings(lines: string[]): Heading[] {
  const out: Heading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = parseHeading(lines[i]);
    if (h) out.push({ level: h.level, text: h.text, line: i });
  }
  return out;
}

/** Build the "A/B/C" path for the heading at index `idx` within `headings`. */
function pathFor(headings: Heading[], idx: number): string {
  const trail: string[] = [];
  // Start by adding the heading itself; then walk backwards looking for
  // ancestors that are strictly shallower (lower level number).
  trail.unshift(headings[idx].text);
  let level = headings[idx].level;
  if (level === 1) return trail.join("/");
  for (let j = idx - 1; j >= 0; j--) {
    if (headings[j].level < level) {
      trail.unshift(headings[j].text);
      level = headings[j].level;
      if (level === 1) break;
    }
  }
  return trail.join("/");
}

export function listHeadings(content: string): HeadingInfo[] {
  const headings = scanHeadings(content.split("\n"));
  return headings.map((h, i) => ({ level: h.level, text: h.text, path: pathFor(headings, i) }));
}

/** Find the heading index whose path equals `headingPath`, or -1. */
function findIndex(headings: Heading[], headingPath: string): number {
  for (let i = 0; i < headings.length; i++) {
    if (pathFor(headings, i) === headingPath) return i;
  }
  return -1;
}

/** Returns [startLine, endLineExclusive] for the section, or null. */
function bounds(lines: string[], headingPath: string): [number, number] | null {
  const headings = scanHeadings(lines);
  const idx = findIndex(headings, headingPath);
  if (idx === -1) return null;
  const start = headings[idx].line;
  const level = headings[idx].level;
  let end = lines.length;
  for (let j = idx + 1; j < headings.length; j++) {
    if (headings[j].level <= level) {
      end = headings[j].line;
      break;
    }
  }
  return [start, end];
}

export function getSection(content: string, headingPath: string): string | null {
  // Section edits normalize line endings to LF.
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const b = bounds(lines, headingPath);
  if (!b) return null;
  return lines.slice(b[0], b[1]).join("\n");
}

/** Replace the section body with `newSection` (caller supplies the full block,
 *  heading included). Returns the new document, or null if not found. */
export function replaceSection(content: string, headingPath: string, newSection: string): string | null {
  // Section edits normalize line endings to LF.
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const b = bounds(lines, headingPath);
  if (!b) return null;
  const replacement = newSection.replace(/\r\n/g, "\n").split("\n");
  const next = [...lines.slice(0, b[0]), ...replacement, ...lines.slice(b[1])];
  return next.join("\n");
}

/** Append `text` at the end of the section addressed by `headingPath` (before the
 *  next same-or-higher heading). Returns the new document, or null if not found. */
export function appendUnderHeading(content: string, headingPath: string, text: string): string | null {
  const section = getSection(content, headingPath);
  if (section === null) return null;
  const newSection = `${section.replace(/\s+$/, "")}\n\n${text.trim()}\n`;
  return replaceSection(content, headingPath, newSection);
}
