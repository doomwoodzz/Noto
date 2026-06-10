import { MarkdownPreview } from "./MarkdownPreview";
import { KnowledgeGraph } from "./KnowledgeGraph";
import type { VaultFile, Graph, GraphFilter, WorkspaceTab } from "./types";

interface WorkspaceProps {
  tab: WorkspaceTab;
  setTab: (t: WorkspaceTab) => void;
  activeFile: VaultFile | null;
  onWikiOpen: (title: string) => void;
  graph: Graph;
  activeFileId: string;
  onGraphSelect: (id: string) => void;
  filter: GraphFilter;
  setFilter: (f: GraphFilter) => void;
  aiText: string;
  aiTyping: boolean;
  createdEdgeKeys: Set<string>;
  createdNodeIds: Set<string>;
  linksAnimating: boolean;
}

export function Workspace({
  tab, setTab, activeFile, onWikiOpen, graph, activeFileId,
  onGraphSelect, filter, setFilter,
  aiText, aiTyping, createdEdgeKeys, createdNodeIds, linksAnimating,
}: WorkspaceProps) {
  return (
    <div className="noto-workspace">
      <div className="noto-tabbar">
        <button
          className={"noto-tab" + (tab === "note" ? " is-active" : "")}
          onClick={() => setTab("note")}
        >
          Note
        </button>
        <button
          className={"noto-tab" + (tab === "graph" ? " is-active" : "")}
          onClick={() => setTab("graph")}
        >
          Knowledge Web
        </button>
      </div>

      <div className="noto-workspace-body">
        {tab === "note" ? (
          <MarkdownPreview
            file={activeFile}
            onWikiOpen={onWikiOpen}
            aiText={aiText}
            aiTyping={aiTyping}
          />
        ) : (
          <KnowledgeGraph
            graph={graph}
            activeFileId={activeFileId}
            onSelect={onGraphSelect}
            filter={filter}
            setFilter={setFilter}
            createdEdgeKeys={createdEdgeKeys}
            createdNodeIds={createdNodeIds}
            linksAnimating={linksAnimating}
          />
        )}
      </div>
    </div>
  );
}
