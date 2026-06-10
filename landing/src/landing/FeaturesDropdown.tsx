// Mega-dropdown for the "Features" nav link.
// Layout: 3 columns × 2 rows of feature taglines on the left,
// a "Featured" rail on the right with a live AI Recorder card.
import { Mic, Waypoints, Link as LinkIcon, Command, Folder, SquarePen, ArrowUpRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { VisRecorder } from "./bento/VisRecorder";

interface FeaturesDropdownProps {
  open: boolean;
  // Bubbled from the wrapper so hovering inside the panel keeps it open.
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

interface FeatureItem {
  eyebrow: string;
  title: string;
  href: string;
  icon: LucideIcon;
}

const FEATURES: FeatureItem[] = [
  {
    eyebrow: "Lecture AI",
    title: "Listen, transcribe, organize",
    href: "/features.html#lecture-ai",
    icon: Mic,
  },
  {
    eyebrow: "Knowledge Web",
    title: "Watch ideas connect",
    href: "/features.html#graph",
    icon: Waypoints,
  },
  {
    eyebrow: "Wiki Links",
    title: "Two square brackets",
    href: "/features.html#wiki",
    icon: LinkIcon,
  },
  {
    eyebrow: "Command Menu",
    title: "Everything by keystroke",
    href: "/features.html#palette",
    icon: Command,
  },
  {
    eyebrow: "Local Vault",
    title: "Your files. Your folders.",
    href: "/features.html#vault",
    icon: Folder,
  },
  {
    eyebrow: "Markdown Editor",
    title: "Native macOS editing",
    href: "/features.html#editor",
    icon: SquarePen,
  },
];

export function FeaturesDropdown({ open, onMouseEnter, onMouseLeave }: FeaturesDropdownProps) {
  return (
    <div
      className={"l-features-dd" + (open ? " is-open" : "")}
      role="menu"
      aria-hidden={!open}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="l-features-dd-inner">
        <div className="l-features-grid">
          {FEATURES.map((f) => {
            const Icn = f.icon;
            return (
              <a key={f.eyebrow} href={f.href} className="l-features-item" role="menuitem">
                <span className="l-features-item-icn">
                  <Icn size={14} strokeWidth={1.7} />
                </span>
                <div className="l-features-item-text">
                  <div className="l-features-item-eyebrow">{f.eyebrow}</div>
                  <div className="l-features-item-title">{f.title}</div>
                </div>
              </a>
            );
          })}
        </div>

        <aside className="l-features-featured" aria-label="Featured">
          <div className="l-features-featured-eyebrow">
            <span className="l-features-featured-dot" />
            New
          </div>
          <h4 className="l-features-featured-title">AI Recorder</h4>
          <p className="l-features-featured-desc">
            Press record. Lecture AI follows along and drafts structured notes
            into your active file.
          </p>
          <div className="l-features-featured-card">
            <VisRecorder />
          </div>
          <a href="/features.html#lecture-ai" className="l-features-featured-link">
            See it in action
            <ArrowUpRight size={13} strokeWidth={1.7} />
          </a>
        </aside>
      </div>

      <div className="l-features-dd-footer">
        <span className="l-features-dd-footer-tag">
          <span className="l-features-featured-dot" />
          New: AI Recorder is live in 1.4
        </span>
        <a href="/features.html" className="l-features-dd-footer-link">All features →</a>
      </div>
    </div>
  );
}
