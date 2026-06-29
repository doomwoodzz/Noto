// Renders Markdown source into HTML for the contenteditable live editor.
//
// The guiding invariant: every source character is preserved in the DOM, so
// reading an element's `textContent` reconstructs the exact Markdown. Inline
// markers (`**`, `*`, `<u>`, `# `, `- `, `[[`/`]]`) live inside hidden
// <span class="rme-mk"> nodes — present in the DOM (so textContent round-trips)
// but `display:none` (so the caret can never land inside them and they render
// invisibly). Wiki links are the one atomic exception: they render as a styled
// pill whose textContent is still `[[Title]]`.

import { extractWikiLinks } from "../noto-core";

const HTML_ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const ATTR_ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => HTML_ESC[c]);
}
function escAttr(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ATTR_ESC[c]);
}

/** A hidden marker span that still contributes its text to `textContent`. */
function mk(literal: string): string {
  return literal ? `<span class="rme-mk">${esc(literal)}</span>` : "";
}

/** All wiki-link titles in a Markdown string (trimmed, brackets stripped). */
export function wikiTitlesIn(md: string): string[] {
  return extractWikiLinks(md);
}

function pill(rawTitle: string): string {
  const title = rawTitle.trim();
  return (
    `<span class="rme-pill" contenteditable="false" data-title="${escAttr(title)}">` +
    `${mk("[[")}<span class="rme-pill-label">${esc(rawTitle)}</span>${mk("]]")}` +
    `</span>`
  );
}

/** The host of a URL (for the chip favicon + placeholder label), or the input. */
export function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** True if `s` is a single bare http(s) URL — the paste-to-cite trigger. */
export function isUrl(s: string): boolean {
  const t = s.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return false;
  try {
    const u = new URL(t);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** The Markdown token a pasted URL becomes: `[host](<url>)` (host is the
 *  placeholder label, upgraded to the site name once metadata resolves). */
export function placeholderCite(url: string): string {
  const u = url.trim();
  return `[${hostFromUrl(u)}](<${u}>)`;
}

/**
 * Render a citation chip. The visible content is a favicon + label; the source
 * token `[label](rawTarget)` is preserved exactly via hidden marker spans, so
 * `textContent` round-trips. `rawTarget` keeps the source's angle brackets (if
 * any) so `[a](<u>)` and `[a](u)` both reconstruct precisely.
 */
function citeChip(label: string, rawTarget: string, url: string): string {
  return (
    `<span class="rme-cite" contenteditable="false" data-url="${escAttr(url)}">` +
    `<span class="rme-cite-fav" data-host="${escAttr(hostFromUrl(url))}"></span>` +
    `${mk("[")}<span class="rme-cite-label">${esc(label)}</span>${mk("](" + rawTarget + ")")}` +
    `</span>`
  );
}

/** Render the inline span content of a single line (no block prefix). Exported
 *  so the block editor can render each block's text with the same hidden-marker
 *  + wiki-pill scheme. */
export function inlineHtml(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);

    let m = /^\[\[([^[\]\n]+?)\]\]/.exec(rest);
    if (m) {
      out += pill(m[1]);
      i += m[0].length;
      continue;
    }
    // Inline link → citation chip. Accepts `[label](<url>)` (the form paste
    // emits) and plain `[label](url)`; only http(s) targets become chips.
    m = /^\[([^[\]\n]*)\]\((<[^>\n]+>|[^()\s]+)\)/.exec(rest);
    if (m) {
      const rawTarget = m[2];
      const url = rawTarget.replace(/^<|>$/g, "");
      if (/^https?:\/\//i.test(url)) {
        out += citeChip(m[1], rawTarget, url);
        i += m[0].length;
        continue;
      }
    }
    m = /^\*\*([^*\n]+?)\*\*/.exec(rest);
    if (m) {
      out += `<strong>${mk("**")}${inlineHtml(m[1])}${mk("**")}</strong>`;
      i += m[0].length;
      continue;
    }
    m = /^<u>([^\n]*?)<\/u>/.exec(rest);
    if (m) {
      out += `<u>${mk("<u>")}${inlineHtml(m[1])}${mk("</u>")}</u>`;
      i += m[0].length;
      continue;
    }
    m = /^\*([^*\n]+?)\*/.exec(rest);
    if (m) {
      out += `<em>${mk("*")}${inlineHtml(m[1])}${mk("*")}</em>`;
      i += m[0].length;
      continue;
    }
    m = /^`([^`\n]+?)`/.exec(rest);
    if (m) {
      // Inline code is literal — no nested inline parsing.
      out += `<code class="rme-code">${mk("`")}${esc(m[1])}${mk("`")}</code>`;
      i += m[0].length;
      continue;
    }
    // Plain run up to the next character that could open a token.
    m = /^[^[*<`]+/.exec(rest);
    const chunk = m ? m[0] : rest[0];
    out += esc(chunk);
    i += chunk.length;
  }
  return out;
}

/** Render one source line into a block element (always emits a single div). */
function lineHtml(line: string): string {
  if (line.trim() === "---" || line.trim() === "***") {
    return `<div class="rme-block rme-hr">${mk(line)}</div>`;
  }

  let m = /^(\s*)(#{1,6})(\s+)(.*)$/.exec(line);
  if (m) {
    const level = m[2].length;
    const prefix = m[1] + m[2] + m[3];
    return `<div class="rme-block rme-h${level}">${mk(prefix)}${inlineHtml(m[4])}</div>`;
  }

  m = /^(\s*)(- \[( |x|X)\] )(.*)$/.exec(line);
  if (m) {
    const checked = m[3].toLowerCase() === "x";
    const prefix = m[1] + m[2];
    const cls = "rme-block rme-task" + (checked ? " is-checked" : "");
    return `<div class="${cls}">${mk(prefix)}${inlineHtml(m[4])}</div>`;
  }

  m = /^(\s*)(- )(.*)$/.exec(line);
  if (m) {
    const prefix = m[1] + m[2];
    return `<div class="rme-block rme-li">${mk(prefix)}${inlineHtml(m[3])}</div>`;
  }

  m = /^(>\s?)(.*)$/.exec(line);
  if (m) {
    return `<div class="rme-block rme-quote">${mk(m[1])}${inlineHtml(m[2])}</div>`;
  }

  if (line === "") {
    return `<div class="rme-block"><br></div>`;
  }
  return `<div class="rme-block">${inlineHtml(line)}</div>`;
}

/** Render full Markdown source into the editor's block HTML. */
export function markdownToHtml(md: string): string {
  return md.split("\n").map(lineHtml).join("");
}
