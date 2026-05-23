import { ArrowUpRight, Download } from "lucide-react";

export function FinalCTA() {
  return (
    <section className="l-finalcta" id="download">
      <div className="l-shell">
        <h2 className="l-finalcta-title">
          Start <em>listening.</em>
        </h2>
        <p className="l-finalcta-sub">
          Free during the beta. macOS 14 and up, Apple silicon. Your vault stays yours.
        </p>
        <div className="l-finalcta-row">
          <a href="#download" className="l-btn l-btn-primary l-btn-xl">
            <Download size={16} strokeWidth={1.7} />
            Download Noto for macOS
          </a>
          <a href="#docs" className="l-btn l-btn-outline l-btn-xl">
            Read the docs
            <ArrowUpRight size={16} strokeWidth={1.7} />
          </a>
        </div>
      </div>
    </section>
  );
}
