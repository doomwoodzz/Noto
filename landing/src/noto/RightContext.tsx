import type { FileMetadata, AIMemory } from "./types";

interface RightContextProps {
  metadata: FileMetadata | undefined;
  aiMemory: AIMemory;
}

export function RightContext({ metadata, aiMemory }: RightContextProps) {
  if (!metadata) {
    return (
      <aside className="noto-context">
        <div className="noto-label">Metadata</div>
        <div className="noto-empty">No active note</div>
      </aside>
    );
  }

  return (
    <aside className="noto-context">
      <Section title="Metadata">
        <div className="noto-path">{metadata.path}</div>
        <div className="noto-edited">Edited {metadata.updatedAt}</div>
        <div className="noto-stats">
          <Stat label="Words" value={metadata.wordCount} />
          <Stat label="Backlinks" value={metadata.backlinks.length} />
          <Stat label="Links" value={metadata.outgoingLinks.length} />
        </div>
      </Section>

      <Section title="Outline">
        <List values={metadata.headings} empty="No headings yet." />
      </Section>

      <Section title="Backlinks">
        <List values={metadata.backlinks} empty="No backlinks yet." />
      </Section>

      <Section title="Outgoing Links">
        <List values={metadata.outgoingLinks} empty="No outgoing links." />
      </Section>

      <Section title="AI Memory">
        {!aiMemory || aiMemory.concepts.length === 0 ? (
          <div className="noto-memory-empty">Visible after you press Record.</div>
        ) : (
          <div className="noto-memory">
            <MemoryGroup title="Concepts" values={aiMemory.concepts} />
            <MemoryGroup title="Linked Notes" values={aiMemory.linked.map(v => `[[${v}]]`)} />
          </div>
        )}
      </Section>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="noto-section">
      <div className="noto-label">{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="noto-stat">
      <div className="noto-stat-l">{label}</div>
      <div className="noto-stat-v">{value}</div>
    </div>
  );
}

function List({ values, empty }: { values: string[]; empty: string }) {
  if (!values || values.length === 0) {
    return <div className="noto-empty-line">{empty}</div>;
  }
  return (
    <div className="noto-list">
      {values.map((v, i) => <div key={i} className="noto-card-row">{v}</div>)}
    </div>
  );
}

function MemoryGroup({ title, values }: { title: string; values: string[] }) {
  if (!values || values.length === 0) return null;
  return (
    <div>
      <div className="noto-memory-title">{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
        {values.map((v, i) => <div key={i} className="noto-card-row">{v}</div>)}
      </div>
    </div>
  );
}
