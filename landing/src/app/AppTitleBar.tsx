import { Command, LogOut, Moon, PanelRight, Sun } from "lucide-react";
import type { Theme } from "../landing/useTheme";

interface Props {
  slogan: string;
  email: string | null;
  theme: Theme;
  onToggleTheme: () => void;
  onToggleCommand: () => void;
  onToggleRightSidebar: () => void;
  onLogout: () => void;
}

/** App chrome — mirrors the demo TitleBar classes, adds theme + account. */
export function AppTitleBar({
  slogan,
  email,
  theme,
  onToggleTheme,
  onToggleCommand,
  onToggleRightSidebar,
  onLogout,
}: Props) {
  return (
    <div className="noto-titlebar">
      <div className="noto-traffic">
        <span className="tl tl-close" />
        <span className="tl tl-min" />
        <span className="tl tl-max" />
      </div>
      <div className="noto-titlebar-brand">
        <div className="noto-titlebar-name">Noto</div>
        <div className="noto-titlebar-slogan">{slogan}</div>
      </div>
      <div style={{ flex: 1 }} />
      <button className="noto-btn noto-btn-ghost" onClick={onToggleTheme} aria-label="Toggle theme">
        {theme === "dark" ? <Sun size={13} strokeWidth={1.7} /> : <Moon size={13} strokeWidth={1.7} />}
      </button>
      <button
        className="noto-btn noto-btn-ghost"
        onClick={onToggleRightSidebar}
        aria-label="Toggle context sidebar"
      >
        <PanelRight size={13} strokeWidth={1.7} />
      </button>
      <button className="noto-btn noto-btn-bordered" onClick={onToggleCommand}>
        <Command size={12} strokeWidth={1.7} />
        <span>Command</span>
      </button>
      {email && (
        <div className="app-account">
          <span className="app-account-email" title={email}>{email}</span>
          <button className="noto-btn noto-btn-ghost" onClick={onLogout} aria-label="Log out">
            <LogOut size={13} strokeWidth={1.7} />
          </button>
        </div>
      )}
    </div>
  );
}
