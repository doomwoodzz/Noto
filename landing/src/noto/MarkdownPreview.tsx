import { CheckSquare, Square } from "lucide-react";
import type { VaultFile } from "./types";

interface MarkdownPreviewProps {
  file: VaultFile | null;
  onWikiOpen: (title: string) => void;
  /** Text the AI is streaming into the note (already partially revealed). */
  aiText?: string;
  /** True while the AI is still typing — drives the white sheen sweep. */
  aiTyping?: boolean;
}

export function MarkdownPreview({ file, onWikiOpen, aiText = "", aiTyping = false }: MarkdownPreviewProps) {
  if (!file) {
    return <div className="noto-empty noto-preview"><div>No note selected.</div></div>;
  }

  const lines = file.content.split("\n");
  const renderable: string[] = [];
  let droppedFirstH1 = false;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!droppedFirstH1 && /^#\s+/.test(trimmed)) {
      droppedFirstH1 = true;
      continue;
    }
    renderable.push(trimmed);
  }

  return (
    <div className="noto-preview">
      <h1 className="noto-preview-title">{file.title}</h1>
      <div className="noto-preview-body">
        {renderable.map((line, i) => <Line key={i} text={line} onWikiOpen={onWikiOpen} />)}
        {aiText && <AIBlock text={aiText} typing={aiTyping} onWikiOpen={onWikiOpen} />}
      </div>
    </div>
  );
}

function AIBlock({ text, typing, onWikiOpen }: { text: string; typing: boolean; onWikiOpen: (title: string) => void }) {
  const aiLines = text.split("\n");
  return (
    <div className={"noto-ai-block" + (typing ? " is-typing" : "")}>
      <div className="noto-ai-tag">
        <span className="noto-ai-spark" />
        Written by Lecture AI
      </div>
      <div className="noto-ai-text">
        {aiLines.map((line, i) => <Line key={i} text={line.trim()} onWikiOpen={onWikiOpen} />)}
        {typing && <span className="noto-ai-caret" aria-hidden="true" />}
      </div>
      {typing && <span className="noto-ai-sheen" aria-hidden="true" />}
    </div>
  );
}

function Line({ text, onWikiOpen }: { text: string; onWikiOpen: (title: string) => void }) {
  if (text === "") return <div style={{ height: 4 }} />;
  if (text === "---") return <hr className="noto-hr" />;

  const heading = text.match(/^(#{1,6})\s+(.*)$/);
  if (heading) {
    const level = heading[1].length;
    const content = heading[2];
    if (level === 1) return <h2 className="noto-h1">{content}</h2>;
    if (level === 2) return <h3 className="noto-h2">{content}</h3>;
    return <h4 className="noto-h3">{content}</h4>;
  }

  const cb = text.match(/^- \[( |x|X)\] (.*)$/);
  if (cb) {
    const checked = cb[1].toLowerCase() === "x";
    return (
      <div className="noto-cb">
        {checked
          ? <CheckSquare size={14} strokeWidth={1.7} color="var(--color-accent)" />
          : <Square size={14} strokeWidth={1.7} color="var(--color-muted)" />}
        <Inline text={cb[2]} onWikiOpen={onWikiOpen} />
      </div>
    );
  }

  if (text.startsWith("- ")) {
    return (
      <div className="noto-bullet">
        <span className="noto-bullet-dash">-</span>
        <Inline text={text.slice(2)} onWikiOpen={onWikiOpen} />
      </div>
    );
  }

  if (text.startsWith(">")) {
    return (
      <div className="noto-callout">
        <Inline text={text.replace(/^>\s*/, "")} onWikiOpen={onWikiOpen} />
      </div>
    );
  }

  return <p className="noto-p"><Inline text={text} onWikiOpen={onWikiOpen} /></p>;
}

function Inline({ text, onWikiOpen }: { text: string; onWikiOpen: (title: string) => void }) {
  const parts: { kind: "text" | "wiki"; value: string }[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: "text", value: text.slice(last, m.index) });
    parts.push({ kind: "wiki", value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });

  return (
    <span className="noto-inline">
      {parts.map((p, i) =>
        p.kind === "wiki" ? (
          <button key={i} className="noto-wiki" onClick={() => onWikiOpen(p.value)}>
            [[{p.value}]]
          </button>
        ) : (
          <span key={i}>{p.value}</span>
        )
      )}
    </span>
  );
}
