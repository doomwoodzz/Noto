// A chrome-free live-Markdown editor.
//
// Reuses the app's per-block contenteditable engine (InlineText + blockModel,
// which keep Markdown as the source of truth and render inline formatting +
// [[wiki]] pills live) but drops the Notion-style chrome — no gutter, drag
// handles, slash menu, selection toolbar, or widgets — so the note body reads
// like the redesign's clean rendered Markdown while staying editable inline.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  blockText,
  createBlock,
  isTextBearing,
  parseBlocks,
  renumberLists,
  serializeBlocks,
  withText,
  type Block,
  type CodeBlock,
} from "../app/blocks/blockModel";
import { InlineText, type InlineHandle } from "../app/blocks/InlineText";
import { wikiTitlesIn } from "../app/liveMarkdown";
import { useCitationClient } from "./citationClient";
import { ensureCitationMeta, getCitationMeta, subscribeCitations } from "./citationCache";
import { CitationHoverCard } from "./CitationHoverCard";

interface Props {
  content: string;
  onChange: (md: string) => void;
  onWikiOpen: (title: string) => void;
  onWikiCreate?: (title: string) => void;
  /** When set, scroll to & briefly flash the block matching this text. */
  revealText?: string;
  onRevealed?: () => void;
}

interface FocusReq {
  id: string;
  at: "start" | "end" | number;
}
type Tx = { next: Block[]; focus?: FocusReq };

const WIKI_DEBOUNCE_MS = 1100;
const HOVER_CLOSE_MS = 160;

/** Strip characters that would break the `[label](<url>)` citation token. */
function sanitizeLabel(s: string): string {
  return s.replace(/[[\]\r\n]/g, "").replace(/\s+/g, " ").trim();
}

export function LiveMarkdownEditor({ content, onChange, onWikiOpen, onWikiCreate, revealText, onRevealed }: Props) {
  const [blocks, setBlocks] = useState<Block[]>(() => parseBlocks(content));
  const blocksRef = useRef(blocks);
  const lastSerialized = useRef(content);
  const registry = useRef(new Map<string, InlineHandle>());
  const focusReq = useRef<FocusReq | null>(null);

  const seenWiki = useRef<Set<string>>(new Set(wikiTitlesIn(content)));
  const wikiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const client = useCitationClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const [hoverAnchor, setHoverAnchor] = useState<HTMLElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  // Resync when content changes from outside our own edits.
  useEffect(() => {
    if (content === lastSerialized.current) return;
    const parsed = parseBlocks(content);
    blocksRef.current = parsed;
    setBlocks(parsed);
    lastSerialized.current = content;
  }, [content]);

  // Apply pending focus once the DOM reflects the new blocks.
  useEffect(() => {
    if (!focusReq.current) return;
    const { id, at } = focusReq.current;
    focusReq.current = null;
    registry.current.get(id)?.focus(at);
  }, [blocks]);

  useEffect(() => () => { if (wikiTimer.current) clearTimeout(wikiTimer.current); }, []);

  function scheduleWikiCreate(md: string) {
    if (!onWikiCreate) return;
    if (wikiTimer.current) clearTimeout(wikiTimer.current);
    wikiTimer.current = setTimeout(() => {
      for (const t of wikiTitlesIn(md)) {
        if (t && !seenWiki.current.has(t)) {
          seenWiki.current.add(t);
          onWikiCreate(t);
        }
      }
    }, WIKI_DEBOUNCE_MS);
  }

  /** Single funnel for every mutation: update state, serialize, notify. */
  function apply(fn: (prev: Block[]) => Tx) {
    const prev = blocksRef.current;
    const { next, focus } = fn(prev);
    if (next === prev) return;
    blocksRef.current = next;
    setBlocks(next);
    const md = serializeBlocks(next);
    lastSerialized.current = md;
    onChange(md);
    if (focus) focusReq.current = focus;
    scheduleWikiCreate(md);
  }

  function setText(id: string, text: string) {
    apply((prev) => ({ next: prev.map((b) => (b.id === id ? withText(b, text) : b)) }));
  }

  function patchBlock(id: string, patch: Partial<Block>) {
    apply((prev) => ({ next: prev.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)) }));
  }

  function continuation(b: Block, rightText: string): Block {
    switch (b.type) {
      case "bulleted":
        return createBlock("bulleted", { indent: b.indent, text: rightText } as Partial<Block>);
      case "numbered":
        return createBlock("numbered", { indent: b.indent, number: b.number + 1, text: rightText } as Partial<Block>);
      case "task":
        return createBlock("task", { text: rightText } as Partial<Block>);
      case "quote":
        return createBlock("quote", { text: rightText } as Partial<Block>);
      default:
        return createBlock("paragraph", { text: rightText } as Partial<Block>);
    }
  }

  function splitBlock(id: string, caret: number) {
    apply((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx === -1) return { next: prev };
      const b = prev[idx];
      const text = blockText(b);
      if (text === null) {
        const nb = createBlock("paragraph");
        return { next: [...prev.slice(0, idx + 1), nb, ...prev.slice(idx + 1)], focus: { id: nb.id, at: "start" } };
      }
      const left = text.slice(0, caret);
      const right = text.slice(caret);
      // Empty list/quote/task item → exit to a paragraph in place.
      if (left === "" && right === "" && b.type !== "paragraph" && b.type !== "heading") {
        const para = createBlock("paragraph");
        return { next: renumberLists(prev.map((x, i) => (i === idx ? para : x))), focus: { id: para.id, at: "start" } };
      }
      const newBlock = continuation(b, right);
      let next = prev.map((x, i) => (i === idx ? withText(b, left) : x));
      next = [...next.slice(0, idx + 1), newBlock, ...next.slice(idx + 1)];
      return { next: renumberLists(next), focus: { id: newBlock.id, at: "start" } };
    });
  }

  function backspaceAtStart(id: string) {
    apply((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx === -1) return { next: prev };
      const b = prev[idx];
      if (isTextBearing(b) && b.type !== "paragraph") {
        const para = createBlock("paragraph", { text: blockText(b) ?? "" } as Partial<Block>);
        return { next: renumberLists(prev.map((x, i) => (i === idx ? para : x))), focus: { id: para.id, at: "start" } };
      }
      if (idx === 0) return { next: prev };
      const prevB = prev[idx - 1];
      if (isTextBearing(prevB)) {
        const joinAt = (blockText(prevB) ?? "").length;
        const merged = withText(prevB, (blockText(prevB) ?? "") + (blockText(b) ?? ""));
        const next = renumberLists(prev.map((x, i) => (i === idx - 1 ? merged : x)).filter((_, i) => i !== idx));
        return { next, focus: { id: merged.id, at: joinAt } };
      }
      if (prevB.type === "divider") {
        return { next: prev.filter((_, i) => i !== idx - 1), focus: { id: b.id, at: "start" } };
      }
      return { next: prev };
    });
  }

  function deleteAtEnd(id: string) {
    apply((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      const b = prev[idx];
      const nextB = prev[idx + 1];
      if (!nextB || !isTextBearing(b) || !isTextBearing(nextB)) return { next: prev };
      const joinAt = (blockText(b) ?? "").length;
      const merged = withText(b, (blockText(b) ?? "") + (blockText(nextB) ?? ""));
      const next = renumberLists(prev.map((x, i) => (i === idx ? merged : x)).filter((_, i) => i !== idx + 1));
      return { next, focus: { id: merged.id, at: joinAt } };
    });
  }

  function indentList(id: string, shift: boolean): boolean {
    const b = blocksRef.current.find((x) => x.id === id);
    if (!b || (b.type !== "bulleted" && b.type !== "numbered")) return false;
    apply((prev) =>
      ({ next: renumberLists(prev.map((x) => {
        if (x.id !== id || (x.type !== "bulleted" && x.type !== "numbered")) return x;
        const indent = Math.max(0, Math.min(24, x.indent + (shift ? -4 : 4)));
        return { ...x, indent };
      })) }),
    );
    return true;
  }

  function focusSibling(id: string, dir: -1 | 1): boolean {
    const list = blocksRef.current;
    const idx = list.findIndex((b) => b.id === id);
    for (let i = idx + dir; i >= 0 && i < list.length; i += dir) {
      const handle = registry.current.get(list[i].id);
      if (handle) {
        handle.focus(dir === 1 ? "start" : "end");
        return true;
      }
    }
    return false;
  }

  function appendParagraph() {
    apply((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.type === "paragraph" && last.text === "") {
        return { next: prev, focus: { id: last.id, at: "start" } };
      }
      const nb = createBlock("paragraph");
      return { next: [...prev, nb], focus: { id: nb.id, at: "start" } };
    });
  }

  /* ----------------------------- citations ------------------------------ */

  // After a URL is pasted, upgrade its placeholder `[host](<url>)` token to
  // `[siteName](<url>)` once metadata resolves (skip if the user already edited
  // the label). The rewrite flows through the normal mutation funnel.
  function enrichCitation(url: string) {
    ensureCitationMeta(url, client)
      .then((meta) => {
        const placeholder = `[${meta.host}](<${url}>)`;
        const label = sanitizeLabel(meta.siteName) || meta.host;
        const replacement = `[${label}](<${url}>)`;
        if (placeholder === replacement) return;
        apply((prev) => {
          let changed = false;
          const next = prev.map((b) => {
            const t = blockText(b);
            if (t && t.includes(placeholder)) {
              changed = true;
              return withText(b, t.split(placeholder).join(replacement));
            }
            return b;
          });
          return { next: changed ? next : prev };
        });
      })
      .catch(() => {});
  }

  // Swap each chip's default-globe favicon for its real one from the cache, and
  // fetch metadata once for chips loaded from a saved note. Pure decoration —
  // the favicon span carries no text, so caret offsets are unaffected.
  const decorate = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>(".rme-cite-fav").forEach((fav) => {
      const chip = fav.closest<HTMLElement>(".rme-cite");
      const url = chip?.getAttribute("data-url");
      if (!url) return;
      const meta = getCitationMeta(url);
      if (!meta) {
        ensureCitationMeta(url, client).catch(() => {});
        return;
      }
      if (meta.faviconDataUrl) {
        const bg = `url("${meta.faviconDataUrl}")`;
        if (fav.style.backgroundImage !== bg) fav.style.backgroundImage = bg;
      }
    });
  }, [client]);

  useEffect(() => {
    decorate();
  }, [blocks, decorate]);
  useEffect(() => subscribeCitations(decorate), [decorate]);

  // Smart Search reveal: scroll to & flash the block whose text matches the hit.
  useEffect(() => {
    if (!revealText) return;
    const root = rootRef.current;
    if (!root) return;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const needle = norm(revealText).slice(0, 60);
    if (!needle) {
      onRevealed?.();
      return;
    }
    const tryReveal = (): boolean => {
      for (const row of root.querySelectorAll<HTMLElement>(".nw-md > div")) {
        const text = norm(row.textContent ?? "");
        if (text && text.includes(needle)) {
          row.scrollIntoView({ block: "center", behavior: "smooth" });
          row.classList.add("nw-md-flash");
          window.setTimeout(() => row.classList.remove("nw-md-flash"), 1200);
          return true;
        }
      }
      return false;
    };
    if (tryReveal()) {
      onRevealed?.();
      return;
    }
    // Blocks may not be in the DOM on this tick — retry once, then give up.
    const t = window.setTimeout(() => {
      tryReveal();
      onRevealed?.();
    }, 90);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire only when revealText changes
  }, [revealText]);

  /* ------------------------- hover-card lifecycle ------------------------ */

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setHoverAnchor(null), HOVER_CLOSE_MS);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    function chipFrom(e: PointerEvent): HTMLElement | null {
      return (e.target as HTMLElement | null)?.closest?.(".rme-cite") ?? null;
    }
    function onOver(e: PointerEvent) {
      const chip = chipFrom(e);
      if (!chip) return;
      cancelClose();
      setHoverAnchor(chip);
    }
    function onOut(e: PointerEvent) {
      if (!chipFrom(e)) return;
      const to = e.relatedTarget as HTMLElement | null;
      if (to && (to.closest?.(".rme-cite") || to.closest?.(".nw-cite-card"))) return;
      scheduleClose();
    }
    root.addEventListener("pointerover", onOver);
    root.addEventListener("pointerout", onOut);
    return () => {
      root.removeEventListener("pointerover", onOver);
      root.removeEventListener("pointerout", onOut);
    };
  }, [cancelClose, scheduleClose]);

  return (
    <div className="nw-md" ref={rootRef}>
      {blocks.map((b) => (
        <Row
          key={b.id}
          block={b}
          register={(h) => {
            if (h) registry.current.set(b.id, h);
            else registry.current.delete(b.id);
          }}
          onText={(t) => setText(b.id, t)}
          onEnter={(caret) => splitBlock(b.id, caret)}
          onBackspaceAtStart={() => backspaceAtStart(b.id)}
          onDeleteAtEnd={() => deleteAtEnd(b.id)}
          onArrowUp={() => focusSibling(b.id, -1)}
          onArrowDown={() => focusSibling(b.id, 1)}
          onTab={(shift) => indentList(b.id, shift)}
          onWikiOpen={onWikiOpen}
          onCitePaste={enrichCitation}
          onPatch={(patch) => patchBlock(b.id, patch)}
        />
      ))}
      <div className="nw-md-tail" onClick={appendParagraph} aria-hidden />
      <CitationHoverCard
        anchor={hoverAnchor}
        client={client}
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
      />
    </div>
  );
}

/* ------------------------------ Block row ------------------------------ */

interface RowProps {
  block: Block;
  register: (h: InlineHandle | null) => void;
  onText: (t: string) => void;
  onEnter: (caret: number) => void;
  onBackspaceAtStart: () => void;
  onDeleteAtEnd: () => void;
  onArrowUp: () => boolean;
  onArrowDown: () => boolean;
  onTab: (shift: boolean) => boolean;
  onWikiOpen: (title: string) => void;
  onCitePaste: (url: string) => void;
  onPatch: (patch: Partial<Block>) => void;
}

const PLACEHOLDERS: Partial<Record<Block["type"], string>> = {
  paragraph: "Write something…",
  heading: "Heading",
  bulleted: "List item",
  numbered: "List item",
  quote: "Quote",
  task: "To-do",
};

function Row(props: RowProps) {
  const { block: b } = props;
  const handleRef = useRef<InlineHandle>(null);

  const text = (
    <InlineText
      ref={(h) => {
        handleRef.current = h;
        props.register(h);
      }}
      value={blockText(b) ?? ""}
      placeholder={PLACEHOLDERS[b.type]}
      onChange={props.onText}
      onEnter={props.onEnter}
      onBackspaceAtStart={props.onBackspaceAtStart}
      onDeleteAtEnd={props.onDeleteAtEnd}
      onArrowUp={props.onArrowUp}
      onArrowDown={props.onArrowDown}
      onTab={props.onTab}
      onWikiOpen={props.onWikiOpen}
      onCitePaste={props.onCitePaste}
    />
  );

  switch (b.type) {
    case "heading":
      return <div className={`nw-md-h h${Math.min(b.level, 3)}`}>{text}</div>;
    case "bulleted":
      return (
        <div className="nw-md-bullet" style={{ marginLeft: b.indent * 6 }}>
          <span className="nw-md-dot">•</span>
          {text}
        </div>
      );
    case "numbered":
      return (
        <div className="nw-md-num" style={{ marginLeft: b.indent * 6 }}>
          <span className="nw-md-numlabel">{b.number}.</span>
          {text}
        </div>
      );
    case "quote":
      return <div className="nw-md-quote">{text}</div>;
    case "task":
      return (
        <div className={"nw-md-task" + (b.checked ? " is-checked" : "")}>
          <button
            className="nw-md-check"
            onClick={() => props.onPatch({ checked: !b.checked } as Partial<Block>)}
            aria-label={b.checked ? "Mark incomplete" : "Mark complete"}
          >
            {b.checked && (
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l4 4 10-10" />
              </svg>
            )}
          </button>
          {text}
        </div>
      );
    case "divider":
      return <hr className="nw-md-hr" />;
    case "code":
      return <pre className="nw-md-code">{(b as CodeBlock).code}</pre>;
    default:
      return <div className="nw-md-p">{text}</div>;
  }
}
