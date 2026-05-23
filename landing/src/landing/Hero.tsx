import { ArrowRight, Check, Download } from "lucide-react";

export function Hero() {
  return (
    <section className="l-hero">
      <div className="l-shell">
        <div className="l-eyebrow">
          <span className="l-eyebrow-dot" />
          Noto 1.4 — Local Markdown Vault with Lecture AI
        </div>
        <h1 className="l-hero-title">
          When you listen, <em>Noto remembers.</em>
        </h1>
        <p className="l-hero-sub">
          A local-first Markdown notes workspace for macOS with an AI lecture assistant.
          Your vault lives on disk. Your notes link themselves. The graph grows as you write.
        </p>
        <div className="l-hero-cta">
          <a href="#download" className="l-btn l-btn-primary l-btn-lg">
            <Download size={15} strokeWidth={1.7} />
            Download for macOS
          </a>
          <a href="#preview" className="l-btn l-btn-outline l-btn-lg">
            See it in action
            <ArrowRight size={15} strokeWidth={1.7} />
          </a>
        </div>
        <div className="l-hero-meta">
          <span className="l-hero-meta-item">
            <Check size={13} strokeWidth={1.7} style={{ color: "var(--page-blue)" }} />
            Free during beta
          </span>
          <span className="l-hero-meta-dot" />
          <span className="l-hero-meta-item">macOS 14+ · Apple silicon</span>
          <span className="l-hero-meta-dot" />
          <span className="l-hero-meta-item">Your data never leaves your Mac</span>
        </div>
      </div>
    </section>
  );
}
