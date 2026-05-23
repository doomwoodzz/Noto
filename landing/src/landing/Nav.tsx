import { useEffect, useRef, useState } from "react";
import { Box, Download, Moon, Sun, ChevronDown } from "lucide-react";
import type { Theme } from "./useTheme";
import { FeaturesDropdown } from "./FeaturesDropdown";

interface NavProps {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

// How long to wait before closing the dropdown on mouseleave.
// Long enough that diagonal mouse paths from button → panel don't dismiss it.
const CLOSE_DELAY_MS = 120;

export function Nav({ theme, setTheme }: NavProps) {
  const [featuresOpen, setFeaturesOpen] = useState(false);
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

  // Escape closes the dropdown.
  useEffect(() => {
    if (!featuresOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFeaturesOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [featuresOpen]);

  return (
    <header className="l-nav">
      <div className="l-shell" style={{ opacity: 1 }}>
        <div className="l-nav-row">
          <div className="l-brand">
            <span className="l-brand-mark"><Box size={13} strokeWidth={1.7} /></span>
            <span>NOTO</span>
          </div>
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
              <li><a href="#how">How it works</a></li>
              <li><a href="#download">Download</a></li>
              <li><a href="#changelog">Changelog</a></li>
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
            <a className="l-btn l-btn-ghost" href="#signin">Sign in</a>
            <a className="l-btn l-btn-outline" href="#help">Help</a>
            <a className="l-btn l-btn-primary" href="#download">
              <Download size={14} strokeWidth={1.7} />
              Download
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
