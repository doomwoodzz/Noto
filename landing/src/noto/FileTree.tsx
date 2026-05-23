import { Folder, FileText } from "lucide-react";
import type { VaultFile } from "./types";

interface FileTreeProps {
  files: VaultFile[];
  folderOrder: string[];
  activeFileId: string;
  onSelect: (id: string) => void;
}

export function FileTree({ files, folderOrder, activeFileId, onSelect }: FileTreeProps) {
  const groups: Record<string, VaultFile[]> = {};
  for (const f of files) {
    const folder = f.path.split("/")[0];
    (groups[folder] = groups[folder] || []).push(f);
  }
  const ordered = Object.keys(groups).sort((a, b) => {
    const ai = folderOrder.indexOf(a), bi = folderOrder.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  if (files.length === 0) {
    return <div className="noto-empty">No notes found.</div>;
  }

  return (
    <div className="noto-tree">
      {ordered.map(folder => (
        <div key={folder} className="noto-tree-group">
          <div className="noto-tree-folder">
            <Folder size={13} strokeWidth={1.7} />
            <span>{folder}</span>
          </div>
          {groups[folder].sort((a, b) => a.title.localeCompare(b.title)).map(f => (
            <button
              key={f.id}
              className={"noto-tree-row" + (f.id === activeFileId ? " is-active" : "")}
              onClick={() => onSelect(f.id)}
            >
              <FileText size={13} strokeWidth={1.7} />
              <span>{f.title}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
