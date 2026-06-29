import type { ReactNode } from "react";

export const TOOL_LOGOS: Record<string, ReactNode> = {
  "claude-code": (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="#D97757" strokeWidth="2.4" strokeLinecap="round">
        <line x1="12" y1="3" x2="12" y2="21" /><line x1="3" y1="12" x2="21" y2="12" />
        <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" /><line x1="18.4" y1="5.6" x2="5.6" y2="18.4" />
      </g>
    </svg>
  ),
  cursor: (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M12 3 L20 7.5 L20 16.5 L12 21 L4 16.5 L4 7.5 Z" /><path d="M12 3 L12 12 M4 7.5 L12 12 L20 7.5" />
    </svg>
  ),
  codex: (
    <svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <polygon points="12,3.2 19.6,7.6 19.6,16.4 12,20.8 4.4,16.4 4.4,7.6" /><circle cx="12" cy="12" r="3.1" />
    </svg>
  ),
};
