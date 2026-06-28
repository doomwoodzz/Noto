// The Smart Search panel — expands out of the title-bar search box with a
// dimmed backdrop, runs semantic (embedding) search live as you type, and shows
// ranked results with a highlighted preview passage. Presentational: all search
// state comes from `useSmartSearch` (kept warm in NotoWindow).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { plainText } from "../../noto-core";
import "../../styles/smart-search.css";
import { Icon } from "../icons";
import type { SmartResult } from "./types";
import type { SmartSearchState } from "./useSmartSearch";

interface Props {
  smart: SmartSearchState;
  /** The title-bar search box to anchor/morph from. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onOpenResult: (result: SmartResult) => void;
}

const PREVIEW_BEFORE = 64;
const PREVIEW_AFTER = 140;
const MIN_WIDTH = 560;
/** Keep in sync with `--ss-dur` in smart-search.css (the expand duration). */
const EXPAND_MS = 300;

/** Collapsed (search-box) and expanded (panel) geometry the expand morphs between. */
interface Geom {
  collapsed: { left: number; top: number; width: number; height: number };
  expanded: { left: number; top: number; width: number };
}

export function SmartSearchPanel({ smart, anchorRef, onClose, onOpenResult }: Props) {
  const { status, progress, query, setQuery, results, searching, source } = smart;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [seenResults, setSeenResults] = useState(results);
  const [geom, setGeom] = useState<Geom | null>(null);
  // Drives the open/close expand: false on mount + while closing, true once
  // expanded. Flipping it transitions the panel between the two geometries.
  const [open, setOpen] = useState(false);
  const closingRef = useRef(false);

  // Reset the active row when a new result set arrives — adjusting state during
  // render (the documented pattern) instead of a setState-in-effect cascade.
  if (seenResults !== results) {
    setSeenResults(results);
    setActive(0);
  }

  // Measure both the collapsed search-box rect and the expanded panel target so
  // the panel can morph from one to the other (a real expand, not a fade).
  useLayoutEffect(() => {
    const measure = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      const vw = window.innerWidth;
      const top = rect?.top ?? 60;
      const width = Math.min(Math.max(rect?.width ?? MIN_WIDTH, MIN_WIDTH), vw - 32);
      const center = rect ? rect.left + rect.width / 2 : vw / 2;
      const left = Math.min(Math.max(center - width / 2, 16), vw - width - 16);
      setGeom({
        collapsed: {
          left: rect?.left ?? left,
          top,
          width: rect?.width ?? width,
          height: rect?.height ?? 36,
        },
        expanded: { left, top, width },
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchorRef]);

  // Kick off the expand on the frame after mount so the collapsed geometry is
  // painted first and the transition has somewhere to animate from.
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Collapse back into the search box, then unmount once the morph finishes.
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setOpen(false);
    window.setTimeout(onClose, EXPAND_MS);
  }, [onClose]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the keyboard-active row in view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      setActive((a) => Math.min(results.length - 1, a + 1));
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setActive((a) => Math.max(0, a - 1));
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (results[active]) onOpenResult(results[active]);
      e.preventDefault();
    } else if (e.key === "Escape") {
      requestClose();
      e.preventDefault();
    }
  }

  const showPreparing = status === "preparing";
  const trimmed = query.trim();
  const empty = trimmed.length === 0;
  const noResults = !empty && !searching && results.length === 0 && status !== "preparing";

  const panelStyle = geom
    ? open
      ? { left: geom.expanded.left, top: geom.expanded.top, width: geom.expanded.width, maxHeight: "64vh", borderRadius: 13 }
      : {
          left: geom.collapsed.left,
          top: geom.collapsed.top,
          width: geom.collapsed.width,
          maxHeight: geom.collapsed.height,
          borderRadius: 9,
        }
    : undefined;

  return (
    <div className="nw-ss-overlay" style={{ opacity: open ? 1 : 0 }} onMouseDown={requestClose}>
      {geom && (
        <div
          className={"nw-ss-panel" + (open ? " is-open" : "")}
          style={panelStyle}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          <div className="nw-ss-head">
            <span className="nw-ss-icn"><Icon name="search" size={15} stroke={1.8} /></span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by meaning — a concept or a question…"
              aria-label="Smart search"
              spellCheck={false}
            />
            {searching && <span className="nw-ss-spinner" aria-hidden />}
            <span className={"nw-ss-mode" + (source === "embedding" ? " is-semantic" : "")}>
              {source === "embedding" ? "Semantic" : source === "lexical" ? "Keyword" : "Smart"}
            </span>
            <span className="nw-ss-kbd">esc</span>
          </div>

          {showPreparing && (
            <div className="nw-ss-prep">
              <div className="nw-ss-prep-bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
              <span>Preparing semantic search…</span>
            </div>
          )}

          <div className="nw-ss-list" ref={listRef}>
            {empty && (
              <div className="nw-ss-hint">
                Type to search across your notes by meaning — related topics surface even without exact keywords.
              </div>
            )}
            {noResults && <div className="nw-ss-hint">No related notes found.</div>}
            {results.map((r, i) => (
              <button
                key={r.fileId}
                data-i={i}
                className={"nw-ss-item" + (i === active ? " is-active" : "")}
                onMouseEnter={() => setActive(i)}
                onClick={() => onOpenResult(r)}
              >
                <div className="nw-ss-item-head">
                  <span className="nw-ss-item-title">{r.title}</span>
                  {r.headingPath.length > 0 && (
                    <span className="nw-ss-item-trail">{r.headingPath.join(" › ")}</span>
                  )}
                </div>
                <div className="nw-ss-item-preview">{renderSnippet(r.passageText, r.highlightSentence)}</div>
                <span className="nw-ss-item-path">{r.path}</span>
              </button>
            ))}
          </div>

          {status === "error" && (
            <div className="nw-ss-foot">Semantic model unavailable — showing keyword matches.</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Render the passage preview, wrapping the matched sentence in a <mark>. */
function renderSnippet(passageText: string, highlight: string | null): ReactNode {
  const plain = snippetPlain(passageText);
  if (!highlight) return truncate(plain, PREVIEW_BEFORE + PREVIEW_AFTER);
  const idx = plain.indexOf(highlight);
  if (idx < 0) return truncate(plain, PREVIEW_BEFORE + PREVIEW_AFTER);
  const start = Math.max(0, idx - PREVIEW_BEFORE);
  const before = (start > 0 ? "…" : "") + plain.slice(start, idx);
  const after = plain.slice(idx + highlight.length);
  return (
    <>
      {before}
      <mark className="nw-ss-hit">{highlight}</mark>
      {truncate(after, PREVIEW_AFTER)}
    </>
  );
}

// `renderSnippet` is called inline (not a component), so plain text is cached by
// identity in a tiny module map to avoid re-stripping markdown on every keystroke.
const snippetCache = new Map<string, string>();
function snippetPlain(md: string): string {
  let v = snippetCache.get(md);
  if (v === undefined) {
    v = plainText(md);
    if (snippetCache.size > 2000) snippetCache.clear();
    snippetCache.set(md, v);
  }
  return v;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, "") + "…";
}
