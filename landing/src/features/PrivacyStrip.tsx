import { Folder, Lock } from "lucide-react";

export function PrivacyStrip() {
  return (
    <section className="f-privacy-section" id="privacy">
      <div className="l-shell">
        <div className="lr-privacy f-privacy">
          <div>
            <div className="lr-privacy-eyebrow">
              <Lock size={13} strokeWidth={1.7} /> Local-first
            </div>
            <h3 className="lr-privacy-title">
              Recording <em>only starts</em> when you press Record.
            </h3>
            <p className="lr-privacy-sub">
              Your vault lives on disk. Transcripts and AI memory never leave your Mac
              unless you explicitly share them. Consent is part of the design, not a
              settings page you have to go hunting for.
            </p>
          </div>
          <div className="lr-privacy-vis">
            <div className="lr-privacy-disk">
              <span className="lr-privacy-disk-icon"><Folder size={22} strokeWidth={1.7} /></span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: "var(--color-ink)", fontWeight: 600, fontSize: 13 }}>
                  ~/Documents/School Vault
                </span>
                <span>11 notes · 4 folders · 2.3 MB</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
