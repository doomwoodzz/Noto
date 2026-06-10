import {
  Folder, SquarePen, Link as LinkIcon, Waypoints, Command, Mic,
  Brain, Lock, Search, Hash, ListChecks, Moon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface OverviewItem {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  desc: string;
  href: string;
}

const ITEMS: OverviewItem[] = [
  {
    icon: Folder, eyebrow: "Local Vault", title: "Plain .md on disk",
    desc: "Real folders, real files. Open them in any editor, sync them any way you like.",
    href: "#vault",
  },
  {
    icon: SquarePen, eyebrow: "Markdown Editor", title: "Native macOS editing",
    desc: "An NSTextView editor with inline formatting, list continuation, and smart tabs.",
    href: "#editor",
  },
  {
    icon: LinkIcon, eyebrow: "Wiki Links", title: "Two square brackets",
    desc: "Type [[Title]] and the link is live. Backlinks are generated, never authored.",
    href: "#wiki",
  },
  {
    icon: Waypoints, eyebrow: "Knowledge Web", title: "A graph of your ideas",
    desc: "Every wiki link is an edge. Filter to local, lecture-only, or orphan notes.",
    href: "#graph",
  },
  {
    icon: Command, eyebrow: "Command Menu", title: "Everything by keystroke",
    desc: "⌘K to jump notes, open the graph, toggle the recorder, or insert a backlink.",
    href: "#palette",
  },
  {
    icon: Mic, eyebrow: "Lecture AI", title: "Listen, transcribe, organize",
    desc: "Press record. Lecture AI follows along and drafts structured notes for you.",
    href: "#lecture-ai",
  },
  {
    icon: Brain, eyebrow: "AI Memory", title: "What you just heard",
    desc: "Concepts and linked notes from the last recording, surfaced in the context panel.",
    href: "#lecture-ai",
  },
  {
    icon: Search, eyebrow: "Search", title: "Find anything fast",
    desc: "Live vault search across every note, heading, and tag as you type.",
    href: "#workspace",
  },
  {
    icon: Hash, eyebrow: "Tags", title: "#organize lightly",
    desc: "Inline #tags are parsed out of your prose — without polluting your headings.",
    href: "#workspace",
  },
  {
    icon: ListChecks, eyebrow: "Checklists", title: "- [ ] track tasks",
    desc: "Markdown checkboxes render as live checklists you can tick off in place.",
    href: "#workspace",
  },
  {
    icon: Lock, eyebrow: "Local-first", title: "Consent by design",
    desc: "Recording only starts when you press record. Nothing leaves your Mac silently.",
    href: "#privacy",
  },
  {
    icon: Moon, eyebrow: "Themes", title: "Light & dark",
    desc: "A paper-warm light mode and a focused dark mode, matched to the native app.",
    href: "#platform",
  },
];

export function FeatureOverview() {
  return (
    <section className="l-section l-section-tight" id="overview">
      <div className="l-shell">
        <div className="l-section-head">
          <div className="l-section-label">
            <span className="l-section-label-bar" /> Every capability
          </div>
          <h2 className="l-section-title">One workspace. Every capability.</h2>
          <p className="l-section-sub">
            Noto is a serious Mac productivity tool, not a toy. Here is everything it
            does — each one a real feature in the app, not a roadmap promise.
          </p>
        </div>

        <div className="f-ov-grid">
          {ITEMS.map((it) => {
            const Icn = it.icon;
            return (
              <a key={it.eyebrow} href={it.href} className="f-ov-card">
                <span className="f-ov-icn"><Icn size={16} strokeWidth={1.7} /></span>
                <div className="f-ov-eyebrow">{it.eyebrow}</div>
                <div className="f-ov-title">{it.title}</div>
                <p className="f-ov-desc">{it.desc}</p>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
