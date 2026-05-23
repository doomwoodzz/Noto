import { PanelRight, RefreshCw, Command } from "lucide-react";

interface TitleBarProps {
  slogan: string;
  onToggleCommand: () => void;
  onToggleRightSidebar: () => void;
  rightSidebarOn: boolean;
}

export function TitleBar({ slogan, onToggleCommand, onToggleRightSidebar }: TitleBarProps) {
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
      <button className="noto-btn noto-btn-ghost" onClick={onToggleRightSidebar} aria-label="Toggle context sidebar">
        <PanelRight size={13} strokeWidth={1.7} />
      </button>
      <button className="noto-btn noto-btn-bordered">
        <RefreshCw size={12} strokeWidth={1.7} />
        <span>Up to date</span>
      </button>
      <button className="noto-btn noto-btn-bordered" onClick={onToggleCommand}>
        <Command size={12} strokeWidth={1.7} />
        <span>Command</span>
      </button>
    </div>
  );
}
