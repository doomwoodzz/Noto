import type { ReactNode } from "react";
import { useReveal } from "../useReveal";
import { Check, SquarePen, Mic, Keyboard, Sparkles } from "../icons";

const CARDS: { Icon: typeof SquarePen; title: string; desc: ReactNode }[] = [
  { Icon: SquarePen, title: "Capture a thought", desc: <>Create your first note by pressing <kbd>N</kbd>.</> },
  { Icon: Mic, title: "Record a lecture", desc: <>Let Noto listen and link concepts with <kbd>⌃⌘M</kbd>.</> },
  { Icon: Keyboard, title: "Learn the shortcuts", desc: <>See every keyboard command with <kbd>?</kbd>.</> },
];

export function AllSetScreen({ onOpen, onBack }: { onOpen: () => void; onBack: () => void }) {
  const reveal = useReveal();
  return (
    <div className={"ob-screen" + reveal}>
      <span className="ob-allset-check"><Check size={30} strokeWidth={2.4} /></span>
      <h1 className="ob-title">You're all set</h1>
      <p className="ob-sub">Your vault is ready. When you're listening, Noto remembers — go explore.</p>

      <div className="ob-cards">
        {CARDS.map((c) => (
          <div className="ob-card" key={c.title}>
            <span className="ob-card-icn"><c.Icon size={18} /></span>
            <h3 className="ob-card-title">{c.title}</h3>
            <p className="ob-card-desc">{c.desc}</p>
          </div>
        ))}
      </div>

      <div className="ob-panel" style={{ marginTop: 34 }}>
        <button className="ob-btn ob-btn-blue" onClick={onOpen}>
          <Sparkles size={18} />
          Open Noto
        </button>
        <button className="ob-btn ob-btn-quiet" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
