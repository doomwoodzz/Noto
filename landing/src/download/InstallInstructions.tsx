import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { VERSION_LABEL, PIP_INSTALL_COMMAND } from "../shared/release";

export function InstallInstructions() {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(PIP_INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the command is still selectable text */
    }
  }

  return (
    <section className="cs-hero" id="download">
      <div className="l-shell">
        <div className="cs-hero-head">
          <div className="cs-eyebrow">
            <span className="cs-eyebrow-dot" />
            {VERSION_LABEL} — Available now
          </div>
          <h1 className="cs-title">
            Install with <em>one command.</em>
          </h1>
          <p className="cs-sub">
            Noto runs entirely on your machine. No accounts, no cloud lock-in, no
            server to operate — your vault stays on disk.
          </p>
        </div>

        <div className="cs-grid">
          <div className="cs-grid-cell cs-cell-timer">
            <div className="cs-timer-label">
              <span className="cs-timer-label-bar" /> Requires Python 3.9+
            </div>
            <button
              className="cs-install-cmd"
              onClick={copyCommand}
              type="button"
              aria-label="Copy install command"
            >
              <Terminal size={15} strokeWidth={1.7} />
              <code>{PIP_INSTALL_COMMAND}</code>
              {copied ? <Check size={14} strokeWidth={2.4} /> : <Copy size={14} strokeWidth={1.7} />}
            </button>
            <p className="cs-launch-note">
              Then run <code>noto</code>. The first launch downloads a small,
              checksum-verified Node.js runtime automatically — no separate Node.js
              install required.
            </p>
          </div>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="cs-grid-cell is-empty" />
          ))}
        </div>

        <div className="cs-grid-foot">
          <div className="cs-grid-foot-meta">
            <span>Free and open source</span>
            <span className="l-hero-meta-dot" />
            <span>macOS · Linux · Windows</span>
          </div>
        </div>
      </div>
    </section>
  );
}
