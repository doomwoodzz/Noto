import { ArrowRight, Check, Download } from "lucide-react";
import { VERSION_LABEL } from "../shared/release";

// Quick-jump chips to the deep-dive anchors further down the page.
const JUMP = [
  { label: "Local Vault", href: "#vault" },
  { label: "Markdown Editor", href: "#editor" },
  { label: "Wiki Links", href: "#wiki" },
  { label: "Knowledge Web", href: "#graph" },
  { label: "Command Menu", href: "#palette" },
  { label: "Lecture AI", href: "#lecture-ai" },
];

export function FeaturesHero() {
  return (
    <section className="f-hero">
      <div className="f-hero-bg" />
      <div className="f-hero-scrim" />
      <div className="l-shell f-hero-inner">
        <div className="f-hero-eyebrow">
          <span className="f-hero-eyebrow-dot" />
          Every feature · {VERSION_LABEL}
        </div>
        <h1 className="f-hero-title">
          Everything Noto does, in one <em>quiet workspace.</em>
        </h1>
        <p className="f-hero-sub">
          A local Markdown vault on disk. Wiki links that resolve themselves. A graph
          that draws your thinking. And a Lecture AI that listens — only when you press
          record. No cloud lock-in, no database, no surprises.
        </p>
        <div className="f-hero-cta">
          <a href="#download" className="l-btn f-btn-light l-btn-lg">
            <Download size={15} strokeWidth={1.7} />
            Download for macOS
          </a>
          <a href="#preview" className="l-btn f-btn-glass l-btn-lg">
            See it in action
            <ArrowRight size={15} strokeWidth={1.7} />
          </a>
        </div>
        <div className="f-hero-meta">
          <span className="f-hero-meta-item">
            <Check size={13} strokeWidth={1.7} />
            Free during beta
          </span>
          <span className="f-hero-meta-dot" />
          <span className="f-hero-meta-item">macOS 14+ · Apple silicon</span>
          <span className="f-hero-meta-dot" />
          <span className="f-hero-meta-item">Your data never leaves your Mac</span>
        </div>
        <div className="f-hero-jump">
          {JUMP.map((j) => (
            <a key={j.href} href={j.href} className="f-hero-jump-chip">
              {j.label}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
