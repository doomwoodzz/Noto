import { useState } from "react";
import { Command, Search, Mic, SquarePen, Link as LinkIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const ITEMS: { i: LucideIcon; t: string; k: string }[] = [
  { i: Search, t: "Search Notes", k: "⌘F" },
  { i: Command, t: "Open Knowledge Web", k: "⌘G" },
  { i: Mic, t: "Toggle AI Recorder", k: "⌃⌘M" },
  { i: SquarePen, t: "New Note", k: "⌘N" },
  { i: LinkIcon, t: "Insert Backlink", k: "⌘L" },
];

export function VisPalette() {
  const [active, setActive] = useState(0);

  return (
    <div className="lr-palette">
      <div className="lr-palette-search">
        <Command size={14} strokeWidth={1.7} />
        <span>Search commands</span>
        <span className="lr-palette-search-cursor" />
      </div>
      <div className="lr-palette-list">
        {ITEMS.map((it, i) => {
          const Ico = it.i;
          return (
            <div
              key={i}
              className={"lr-palette-item" + (i === active ? " is-active" : "")}
              onMouseEnter={() => setActive(i)}
            >
              <span className="lr-palette-icn"><Ico size={13} strokeWidth={1.7} /></span>
              <span>{it.t}</span>
              <span className="lr-kbd">{it.k}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
