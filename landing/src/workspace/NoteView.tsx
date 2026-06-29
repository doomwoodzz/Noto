import { useEffect, useRef, useState } from "react";
import type { VaultFile, FileMetadata } from "../noto-core";
import { Icon } from "./icons";
import { LiveMarkdownEditor } from "./LiveMarkdownEditor";
import type { SaveStatus } from "./types";

interface Props {
  file: VaultFile;
  meta: FileMetadata | undefined;
  saveStatus: SaveStatus;
  onContentChange: (content: string) => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onDelete: () => void;
  onWikiOpen: (title: string) => void;
  onWikiCreate: (title: string) => void;
  /** When set, scroll to & flash the passage containing this text (from Smart Search). */
  revealText?: string;
  onRevealed?: () => void;
}

const RENAME_DEBOUNCE_MS = 500;

const SAVE_LABEL: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed",
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The note's body is everything after the leading `# Title` line — the title
 * lives in the header (editable). We strip it for the editor and reattach it on
 * every change so `file.content` stays canonical Markdown.
 */
function splitBody(content: string): string {
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

export function NoteView({
  file,
  meta,
  saveStatus,
  onContentChange,
  onRename,
  onTogglePin,
  onDelete,
  onWikiOpen,
  onWikiCreate,
  revealText,
  onRevealed,
}: Props) {
  const body = splitBody(file.content);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="nw-note">
      <div className="nw-note-inner">
        <div className="nw-note-head">
          <span className="nw-note-path">{file.path}</span>
          <span style={{ flex: 1 }} />
          <span className={"nw-save is-" + saveStatus}>{SAVE_LABEL[saveStatus]}</span>
          <button
            className={"nw-pin" + (file.pinned ? " is-on" : "")}
            onClick={onTogglePin}
            title={file.pinned ? "Unpin" : "Pin"}
          >
            <Icon name="pin" size={13} stroke={1.7} />
            <span>{file.pinned ? "Pinned" : "Pin"}</span>
          </button>
          <div className="nw-note-menu-wrap">
            <button className="nw-icon-btn" onClick={() => setMenuOpen((o) => !o)} title="More" aria-label="More actions">
              <Icon name="more" size={16} stroke={1.7} />
            </button>
            {menuOpen && (
              <>
                <div className="nw-menu-scrim" onClick={() => setMenuOpen(false)} />
                <div className="nw-menu" role="menu">
                  <button
                    className="nw-menu-item is-danger"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                  >
                    <Icon name="trash" size={14} stroke={1.7} />
                    <span>Delete note</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <NoteTitle title={file.title} onRename={onRename} />

        <div className="nw-note-meta">
          <span>Edited {formatDate(file.updatedAt)}</span>
          <span>{meta?.wordCount ?? 0} words</span>
          <span>{meta?.backlinks.length ?? 0} backlinks</span>
        </div>

        <LiveMarkdownEditor
          content={body}
          onChange={(newBody) => onContentChange(`# ${file.title}\n\n${newBody}`)}
          onWikiOpen={onWikiOpen}
          onWikiCreate={onWikiCreate}
          revealText={revealText}
          onRevealed={onRevealed}
        />
      </div>
    </div>
  );
}

/** Inline-editable H1. Local draft + debounced commit so typing never fights. */
function NoteTitle({ title, onRename }: { title: string; onRename: (t: string) => void }) {
  const [draft, setDraft] = useState(title);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    onRename(value);
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <input
      className="nw-note-title"
      value={draft}
      onChange={(e) => {
        const value = e.target.value;
        setDraft(value);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(value), RENAME_DEBOUNCE_MS);
      }}
      onBlur={() => commit(draft)}
      spellCheck={false}
      aria-label="Note title"
      placeholder="Untitled"
    />
  );
}
