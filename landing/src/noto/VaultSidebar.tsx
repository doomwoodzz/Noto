import { Search, SquarePen, Waypoints } from "lucide-react";
import { FileTree } from "./FileTree";
import type { VaultFile } from "./types";

interface VaultSidebarProps {
  vaultName: string;
  query: string;
  setQuery: (q: string) => void;
  files: VaultFile[];
  folderOrder: string[];
  activeFileId: string;
  onSelect: (id: string) => void;
  onNewNote: () => void;
  onOpenGraph: () => void;
}

export function VaultSidebar({
  vaultName, query, setQuery, files, folderOrder,
  activeFileId, onSelect, onNewNote, onOpenGraph,
}: VaultSidebarProps) {
  return (
    <aside className="noto-sidebar">
      <div className="noto-vault-head">
        <div className="noto-vault-name">{vaultName}</div>
        <div className="noto-vault-sub">Local Markdown Vault</div>
      </div>

      <div className="noto-field">
        <Search size={13} strokeWidth={1.7} color="var(--color-muted)" />
        <input
          placeholder="Search notes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <button className="noto-btn noto-btn-primary noto-btn-block" onClick={onNewNote}>
        <SquarePen size={12} strokeWidth={1.7} />
        <span>New Note</span>
      </button>

      <button className="noto-link-button" onClick={onOpenGraph}>
        <Waypoints size={14} strokeWidth={1.7} />
        <span>Knowledge Web</span>
      </button>

      <div className="noto-tree-scroll">
        <FileTree
          files={files}
          folderOrder={folderOrder}
          activeFileId={activeFileId}
          onSelect={onSelect}
        />
      </div>
    </aside>
  );
}
