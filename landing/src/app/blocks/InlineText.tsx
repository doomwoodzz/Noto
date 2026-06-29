import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { inlineHtml, isUrl, placeholderCite } from "../liveMarkdown";
import { applyInlineStyle, type InlineStyle } from "../markdownEditor";
import {
  caretRect,
  focusRegion,
  getCaretOffset,
  getSelectionRange,
  isCaretOnFirstLine,
  isCaretOnLastLine,
  setCaretOffset,
  setSelectionRange,
  textLength,
} from "./caret";

/** Inline formatting actions the editor can apply to a selection. */
export type FormatKind = "bold" | "italic" | "underline" | "code" | "link";

export interface InlineHandle {
  focus(at?: "start" | "end" | number): void;
  format(kind: FormatKind): void;
  el(): HTMLDivElement | null;
}

export interface SlashInfo {
  query: string;
  rect: DOMRect | null;
}

export type SlashKey = "ArrowUp" | "ArrowDown" | "Enter" | "Escape" | "Tab";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  spellCheck?: boolean;
  slashActive?: boolean;
  onEnter?: (caret: number) => void;
  onBackspaceAtStart?: () => void;
  onDeleteAtEnd?: () => void;
  onArrowUp?: () => boolean;
  onArrowDown?: () => boolean;
  onTab?: (shift: boolean) => boolean;
  onSlashChange?: (info: SlashInfo | null) => void;
  onSlashKey?: (key: SlashKey) => void;
  onWikiOpen?: (title: string) => void;
  /** Fired after a pasted URL is inserted as a placeholder citation token. */
  onCitePaste?: (url: string) => void;
  onFocus?: () => void;
}

/** The query after a `/` if the caret is in a slash context, else null. */
function detectSlash(value: string, caret: number): string | null {
  const sub = value.slice(0, caret);
  const slash = sub.lastIndexOf("/");
  if (slash === -1) return null;
  if (slash !== 0 && !/\s/.test(value[slash - 1])) return null; // must start a word
  const query = value.slice(slash + 1, caret);
  if (/\s/.test(query)) return null; // a space dismisses the menu
  return query;
}

/**
 * A single block's inline-editable text region. Renders Markdown inline
 * formatting (bold/italic/underline, `[[wiki]]` pills) live, keeping the
 * Markdown string as the value. Bubbles structural intents (split, merge,
 * navigate, slash) up to the block editor.
 */
export const InlineText = forwardRef<InlineHandle, Props>(function InlineText(
  {
    value,
    onChange,
    placeholder,
    className,
    spellCheck = true,
    slashActive,
    onEnter,
    onBackspaceAtStart,
    onDeleteAtEnd,
    onArrowUp,
    onArrowDown,
    onTab,
    onSlashChange,
    onSlashKey,
    onWikiOpen,
    onCitePaste,
    onFocus,
  },
  ref,
) {
  const elRef = useRef<HTMLDivElement>(null);
  const lastValue = useRef(value);
  const composing = useRef(false);

  function applyFormat(kind: FormatKind) {
    const el = elRef.current;
    if (!el) return;
    const range = getSelectionRange(el);
    if (!range || range.start === range.end) return;
    const content = el.textContent ?? "";
    if (kind === "bold" || kind === "italic" || kind === "underline") {
      const r = applyInlineStyle(kind, { content, start: range.start, end: range.end });
      applyValue(el, r.content, () => setSelectionRange(el, r.start, r.end));
      return;
    }
    const [open, close] = kind === "code" ? ["`", "`"] : ["[[", "]]"];
    const selected = content.slice(range.start, range.end);
    const next = content.slice(0, range.start) + open + selected + close + content.slice(range.end);
    applyValue(el, next, () =>
      setSelectionRange(el, range.start + open.length, range.start + open.length + selected.length),
    );
  }

  useImperativeHandle(ref, () => ({
    focus(at = "end") {
      if (elRef.current) focusRegion(elRef.current, at);
    },
    format: applyFormat,
    el: () => elRef.current,
  }));

  // Render on mount and whenever the value changes from outside our own edits.
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (value === lastValue.current && el.innerHTML !== "") return;
    el.innerHTML = inlineHtml(value);
    lastValue.current = value;
  }, [value]);

  function applyValue(el: HTMLDivElement, next: string, place: () => void) {
    lastValue.current = next;
    onChange(next);
    el.innerHTML = inlineHtml(next);
    place();
  }

  function handleInput() {
    const el = elRef.current;
    if (!el || composing.current) return;
    const caret = getCaretOffset(el);
    const next = el.textContent ?? "";
    lastValue.current = next;
    onChange(next);
    el.innerHTML = inlineHtml(next);
    if (caret != null) setCaretOffset(el, caret);
    if (onSlashChange) {
      const c = caret ?? next.length;
      const q = detectSlash(next, c);
      onSlashChange(q == null ? null : { query: q, rect: caretRect() });
    }
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const el = elRef.current;
    if (!el) return;

    if (slashActive && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter" || e.key === "Escape" || e.key === "Tab")) {
      e.preventDefault();
      onSlashKey?.(e.key);
      return;
    }

    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && (key === "b" || key === "i" || key === "u")) {
      e.preventDefault();
      const range = getSelectionRange(el) ?? { start: textLength(el), end: textLength(el) };
      const style: InlineStyle = key === "b" ? "bold" : key === "i" ? "italic" : "underline";
      const r = applyInlineStyle(style, { content: el.textContent ?? "", start: range.start, end: range.end });
      applyValue(el, r.content, () => setSelectionRange(el, r.start, r.end));
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      onEnter?.(getCaretOffset(el) ?? textLength(el));
      return;
    }
    if (e.key === "Backspace") {
      const range = getSelectionRange(el);
      if (range && range.start === 0 && range.end === 0) {
        e.preventDefault();
        onBackspaceAtStart?.();
      }
      return;
    }
    if (e.key === "Delete") {
      const range = getSelectionRange(el);
      const len = textLength(el);
      if (range && range.start === len && range.end === len) {
        e.preventDefault();
        onDeleteAtEnd?.();
      }
      return;
    }
    if (e.key === "Tab") {
      if (onTab && onTab(e.shiftKey)) e.preventDefault();
      return;
    }
    if (e.key === "ArrowUp") {
      if (isCaretOnFirstLine(el) && onArrowUp && onArrowUp()) e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") {
      if (isCaretOnLastLine(el) && onArrowDown && onArrowDown()) e.preventDefault();
      return;
    }
  }

  // Pasting a bare URL becomes an inline citation chip instead of raw text.
  function handlePaste(e: ReactClipboardEvent<HTMLDivElement>) {
    const el = elRef.current;
    if (!el) return;
    const pasted = e.clipboardData.getData("text/plain");
    if (!isUrl(pasted)) return; // any non-URL paste keeps default behavior
    e.preventDefault();
    const url = pasted.trim();
    const token = placeholderCite(url);
    const range = getSelectionRange(el) ?? { start: textLength(el), end: textLength(el) };
    const content = el.textContent ?? "";
    const next = content.slice(0, range.start) + token + content.slice(range.end);
    applyValue(el, next, () => setCaretOffset(el, range.start + token.length));
    onCitePaste?.(url);
  }

  function handleClick(e: ReactMouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const cite = target.closest(".rme-cite");
    if (cite) {
      e.preventDefault();
      const url = cite.getAttribute("data-url");
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    const pill = target.closest(".rme-pill");
    if (pill) {
      e.preventDefault();
      const title = pill.getAttribute("data-title") ?? "";
      if (title) onWikiOpen?.(title);
    }
  }

  return (
    <div
      ref={elRef}
      className={"blk-text" + (className ? " " + className : "")}
      contentEditable
      suppressContentEditableWarning
      spellCheck={spellCheck}
      role="textbox"
      aria-multiline="false"
      data-placeholder={placeholder}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      onPaste={handlePaste}
      onFocus={onFocus}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        handleInput();
      }}
    />
  );
});
