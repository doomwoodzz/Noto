import {
  Search, Hash, ListChecks, PanelsTopLeft, ListTree, Type, PanelRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Essential {
  icon: LucideIcon;
  title: string;
  desc: string;
}

const ESSENTIALS: Essential[] = [
  { icon: Search, title: "Vault search", desc: "Filter every note, heading, and tag live as you type." },
  { icon: Hash, title: "Inline tags", desc: "#tags are parsed from your prose, never from headings." },
  { icon: ListChecks, title: "Checklists", desc: "- [ ] and - [x] render as checkboxes you can tick." },
  { icon: PanelsTopLeft, title: "Tabbed notes", desc: "Keep several notes open and switch without losing place." },
  { icon: ListTree, title: "Heading outline", desc: "Headings are extracted into a jump-to outline per note." },
  { icon: Type, title: "Live word count", desc: "Word counts ignore markup, so the number is the prose." },
  { icon: PanelRight, title: "Context panel", desc: "Backlinks and AI memory share the right-hand panel." },
];

export function WorkspaceEssentials() {
  return (
    <section className="l-section l-section-tight" id="workspace">
      <div className="l-shell">
        <div className="l-section-head">
          <div className="l-section-label">
            <span className="l-section-label-bar" /> Workspace essentials
          </div>
          <h2 className="l-section-title">The small things you'd miss.</h2>
          <p className="l-section-sub">
            The details that turn a text editor into a place you think — all derived
            from the same Markdown, all instant.
          </p>
        </div>

        <div className="f-ess-grid">
          {ESSENTIALS.map((e) => {
            const Icn = e.icon;
            return (
              <div key={e.title} className="f-ess-card">
                <span className="f-ess-icn"><Icn size={15} strokeWidth={1.7} /></span>
                <div className="f-ess-title">{e.title}</div>
                <p className="f-ess-desc">{e.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
