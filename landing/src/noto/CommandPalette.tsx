import { useEffect, useRef, useState } from "react";
import {
  Command, SquarePen, Waypoints, Mic, Search, Link as LinkIcon,
  AudioWaveform, Crosshair,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "square-pen": SquarePen,
  "waypoints": Waypoints,
  "mic": Mic,
  "search": Search,
  "link": LinkIcon,
  "audio-waveform": AudioWaveform,
  "crosshair": Crosshair,
};

interface CommandPaletteProps {
  onClose: () => void;
  onCommand: (id: string) => void;
}

export function CommandPalette({ onClose, onCommand }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const commands = [
    { title: "New Note", icon: "square-pen", id: "new-note" },
    { title: "Open Knowledge Web", icon: "waypoints", id: "open-graph" },
    { title: "Toggle AI Recorder", icon: "mic", id: "toggle-recorder" },
    { title: "Search Notes", icon: "search", id: "search" },
    { title: "Insert Backlink", icon: "link", id: "insert-backlink" },
    { title: "Create Lecture Note", icon: "audio-waveform", id: "create-lecture" },
    { title: "Show Local Graph", icon: "crosshair", id: "local-graph" },
  ];
  const filtered = query.trim()
    ? commands.filter(c => c.title.toLowerCase().includes(query.toLowerCase()))
    : commands;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { setActive(a => Math.min(filtered.length - 1, a + 1)); e.preventDefault(); }
    if (e.key === "ArrowUp")   { setActive(a => Math.max(0, a - 1)); e.preventDefault(); }
    if (e.key === "Enter")     { if (filtered[active]) onCommand(filtered[active].id); e.preventDefault(); }
    if (e.key === "Escape")    { onClose(); }
  }

  return (
    <div className="noto-overlay" onClick={onClose}>
      <div className="noto-palette" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="noto-palette-search">
          <Command size={14} strokeWidth={1.7} color="var(--color-muted)" />
          <input
            ref={inputRef}
            placeholder="Search commands"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="noto-palette-list">
          {filtered.length === 0 && <div className="noto-empty-line" style={{ padding: 12 }}>No commands match.</div>}
          {filtered.map((c, i) => {
            const Ico = ICONS[c.icon] ?? Command;
            return (
              <button
                key={c.id}
                className={"noto-palette-item" + (i === active ? " is-active" : "")}
                onMouseEnter={() => setActive(i)}
                onClick={() => onCommand(c.id)}
              >
                <Ico size={14} strokeWidth={1.7} color="var(--color-muted)" />
                <span>{c.title}</span>
                {i === active && <span className="noto-kbd">↵</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
