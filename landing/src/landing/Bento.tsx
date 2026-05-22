import {
  ArrowRight, Brain, Command, Folder, Link as LinkIcon, Lock, Mic, Waypoints,
} from "lucide-react";
import { VisRecorder } from "./bento/VisRecorder";
import { VisPalette } from "./bento/VisPalette";
import { VisGraph } from "./bento/VisGraph";
import { VisTree } from "./bento/VisTree";
import { VisWiki } from "./bento/VisWiki";
import { VisMemory } from "./bento/VisMemory";

const CODE_STYLE: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
  background: "rgba(12,13,15,0.06)",
  padding: "2px 6px",
  borderRadius: 4,
};

export function Bento() {
  return (
    <section className="l-section" id="features">
      <div className="l-shell">
        <div className="l-section-head">
          <div className="l-section-label">
            <span className="l-section-label-bar" /> What it does
          </div>
          <h2 className="l-section-title">A quiet desk for thinking. A loud one for listening.</h2>
          <p className="l-section-sub">
            Noto is a serious Mac productivity tool. Markdown on disk. Wiki links and backlinks.
            A graph of how your ideas connect. And a Lecture AI that listens when you want it to — never before.
          </p>
        </div>

        <div className="l-bento">
          {/* Row 1: Headline / Recorder / Palette */}
          <div className="l-cell">
            <h3 className="l-headcell-title">Built around the way you take notes — not the other way around.</h3>
            <p className="l-headcell-sub">
              Every file is a Markdown file. Every link is a wiki link. Nothing is locked in a database, a vendor, or a cloud.
            </p>
            <div style={{ marginTop: "auto", paddingTop: 24 }}>
              <a href="#download" className="l-btn-link">
                Explore the workspace <ArrowRight size={13} strokeWidth={1.7} />
              </a>
            </div>
          </div>

          <div className="l-cell">
            <div className="l-cell-head">
              <div className="l-cell-eyebrow">
                <span className="l-cell-eyebrow-icn"><Mic size={13} strokeWidth={1.7} /></span>
                Lecture AI
              </div>
              <h3 className="l-cell-title">Listens, transcribes, organizes.</h3>
              <p className="l-cell-sub">
                Press record. Lecture AI follows along and drafts structured notes into your active file.
              </p>
            </div>
            <div className="l-cell-art">
              <VisRecorder />
            </div>
          </div>

          <div className="l-cell">
            <div className="l-cell-head">
              <div className="l-cell-eyebrow">
                <span className="l-cell-eyebrow-icn"><Command size={13} strokeWidth={1.7} /></span>
                Command Menu
              </div>
              <h3 className="l-cell-title">Everything is a keystroke away.</h3>
              <p className="l-cell-sub">
                Press <span style={CODE_STYLE}>⌘K</span> to jump between notes, open the graph, or toggle the recorder.
              </p>
            </div>
            <div className="l-cell-art">
              <VisPalette />
            </div>
          </div>

          {/* Row 2: Knowledge Web / Vault */}
          <div className="l-cell l-cell-2 l-cell-tall l-cell-flush" style={{ background: "#FFFFFF" }}>
            <div style={{ padding: 36, display: "flex", flexDirection: "column", height: "100%" }}>
              <div className="l-cell-head" style={{ position: "relative", zIndex: 2 }}>
                <div className="l-cell-eyebrow">
                  <span className="l-cell-eyebrow-icn"><Waypoints size={13} strokeWidth={1.7} /></span>
                  Knowledge Web
                </div>
                <h3 className="l-cell-title">Watch your ideas connect themselves.</h3>
                <p className="l-cell-sub">
                  Every wiki link is an edge. Every backlink is a way home. The graph is generated, never authored.
                </p>
              </div>
              <div style={{ position: "relative", flex: 1, minHeight: 240, marginTop: 8 }}>
                <div className="lr-graph"><VisGraph /></div>
              </div>
            </div>
          </div>

          <div className="l-cell l-cell-tall">
            <div className="l-cell-head">
              <div className="l-cell-eyebrow">
                <span className="l-cell-eyebrow-icn"><Folder size={13} strokeWidth={1.7} /></span>
                Local Markdown Vault
              </div>
              <h3 className="l-cell-title">Your files. Your folders. On disk.</h3>
              <p className="l-cell-sub">
                Noto reads and writes plain{" "}
                <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>.md</code>.
                Open it in any editor. Sync it any way you like.
              </p>
            </div>
            <div className="l-cell-art" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              <VisTree />
            </div>
          </div>

          {/* Row 3: Wiki Links / AI Memory */}
          <div className="l-cell">
            <div className="l-cell-head">
              <div className="l-cell-eyebrow">
                <span className="l-cell-eyebrow-icn"><LinkIcon size={13} strokeWidth={1.7} /></span>
                Wiki Links &amp; Backlinks
              </div>
              <h3 className="l-cell-title">Two square brackets.</h3>
              <p className="l-cell-sub">
                Type{" "}
                <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>[[Chloroplast]]</code>{" "}
                and the link is live. The destination knows it's been linked.
              </p>
            </div>
            <div className="l-cell-art">
              <VisWiki />
            </div>
          </div>

          <div className="l-cell l-cell-2">
            <div className="l-cell-head">
              <div className="l-cell-eyebrow">
                <span className="l-cell-eyebrow-icn"><Brain size={13} strokeWidth={1.7} /></span>
                AI Memory
              </div>
              <h3 className="l-cell-title">A quiet record of what you just heard.</h3>
              <p className="l-cell-sub">
                Concepts and linked notes from the last recording — surfaced in the right context panel so you
                can fold them into your own notes when you're ready.
              </p>
            </div>
            <div className="l-cell-art">
              <VisMemory />
            </div>
          </div>

          {/* Row 4: full-width privacy strip */}
          <div className="l-cell l-cell-3 l-cell-flush" style={{ minHeight: 0, padding: 0 }}>
            <div className="lr-privacy">
              <div>
                <div className="lr-privacy-eyebrow">
                  <Lock size={13} strokeWidth={1.7} /> Local-first
                </div>
                <h3 className="lr-privacy-title">
                  Recording <em>only starts</em> when you press Record.
                </h3>
                <p className="lr-privacy-sub">
                  Your vault lives on disk. Transcripts and AI memory never leave your Mac unless you explicitly
                  share them. Consent is part of the design, not a settings page.
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
        </div>
      </div>
    </section>
  );
}
