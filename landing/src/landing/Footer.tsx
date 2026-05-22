import { Box } from "lucide-react";

export function Footer() {
  return (
    <footer className="l-footer">
      <div className="l-shell">
        <div className="l-footer-row">
          <div className="l-footer-brand">
            <div className="l-brand">
              <span className="l-brand-mark"><Box size={13} strokeWidth={1.7} /></span>
              <span>NOTO</span>
            </div>
            <p className="l-footer-tagline">
              A local-first Markdown notes workspace for macOS, with an AI that listens — only when you want it to.
            </p>
          </div>
          <div className="l-footer-col">
            <h4>Product</h4>
            <ul>
              <li><a href="#features">Features</a></li>
              <li><a href="#download">Download</a></li>
              <li><a href="#changelog">Changelog</a></li>
              <li><a href="#roadmap">Roadmap</a></li>
            </ul>
          </div>
          <div className="l-footer-col">
            <h4>Resources</h4>
            <ul>
              <li><a href="#docs">Documentation</a></li>
              <li><a href="#shortcuts">Keyboard shortcuts</a></li>
              <li><a href="#vault">Vault format</a></li>
              <li><a href="#support">Support</a></li>
            </ul>
          </div>
          <div className="l-footer-col">
            <h4>Company</h4>
            <ul>
              <li><a href="#about">About</a></li>
              <li><a href="#privacy">Privacy</a></li>
              <li><a href="#contact">Contact</a></li>
              <li><a href="#github">GitHub</a></li>
            </ul>
          </div>
        </div>
        <div className="l-footer-bottom">
          <div>© 2026 Noto — Built on disk, not in the cloud.</div>
          <div>v 1.4.0 · macOS 14+</div>
        </div>
      </div>
    </footer>
  );
}
