import { getSection, listHeadings } from "../notes/sections.ts";

const MAX = 160;

function strip(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\(<?[^)]*>?\)/g, "$1")
    .replace(/\[\[([^[\]]+)\]\]/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(q: string): string[] {
  return (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);
}

function clip(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = lower.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return text.slice(0, MAX).trim();
  const start = Math.max(0, at - 40);
  let s = text.slice(start, start + MAX).trim();
  if (start > 0) s = "…" + s.slice(0, MAX - 1);
  return s.slice(0, MAX);
}

/** Pick the heading section that best matches `query`; return its path + a ≤160-char snippet. */
export function bestSnippet(content: string, query: string): { headingPath: string[]; snippet: string } {
  const terms = tokens(query);
  const score = (text: string) => {
    const l = text.toLowerCase();
    return terms.reduce((n, t) => n + (l.includes(t) ? 1 : 0), 0);
  };
  let best: { path: string[]; text: string; n: number; depth: number } | null = null;
  for (const h of listHeadings(content)) {
    const sec = getSection(content, h.path);
    if (sec === null) continue;
    const text = strip(sec);
    const n = score(text);
    const depth = h.path.split("/").length;
    // Prefer higher score; on ties prefer deeper (more specific) heading.
    if (!best || n > best.n || (n === best.n && n > 0 && depth > best.depth)) {
      best = { path: h.path.split("/"), text, n, depth };
    }
  }
  // Intro = only the lines before the first heading. (Don't bleed in subsection
  // bodies — a multi-term query could otherwise beat real sections and return [].)
  const introLines = content.split("\n");
  const firstHeading = introLines.findIndex((l) => /^\s{0,3}#{1,6}\s/.test(l));
  const introText = strip(firstHeading === -1 ? content : introLines.slice(0, firstHeading).join("\n"));
  const introN = score(introText);
  if (!best || introN > best.n) best = { path: [], text: introText, n: introN, depth: 0 };
  return { headingPath: best.path, snippet: clip(best.text, terms) };
}
