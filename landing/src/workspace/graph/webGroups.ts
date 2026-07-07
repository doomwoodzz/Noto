// Pure grouping logic for the Knowledge Web: match expressions, per-node color/
// visibility assignment, and folder-derived default groups.

import { PALETTE, UNGROUPED_COLOR, type WebGroup, type WebNode } from "./webTypes";

/** Does `node` match a group's query? "path:X" = path starts with X; else title contains. */
export function matchGroup(query: string, node: { title: string; path: string }): boolean {
  const q = (query || "").trim().toLowerCase();
  if (!q) return false;
  if (q.indexOf("path:") === 0) {
    const p = q.slice(5).trim();
    return p ? node.path.toLowerCase().indexOf(p) === 0 : false;
  }
  return node.title.toLowerCase().indexOf(q) >= 0;
}

export interface GroupAssignment {
  /** Per-node fill color (group color or the ungrouped grey). */
  colors: string[];
  /** Per-node hidden flag (matched an invisible group). */
  hidden: boolean[];
  /** Per-group member count, aligned to the input `groups`. */
  counts: number[];
}

/** Assign each node to its first matching group. First match wins. */
export function assignGroups(nodes: WebNode[], groups: WebGroup[]): GroupAssignment {
  const counts = groups.map(() => 0);
  const colors: string[] = new Array(nodes.length);
  const hidden: boolean[] = new Array(nodes.length);
  for (let n = 0; n < nodes.length; n++) {
    let gi = -1;
    for (let i = 0; i < groups.length; i++) {
      if (matchGroup(groups[i].query, nodes[n])) {
        gi = i;
        break;
      }
    }
    colors[n] = gi >= 0 ? groups[gi].color : UNGROUPED_COLOR;
    hidden[n] = gi >= 0 && !groups[gi].visible;
    if (gi >= 0) counts[gi]++;
  }
  return { colors, hidden, counts };
}

/** One visible `path:` group per folder, colored round-robin from PALETTE. */
export function defaultFolderGroups(folders: string[]): WebGroup[] {
  return folders.map((f, i) => ({
    query: "path:" + f,
    color: PALETTE[i % PALETTE.length],
    visible: true,
  }));
}
