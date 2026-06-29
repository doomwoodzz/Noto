// Passage chunking for Smart Search.
//
// Splits a note's Markdown body into coherent passages (heading sections /
// merged paragraph groups) that are small enough to embed individually but
// large enough to carry meaning. Each passage records the heading trail it
// lives under, so the embedding text can be enriched with that context and the
// UI can show where a hit came from.
//
// Pure and environment-agnostic (no DOM / no model) so it can be unit-tested
// alongside the rest of noto-core.

export interface Passage {
  /** Stable id `${fileId}#${index}`. */
  id: string;
  fileId: string;
  /** Position within the note (0-based), in document order. */
  index: number;
  /** Heading trail enclosing the passage, outermost first (markers stripped). */
  headingPath: string[];
  /** Raw passage text (Markdown markers preserved). */
  text: string;
  /** Character offset of the passage start within the stripped body. */
  charStart: number;
}

// A passage aims for ~TARGET chars by merging short adjacent paragraphs, and is
// never allowed past ~MAX (long single paragraphs are split by sentence).
const TARGET_CHARS = 400;
const MAX_CHARS = 900;

/**
 * Split a note into passages. `content` is the canonical Markdown (a leading
 * `# Title` line is stripped, matching how the editor renders the body) so the
 * passage text aligns with what's shown in the note view.
 */
export function chunkNote(file: { id: string; content: string }): Passage[] {
  const body = stripLeadingTitle(file.content);
  const items = tokenize(body);

  const passages: Passage[] = [];
  const headingStack: { level: number; text: string }[] = [];
  let buf: { text: string; charStart: number }[] = [];
  let index = 0;

  const headingPath = () => headingStack.map((h) => h.text);

  const flush = () => {
    if (buf.length === 0) return;
    const text = buf.map((b) => b.text).join("\n\n").trim();
    const charStart = buf[0].charStart;
    buf = [];
    if (!text) return;
    for (const piece of splitToMax(text, MAX_CHARS)) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      passages.push({
        id: `${file.id}#${index}`,
        fileId: file.id,
        index,
        headingPath: headingPath(),
        text: trimmed,
        charStart,
      });
      index += 1;
    }
  };

  for (const item of items) {
    if (item.type === "heading") {
      flush();
      while (headingStack.length && headingStack[headingStack.length - 1].level >= item.level) {
        headingStack.pop();
      }
      headingStack.push({ level: item.level, text: item.text });
      continue;
    }
    // A blank-separated block. Start a fresh passage when the buffer is already
    // big enough, otherwise merge this block in to reach TARGET.
    if (buf.length && bufLen(buf) >= TARGET_CHARS) flush();
    buf.push({ text: item.text, charStart: item.charStart });
    if (bufLen(buf) >= MAX_CHARS) flush();
  }
  flush();
  return passages;
}

/** Split prose into sentences/lines — used for chunking and highlight picking. */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=["'([]?[A-Z0-9])/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Strip common Markdown markup to readable prose (for previews + matching). */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\(<?[^)]*>?\)/g, "$1")
    .replace(/\[\[([^[\]]+)\]\]/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------- internals ------------------------------ */

type Token =
  | { type: "heading"; level: number; text: string }
  | { type: "block"; text: string; charStart: number };

/** Break a body into headings and blank-line-separated blocks, with offsets. */
function tokenize(body: string): Token[] {
  const lines = body.split(/\r\n|\r|\n/);
  const tokens: Token[] = [];
  let block: string[] = [];
  let blockStart = 0;
  let offset = 0;

  const endBlock = () => {
    if (block.length) {
      tokens.push({ type: "block", text: block.join("\n"), charStart: blockStart });
      block = [];
    }
  };

  for (const line of lines) {
    const lineLen = line.length + 1; // include the consumed newline
    const heading = parseHeading(line);
    if (heading) {
      endBlock();
      tokens.push({ type: "heading", level: heading.level, text: heading.text });
    } else if (line.trim() === "") {
      endBlock();
    } else {
      if (block.length === 0) blockStart = offset;
      block.push(line);
    }
    offset += lineLen;
  }
  endBlock();
  return tokens;
}

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

function bufLen(buf: { text: string }[]): number {
  return buf.reduce((n, b) => n + b.text.length + 2, 0);
}

/** Keep a passage under `max` chars by grouping sentences greedily. */
function splitToMax(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = "";
  for (const s of splitSentences(text)) {
    if (cur && (cur.length + s.length + 1) > max) {
      out.push(cur);
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [text];
}

function stripLeadingTitle(content: string): string {
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i += 1;
  if (i < lines.length && /^#\s+/.test(lines[i])) {
    i += 1;
    while (i < lines.length && lines[i].trim() === "") i += 1;
    return lines.slice(i).join("\n");
  }
  return content;
}
