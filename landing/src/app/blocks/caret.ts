// Caret math for a single inline-editable region (one block's text).
//
// The DOM inside a block mirrors the live-Markdown scheme from liveMarkdown.ts:
// hidden `.rme-mk` marker spans and atomic `.rme-pill` wiki links both still
// contribute their literal text to `textContent`, so a region's `textContent`
// equals its Markdown source and caret offsets are measured in that same space.

type Unit = { node: Node; len: number; kind: "text" | "marker" | "pill" };

function collectUnits(node: Node, out: Unit[] = []): Unit[] {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out.push({ node: child, len: (child as Text).data.length, kind: "text" });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (el.classList.contains("rme-pill") || el.classList.contains("rme-cite")) {
        // Wiki pills and citation chips are atomic: the caret lands before or
        // after them, never inside, so they select/delete as one character.
        out.push({ node: el, len: el.textContent?.length ?? 0, kind: "pill" });
      } else if (el.classList.contains("rme-mk")) {
        out.push({ node: el, len: el.textContent?.length ?? 0, kind: "marker" });
      } else {
        collectUnits(el, out);
      }
    }
  });
  return out;
}

function fragLen(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data.length;
  let total = 0;
  node.childNodes.forEach((c) => {
    total += fragLen(c);
  });
  return total;
}

function afterNode(node: Node): { node: Node; offset: number } {
  const parent = node.parentNode!;
  return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) + 1 };
}
function beforeNode(node: Node): { node: Node; offset: number } {
  const parent = node.parentNode!;
  return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) };
}

function offsetOf(root: HTMLElement, node: Node, nodeOffset: number): number {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, nodeOffset);
  return fragLen(r.cloneContents());
}

function boundaryFor(root: HTMLElement, target: number): { node: Node; offset: number } {
  const units = collectUnits(root);
  if (units.length === 0) return { node: root, offset: 0 };
  let remaining = Math.max(0, target);
  for (const u of units) {
    if (remaining <= u.len) {
      if (u.kind === "text") return { node: u.node, offset: remaining };
      if (u.kind === "marker") return afterNode(u.node); // never land inside a marker
      return remaining === 0 ? beforeNode(u.node) : afterNode(u.node); // pill is atomic
    }
    remaining -= u.len;
  }
  const last = units[units.length - 1];
  return last.kind === "text"
    ? { node: last.node, offset: (last.node as Text).data.length }
    : afterNode(last.node);
}

export function textLength(root: HTMLElement): number {
  return root.textContent?.length ?? 0;
}

/** Caret offset (collapsed focus) within the region, or null if outside it. */
export function getCaretOffset(root: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.endContainer)) return null;
  return offsetOf(root, r.endContainer, r.endOffset);
}

export interface OffsetRange {
  start: number;
  end: number;
}

export function getSelectionRange(root: HTMLElement): OffsetRange | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  if (!sel.anchorNode || !sel.focusNode) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  const a = offsetOf(root, sel.anchorNode, sel.anchorOffset);
  const f = offsetOf(root, sel.focusNode, sel.focusOffset);
  return { start: Math.min(a, f), end: Math.max(a, f) };
}

export function setCaretOffset(root: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const b = boundaryFor(root, offset);
  const r = document.createRange();
  r.setStart(b.node, b.offset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

export function setSelectionRange(root: HTMLElement, start: number, end: number): void {
  if (start === end) {
    setCaretOffset(root, start);
    return;
  }
  const sel = window.getSelection();
  if (!sel) return;
  const a = boundaryFor(root, start);
  const z = boundaryFor(root, end);
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(z.node, z.offset);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Place the caret at the start or end of a region and focus it. */
export function focusRegion(root: HTMLElement, at: "start" | "end" | number): void {
  root.focus();
  const offset = at === "start" ? 0 : at === "end" ? textLength(root) : at;
  setCaretOffset(root, offset);
}

/** A DOMRect for the current collapsed caret, for anchoring popovers. */
export function caretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0).cloneRange();
  const rects = r.getClientRects();
  if (rects.length > 0) return rects[0];
  // Collapsed range at a node boundary can have no rects; probe a zero-width span.
  const probe = document.createElement("span");
  probe.textContent = "​";
  r.insertNode(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  return rect;
}

const LINE_SLOP = 6; // px tolerance when deciding "same visual line"

export function isCaretOnFirstLine(root: HTMLElement): boolean {
  const c = caretRect();
  if (!c) return true;
  return c.top - root.getBoundingClientRect().top <= c.height + LINE_SLOP;
}

export function isCaretOnLastLine(root: HTMLElement): boolean {
  const c = caretRect();
  if (!c) return true;
  return root.getBoundingClientRect().bottom - c.bottom <= c.height + LINE_SLOP;
}
