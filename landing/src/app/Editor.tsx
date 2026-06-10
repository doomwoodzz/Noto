import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Trash2 } from "lucide-react";
import { MarkdownPreview } from "../noto/MarkdownPreview";
import { applyInlineStyle, handleEnter, handleTab, type EditState, type InlineStyle } from "./markdownEditor";
import type { VaultFile } from "../noto-core";
import type { SaveStatus } from "./useVault";

interface NoteEditorProps {
  file: VaultFile;
  editMode: boolean;
  setEditMode: (on: boolean) => void;
  onContentChange: (content: string) => void;
  onRename: (title: string) => void;
  onWikiOpen: (title: string) => void;
  onDelete: () => void;
  saveStatus: SaveStatus;
}

const SAVE_LABEL: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed",
};

export function NoteEditor({
  file,
  editMode,
  setEditMode,
  onContentChange,
  onRename,
  onWikiOpen,
  onDelete,
  saveStatus,
}: NoteEditorProps) {
  // Demo MarkdownPreview wants its own file shape (updatedAt is a display
  // string there); only title/content are read, so a light adapter is enough.
  const previewFile = { ...file, updatedAt: "" };

  return (
    <div className="app-note">
      <div className="app-note-head">
        <input
          className="app-note-title"
          value={file.title}
          onChange={(e) => onRename(e.target.value)}
          spellCheck={false}
          aria-label="Note title"
        />
        <div className="app-note-actions">
          <span className={"app-save-status is-" + saveStatus}>{SAVE_LABEL[saveStatus]}</span>
          <button className="noto-btn noto-btn-ghost" onClick={onDelete} aria-label="Delete note">
            <Trash2 size={13} strokeWidth={1.7} />
          </button>
          <div className="noto-segmented app-edit-toggle">
            <button
              className={"noto-segment" + (editMode ? " is-active" : "")}
              onClick={() => setEditMode(true)}
            >
              Edit
            </button>
            <button
              className={"noto-segment" + (!editMode ? " is-active" : "")}
              onClick={() => setEditMode(false)}
            >
              Preview
            </button>
          </div>
        </div>
      </div>

      {editMode ? (
        <MarkdownTextarea key={file.id} content={file.content} onChange={onContentChange} />
      ) : (
        <MarkdownPreview file={previewFile} onWikiOpen={onWikiOpen} />
      )}
    </div>
  );
}

function MarkdownTextarea({ content, onChange }: { content: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSel = useRef<{ start: number; end: number } | null>(null);
  const [, force] = useState(0);

  // After a helper rewrites the value, restore the intended selection.
  useLayoutEffect(() => {
    const sel = pendingSel.current;
    const el = ref.current;
    if (sel && el) {
      el.selectionStart = sel.start;
      el.selectionEnd = sel.end;
      pendingSel.current = null;
    }
  });

  function stateFrom(el: HTMLTextAreaElement): EditState {
    return { content: el.value, start: el.selectionStart, end: el.selectionEnd };
  }

  function apply(next: EditState) {
    pendingSel.current = { start: next.start, end: next.end };
    onChange(next.content);
    force((n) => n + 1); // ensure the layout effect runs even if content is identical
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (mod && (key === "b" || key === "i" || key === "u")) {
      e.preventDefault();
      const style: InlineStyle = key === "b" ? "bold" : key === "i" ? "italic" : "underline";
      apply(applyInlineStyle(style, stateFrom(el)));
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !mod) {
      e.preventDefault();
      apply(handleEnter(stateFrom(el)));
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      apply(handleTab(stateFrom(el), e.shiftKey));
    }
  }

  return (
    <textarea
      ref={ref}
      className="app-textarea"
      value={content}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      spellCheck
      placeholder="Start writing… use [[wiki links]] to connect notes."
    />
  );
}
