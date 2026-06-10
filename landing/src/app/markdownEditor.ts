// Faithful port of Sources/NotoCore/Lib/MarkdownEditor.swift.
// Operates on a textarea's value + selection (selectionStart/End are UTF-16
// code-unit offsets, matching the Swift NSRange semantics).

export interface EditState {
  content: string;
  start: number;
  end: number;
}

export type InlineStyle = "bold" | "italic" | "underline";

const MARKERS: Record<InlineStyle, { open: string; close: string }> = {
  bold: { open: "**", close: "**" },
  italic: { open: "*", close: "*" },
  underline: { open: "<u>", close: "</u>" },
};

export function applyInlineStyle(style: InlineStyle, s: EditState): EditState {
  const { start, end } = clamp(s);
  const { open, close } = MARKERS[style];
  const selected = s.content.slice(start, end);
  const content = s.content.slice(0, start) + open + selected + close + s.content.slice(end);
  return { content, start: start + open.length, end: start + open.length + selected.length };
}

export function handleEnter(s: EditState): EditState {
  const { start } = clamp(s);
  const lineStart = currentLineStart(s.content, start);
  const linePrefix = s.content.slice(lineStart, start);
  const trimmed = linePrefix.trim();

  // Exit an empty bullet: a line that is just "-".
  if (trimmed === "-") {
    const content = s.content.slice(0, lineStart) + s.content.slice(start);
    return { content, start: lineStart, end: lineStart };
  }

  // Continue a non-empty "- " list item.
  if (trimmed.startsWith("- ") && trimmed.slice(2).length > 0) {
    return replaceSelection("\n- ", s);
  }

  return replaceSelection("\n", s);
}

export function handleTab(s: EditState, shift: boolean): EditState {
  const { start, end } = clamp(s);
  const lineStart = currentLineStart(s.content, start);

  if (shift) {
    const removable = leadingSpaces(s.content, lineStart, 4);
    if (removable === 0) return { content: s.content, start, end };
    const content = s.content.slice(0, lineStart) + s.content.slice(lineStart + removable);
    return {
      content,
      start: Math.max(lineStart, start - removable),
      end: Math.max(lineStart, end - removable),
    };
  }

  const content = s.content.slice(0, lineStart) + "    " + s.content.slice(lineStart);
  return { content, start: start + 4, end: end + 4 };
}

/* ------------------------------- internals ------------------------------ */

function replaceSelection(text: string, s: EditState): EditState {
  const { start, end } = clamp(s);
  const content = s.content.slice(0, start) + text + s.content.slice(end);
  const caret = start + text.length;
  return { content, start: caret, end: caret };
}

function currentLineStart(content: string, location: number): number {
  const safe = Math.min(Math.max(location, 0), content.length);
  if (safe === 0) return 0;
  const before = content.slice(0, safe);
  const idx = before.lastIndexOf("\n");
  return idx === -1 ? 0 : idx + 1;
}

function leadingSpaces(content: string, lineStart: number, max: number): number {
  let n = 0;
  while (n < max && content[lineStart + n] === " ") n += 1;
  return n;
}

function clamp(s: EditState): { start: number; end: number } {
  const len = s.content.length;
  const start = Math.min(Math.max(s.start, 0), len);
  const end = Math.min(Math.max(s.end, start), len);
  return { start, end };
}
