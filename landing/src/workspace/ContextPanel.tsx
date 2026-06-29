import type { FileMetadata } from "../noto-core";

interface Props {
  meta: FileMetadata | undefined;
  onOpenTitle: (title: string) => void;
  onOpenAiChanges?: () => void;
}

export function ContextPanel({ meta, onOpenTitle, onOpenAiChanges }: Props) {
  if (!meta) {
    return (
      <aside className="nw-context">
        <div className="nw-context-label">Context</div>
        <div className="nw-empty">No active note</div>
      </aside>
    );
  }

  return (
    <aside className="nw-context">
      <div className="nw-context-label">Context</div>
      <div className="nw-context-title">{meta.title}</div>
      <div className="nw-context-path">{meta.path}</div>
      {onOpenAiChanges && (
        <button className="nw-act-link" style={{ marginTop: 8 }} onClick={onOpenAiChanges}>
          AI changes
        </button>
      )}

      <div className="nw-context-stats">
        <Stat label="Words" value={meta.wordCount} />
        <Stat label="Links" value={meta.outgoingLinks.length} />
        <Stat label="Backlinks" value={meta.backlinks.length} />
      </div>

      <Group title="Outline">
        <List values={meta.headings} empty="No headings yet." />
      </Group>
      <Group title="Backlinks">
        <List values={meta.backlinks} empty="No backlinks yet." onClick={onOpenTitle} />
      </Group>
      <Group title="Outgoing links">
        <List values={meta.outgoingLinks} empty="No outgoing links." onClick={onOpenTitle} />
      </Group>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="nw-context-stat">
      <div className="nw-context-stat-v">{value}</div>
      <div className="nw-context-stat-l">{label}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="nw-context-group">
      <div className="nw-context-grouplabel">{title}</div>
      {children}
    </div>
  );
}

function List({
  values,
  empty,
  onClick,
}: {
  values: string[];
  empty: string;
  onClick?: (v: string) => void;
}) {
  if (!values || values.length === 0) return <div className="nw-context-empty">{empty}</div>;
  return (
    <div className="nw-context-list">
      {values.map((v, i) => (
        <div
          key={i}
          className={"nw-context-chip" + (onClick ? " is-link" : "")}
          onClick={onClick ? () => onClick(v) : undefined}
        >
          {v}
        </div>
      ))}
    </div>
  );
}
