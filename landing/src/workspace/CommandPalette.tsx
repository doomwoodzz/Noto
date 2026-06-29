import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";

interface Props {
  onClose: () => void;
  onCommand: (id: string) => void;
}

interface Command {
  id: string;
  title: string;
  icon: IconName;
}

const COMMANDS: Command[] = [
  { id: "smart-search", title: "Smart Search", icon: "search" },
  { id: "new-note", title: "New note", icon: "pen" },
  { id: "open-home", title: "Open Home", icon: "home" },
  { id: "open-graph", title: "Open Knowledge Web", icon: "graph" },
  { id: "toggle-ai", title: "Toggle Noto AI", icon: "spark" },
  { id: "open-beside", title: "Open beside (split)", icon: "split" },
  { id: "toggle-context", title: "Toggle context panel", icon: "panel" },
  { id: "create-lecture", title: "Create lecture note", icon: "mic" },
  { id: "insert-backlink", title: "Insert backlink", icon: "link" },
];

export function CommandPalette({ onClose, onCommand }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = query.trim()
    ? COMMANDS.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
    : COMMANDS;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      setActive((a) => Math.min(filtered.length - 1, a + 1));
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setActive((a) => Math.max(0, a - 1));
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (filtered[active]) onCommand(filtered[active].id);
      e.preventDefault();
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className="nw-palette-overlay" onClick={onClose}>
      <div className="nw-palette" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="nw-palette-search">
          <Icon name="search" size={15} stroke={1.8} />
          <input
            ref={inputRef}
            placeholder="Search commands…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="nw-palette-list">
          {filtered.length === 0 && <div className="nw-palette-empty">No commands match.</div>}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              className={"nw-palette-item" + (i === active ? " is-active" : "")}
              onMouseEnter={() => setActive(i)}
              onClick={() => onCommand(c.id)}
            >
              <Icon name={c.icon} size={15} stroke={1.7} />
              <span>{c.title}</span>
              {i === active && <span className="nw-palette-kbd">↵</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
