import { Inbox, ChevronsRight, Zap, CircleCheck, ArrowRight } from "lucide-react";
import { COLUMNS, TAGS, type RoadmapCard, type RoadmapColumn } from "./roadmapData";

function ColumnIcon({ name }: { name: RoadmapColumn["icon"] }) {
  switch (name) {
    case "inbox": return <Inbox size={12} strokeWidth={1.7} />;
    case "forward": return <ChevronsRight size={12} strokeWidth={1.7} />;
    case "bolt": return <Zap size={12} strokeWidth={1.7} />;
    case "check-circle": return <CircleCheck size={12} strokeWidth={1.7} />;
  }
}

function Card({ card, onOpen }: { card: RoadmapCard; onOpen: (c: RoadmapCard) => void }) {
  const tag = TAGS[card.tag];
  return (
    <button className="cs-card" onClick={() => onOpen(card)}>
      <h3 className="cs-card-title">{card.title}</h3>
      <div className="cs-card-meta">
        <span className="cs-tag">
          <span className="cs-tag-dot" style={{ "--tag-color": tag.color } as React.CSSProperties} />
          {tag.label}
        </span>
        <span className="cs-card-open">
          Read more
          <ArrowRight size={13} strokeWidth={1.7} />
        </span>
      </div>
    </button>
  );
}

export function Roadmap({ onOpen }: { onOpen: (c: RoadmapCard) => void }) {
  return (
    <section className="cs-roadmap" id="roadmap">
      <div className="l-shell">
        <div className="cs-roadmap-head">
          <div className="l-section-head" style={{ marginBottom: 0 }}>
            <div className="l-section-label">
              <span className="l-section-label-bar" /> Roadmap
            </div>
            <h2 className="l-section-title">What's shipping, and what's next.</h2>
          </div>
          <div className="right">
            <ArrowRight size={14} strokeWidth={1.7} style={{ color: "var(--page-blue)" }} />
            Tap any card to read the details.
          </div>
        </div>

        <div className="cs-board">
          {COLUMNS.map((col) => (
            <div className="cs-col" key={col.key} style={{ "--col-accent": col.color } as React.CSSProperties}>
              <div className="cs-col-head">
                <span className="cs-col-dot"><ColumnIcon name={col.icon} /></span>
                <span className="cs-col-name">{col.name}</span>
                <span className="cs-col-count">{col.cards.length}</span>
              </div>
              <div className="cs-col-list">
                {col.cards.map((card) => (
                  <Card key={card.id} card={card} onOpen={onOpen} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
