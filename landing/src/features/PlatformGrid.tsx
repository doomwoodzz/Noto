import { Apple, Moon, Keyboard, RefreshCw, ShieldCheck, Cpu } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface PlatformItem {
  icon: LucideIcon;
  title: string;
  desc: string;
}

const ITEMS: PlatformItem[] = [
  {
    icon: Apple, title: "Native macOS",
    desc: "Built in SwiftUI and AppKit — a real Mac app, not a browser wrapped in a window.",
  },
  {
    icon: Cpu, title: "Apple silicon",
    desc: "Tuned for Apple silicon on macOS 14 and up, so the editor stays instant.",
  },
  {
    icon: Moon, title: "Light & dark themes",
    desc: "A paper-warm light mode and a focused dark mode, matched across the whole app.",
  },
  {
    icon: Keyboard, title: "Keyboard-first",
    desc: "Command palette and shortcuts for everything — your hands rarely leave home row.",
  },
  {
    icon: ShieldCheck, title: "Local-first & private",
    desc: "Your vault and transcripts stay on your Mac. Recording is always opt-in.",
  },
  {
    icon: RefreshCw, title: "Automatic updates",
    desc: "Sparkle keeps Noto current with signed, verified updates in the background.",
  },
];

export function PlatformGrid() {
  return (
    <section className="l-section l-section-tight" id="platform">
      <div className="l-shell">
        <div className="l-section-head">
          <div className="l-section-label">
            <span className="l-section-label-bar" /> Built for the Mac
          </div>
          <h2 className="l-section-title">A native app that respects your machine.</h2>
          <p className="l-section-sub">
            Noto is engineered for macOS — fast, private, keyboard-driven, and quietly
            kept up to date.
          </p>
        </div>

        <div className="f-plat-grid">
          {ITEMS.map((it) => {
            const Icn = it.icon;
            return (
              <div key={it.title} className="f-plat-card">
                <span className="f-plat-icn"><Icn size={18} strokeWidth={1.7} /></span>
                <div className="f-plat-title">{it.title}</div>
                <p className="f-plat-desc">{it.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
