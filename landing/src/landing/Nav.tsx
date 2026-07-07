import { useEffect, useRef, useState } from "react";
import { Download, Moon, Sun, ChevronDown, Menu, X } from "lucide-react";
import type { Theme } from "./useTheme";
import { FeaturesDropdown } from "./FeaturesDropdown";
import { BrandMark } from "../shared/BrandMark";

interface NavProps {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

// How long to wait before closing the dropdown on mouseleave.
// Long enough that diagonal mouse paths from button → panel don't dismiss it.
const CLOSE_DELAY_MS = 120;

// Primary nav links (the redundant top-level "Download" entry was removed — the
// persistent Download button on the right covers it).
const NAV_LINKS = [
  { label: "How it works", href: "#how" },
  { label: "Roadmap", href: "/download.html#roadmap" },
  { label: "Changelog", href: "#changelog" },
];

export function Nav({ theme, setTheme }: NavProps) {
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  function open() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setFeaturesOpen(true);
  }
  function closeSoon() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setFeaturesOpen(false);
      closeTimer.current = null;
    }, CLOSE_DELAY_MS);
  }

  // Escape closes the dropdown and the mobile menu.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setFeaturesOpen(false);
        setMenuOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="l-nav">
      <div className="l-shell" style={{ opacity: 1 }}>
        <div className="l-nav-row">
          <a className="l-brand" href="/" aria-label="Noto home">
            <span className="l-brand-mark"><BrandMark size={14} /></span>
            <span>NOTO</span>
          </a>
          <nav>
            <ul className="l-nav-links">
              <li
                className="l-nav-item-wrap"
                onMouseEnter={open}
                onMouseLeave={closeSoon}
              >
                <button
                  type="button"
                  className="l-nav-trigger"
                  aria-haspopup="menu"
                  aria-expanded={featuresOpen}
                  onClick={() => setFeaturesOpen((o) => !o)}
                  onFocus={open}
                >
                  Features
                  <ChevronDown size={13} strokeWidth={1.7} />
                </button>
                <FeaturesDropdown
                  open={featuresOpen}
                  onMouseEnter={open}
                  onMouseLeave={closeSoon}
                />
              </li>
              {NAV_LINKS.map((l) => (
                <li key={l.href}><a href={l.href}>{l.label}</a></li>
              ))}
            </ul>
          </nav>
          <div className="l-nav-right">
            <button
              className="l-btn l-btn-ghost"
              aria-label="Toggle theme"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              style={{ width: 38, padding: 0, justifyContent: "center" }}
            >
              {theme === "light"
                ? <Moon size={15} strokeWidth={1.7} />
                : <Sun size={15} strokeWidth={1.7} />}
            </button>
            <span className="l-nav-actions">
              <a className="l-btn l-btn-ghost" href="/download.html">Get started</a>
              <a className="l-btn l-btn-outline" href="#help">Help</a>
              <a className="l-btn l-btn-primary" href="/download.html">
                <Download size={14} strokeWidth={1.7} />
                Download
              </a>
            </span>
            <button
              type="button"
              className="l-nav-hamburger"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? <X size={18} strokeWidth={1.8} /> : <Menu size={18} strokeWidth={1.8} />}
            </button>
          </div>
        </div>
      </div>

      {menuOpen && (
        <div className="l-nav-mobile" onClick={() => setMenuOpen(false)}>
          <a href="/features.html">Features</a>
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href}>{l.label}</a>
          ))}
          <a href="/download.html">Get started</a>
          <a className="l-btn l-btn-primary l-nav-mobile-cta" href="/download.html">
            <Download size={14} strokeWidth={1.7} />
            Download for macOS
          </a>
        </div>
      )}
    </header>
  );
}
