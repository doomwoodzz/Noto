import type { ReactNode } from "react";

// Real brand marks, served from /public/logos and rendered on the white logo
// chip (.nw-mcp-tool-logo). Cursor's source had a cream background that we
// flattened to pure white; Claude and Codex keep transparent backgrounds so
// the white chip shows through.
export const TOOL_LOGOS: Record<string, ReactNode> = {
  "claude-code": <img src="/logos/claude.svg" alt="" className="nw-mcp-logo-img" />,
  cursor: <img src="/logos/cursor.png" alt="" className="nw-mcp-logo-img" />,
  codex: <img src="/logos/codex.png" alt="" className="nw-mcp-logo-img" />,
};
