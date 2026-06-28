import { type Ref } from "react";
import { Icon } from "./icons";

interface Props {
  query: string;
  setQuery: (q: string) => void;
  contextOpen: boolean;
  onToggleContext: () => void;
  onAskAI: () => void;
  /** Anchor for the Smart Search panel to expand out of. */
  searchBoxRef?: Ref<HTMLDivElement>;
}

export function TitleBar({ query, setQuery, contextOpen, onToggleContext, onAskAI, searchBoxRef }: Props) {
  return (
    <div className="nw-titlebar">
      <div className="nw-brand">
        <span className="nw-brand-name">Noto</span>
      </div>

      <div className="nw-search-wrap">
        <div className="nw-search" ref={searchBoxRef}>
          <span className="nw-search-icn"><Icon name="search" size={15} stroke={1.8} /></span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes, concepts, lectures…"
            aria-label="Search notes"
          />
          <span className="nw-search-kbd" title="Smart Search">⌘⇧F</span>
        </div>
      </div>

      <div className="nw-titlebar-actions">
        <button
          className={"nw-icon-btn nw-titlebar-btn" + (contextOpen ? " is-on" : "")}
          onClick={onToggleContext}
          title="Toggle context"
          aria-label="Toggle context panel"
        >
          <Icon name="panel" size={16} stroke={1.7} />
        </button>
        <button className="nw-ask-ai" onClick={onAskAI}>
          <Icon name="spark" size={16} stroke={1.6} />
          <span>Ask AI</span>
        </button>
      </div>
    </div>
  );
}
