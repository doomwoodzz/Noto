import { useEffect } from "react";
import { Calendar, Flag, User, Check, X } from "lucide-react";
import { TAGS, type RoadmapCard } from "./roadmapData";

export function CardModal({ card, onClose }: { card: RoadmapCard; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const tag = TAGS[card.tag];
  const doneCount = card.checklist.filter((c) => c.done).length;

  return (
    <div className="cs-modal-scrim" onClick={onClose}>
      <div className="cs-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={card.title}>
        <div className="cs-modal-top">
          <div className="cs-modal-headings">
            <div className="cs-modal-tags">
              <span className="cs-tag">
                <span className="cs-tag-dot" style={{ "--tag-color": tag.color } as React.CSSProperties} />
                {tag.label}
              </span>
              <span className="cs-tag">
                <span className="cs-tag-dot" style={{ "--tag-color": "var(--page-muted-soft)" } as React.CSSProperties} />
                {card.status}
              </span>
            </div>
            <h2 className="cs-modal-title">{card.title}</h2>
          </div>
          <button className="cs-modal-close" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={1.7} />
          </button>
        </div>

        <div className="cs-modal-body">
          <div>
            {card.desc.map((p, i) => <p className="cs-modal-desc" key={i}>{p}</p>)}
          </div>

          <div>
            <div className="cs-modal-sectitle">Progress · {doneCount}/{card.checklist.length}</div>
            <ul className="cs-check">
              {card.checklist.map((c, i) => (
                <li key={i} className={c.done ? "done" : ""}>
                  <span className="cs-check-box">{c.done && <Check size={12} strokeWidth={2.4} />}</span>
                  <span className="lbl">{c.label}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="cs-modal-meta">
            <div className="cs-modal-meta-item">
              <span className="k">Target</span>
              <span className="v"><Calendar size={14} strokeWidth={1.7} style={{ color: "var(--page-muted)" }} />{card.target}</span>
            </div>
            <div className="cs-modal-meta-item">
              <span className="k">Status</span>
              <span className="v"><Flag size={14} strokeWidth={1.7} style={{ color: "var(--page-muted)" }} />{card.status}</span>
            </div>
            <div className="cs-modal-meta-item">
              <span className="k">Owner</span>
              <span className="v"><User size={14} strokeWidth={1.7} style={{ color: "var(--page-muted)" }} />{card.author}</span>
            </div>
          </div>

          <div>
            <div className="cs-modal-sectitle">Linked</div>
            <div className="cs-modal-links">
              {card.links.map((l, i) => <span className="cs-modal-link" key={i}>[[{l}]]</span>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
