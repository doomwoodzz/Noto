// Embedded Noto app for the landing-page preview.
// Ported from /landing-page/project/noto/NotoApp.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { TitleBar } from "./TitleBar";
import { VaultSidebar } from "./VaultSidebar";
import { Workspace } from "./Workspace";
import { RightContext } from "./RightContext";
import { CommandPalette } from "./CommandPalette";
import { AIRecorder } from "./AIRecorder";
import { NotoData } from "./mockVault";
import { useTypewriter } from "./useTypewriter";
import {
  AI_NEW_EDGES, AI_NEW_NODES, AI_QUESTIONS, AI_SUMMARY_TEXT, edgeKey,
} from "./aiDemo";
import type {
  Graph, GraphEdge, GraphFilter, GraphNode, RecorderState, WorkspaceTab,
} from "./types";

const NOTO_SIMULATED_CONCEPTS = [
  "chlorophyll absorbs light",
  "glucose stores chemical energy",
  "carbon dioxide enters through stomata",
  "Calvin cycle produces sugar",
  "compare light reactions and Calvin cycle",
];

export function NotoApp() {
  const { files, folderOrder, graph, metaByFileId, fileIdByTitle } = NotoData;

  const [query, setQuery] = useState("");
  const [activeFileId, setActiveFileId] = useState("biology-photosynthesis");
  const [rightSidebarOn, setRightSidebarOn] = useState(true);
  const [tab, setTab] = useState<WorkspaceTab>("note");
  const [graphFilter, setGraphFilter] = useState<GraphFilter>("all");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(true);
  const [recorder, setRecorder] = useState<RecorderState>({
    phase: "idle", elapsed: 0, concepts: [], targetNoteTitle: "Photosynthesis",
  });

  // AI "doing the work" state: a summary typed into the note plus links the
  // AI discovers and draws into the Knowledge Web.
  const noteTyper = useTypewriter(52);
  const [aiNoteId, setAiNoteId] = useState<string | null>(null);
  const [aiNodes, setAiNodes] = useState<GraphNode[]>([]);
  const [aiEdges, setAiEdges] = useState<GraphEdge[]>([]);
  const [linksAnimating, setLinksAnimating] = useState(false);
  const [recordSession, setRecordSession] = useState(0);
  const linkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter(f =>
      f.title.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    );
  }, [query, files]);

  const activeFile = files.find(f => f.id === activeFileId) || null;
  const activeMetadata = metaByFileId(activeFileId);

  // Base graph augmented with the links the AI has drawn in (if any).
  const liveGraph: Graph = useMemo(() => {
    if (aiNodes.length === 0 && aiEdges.length === 0) return graph;
    const nodeIds = new Set(graph.nodes.map(n => n.id));
    const extraNodes = aiNodes.filter(n => !nodeIds.has(n.id));
    return {
      nodes: [...graph.nodes, ...extraNodes],
      edges: [...graph.edges, ...aiEdges],
    };
  }, [graph, aiNodes, aiEdges]);

  const createdEdgeKeys = useMemo(() => new Set(aiEdges.map(edgeKey)), [aiEdges]);
  const createdNodeIds = useMemo(() => new Set(aiNodes.map(n => n.id)), [aiNodes]);

  const visibleGraph: Graph = useMemo(() => {
    const graph = liveGraph;
    if (graphFilter === "all") return graph;
    if (graphFilter === "lecture") {
      const nodes = graph.nodes.filter(n => {
        const f = files.find(x => x.id === n.id);
        return f && f.path.startsWith("AI Lecture Notes/");
      });
      const ids = new Set(nodes.map(n => n.id));
      return { nodes, edges: graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)) };
    }
    if (graphFilter === "orphan") {
      const linked = new Set<string>();
      graph.edges.forEach(e => { linked.add(e.source); linked.add(e.target); });
      return { nodes: graph.nodes.filter(n => !linked.has(n.id)), edges: [] };
    }
    if (graphFilter === "local") {
      const ids = new Set<string>([activeFileId]);
      graph.edges.forEach(e => {
        if (e.source === activeFileId) ids.add(e.target);
        if (e.target === activeFileId) ids.add(e.source);
      });
      const nodes = graph.nodes.filter(n => ids.has(n.id));
      return { nodes, edges: graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)) };
    }
    return graph;
  }, [graphFilter, liveGraph, files, activeFileId]);

  // Recorder tick.
  useEffect(() => {
    if (recorder.phase !== "recording") return;
    const id = setInterval(() => {
      setRecorder(r => {
        const nextElapsed = r.elapsed + 2;
        const idx = Math.min(Math.floor(nextElapsed / 2) - 1, NOTO_SIMULATED_CONCEPTS.length - 1);
        const concepts = idx >= 0 ? NOTO_SIMULATED_CONCEPTS.slice(0, idx + 1) : [];
        return { ...r, elapsed: nextElapsed, concepts };
      });
    }, 2000);
    return () => clearInterval(id);
  }, [recorder.phase]);

  // Global keyboard shortcuts: ⌘K palette, ⌃⌘M recorder.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
      if (e.metaKey && e.ctrlKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setRecorderOpen(o => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handleSelect(id: string) { setActiveFileId(id); setTab("note"); }
  function handleWikiOpen(title: string) {
    const id = fileIdByTitle(title);
    if (id) handleSelect(id);
  }

  function paletteCommand(cmd: string) {
    setPaletteOpen(false);
    if (cmd === "open-graph") setTab("graph");
    if (cmd === "toggle-recorder") setRecorderOpen(o => !o);
    if (cmd === "create-lecture") setActiveFileId("ai-biology-lecture-may-13");
    if (cmd === "local-graph") { setTab("graph"); setGraphFilter("local"); }
  }

  // Wipe everything the AI produced (typed note + drawn links).
  function clearAIWork() {
    if (linkTimer.current) clearTimeout(linkTimer.current);
    noteTyper.reset();
    setAiNoteId(null);
    setAiNodes([]);
    setAiEdges([]);
    setLinksAnimating(false);
  }

  function recorderStart() {
    clearAIWork();
    setRecordSession(s => s + 1);
    setRecorder({
      phase: "recording", elapsed: 0, concepts: [],
      targetNoteTitle: activeFile ? activeFile.title : "Current Note",
    });
  }
  function recorderStop() {
    setRecorder(r => ({ ...r, phase: "processing" }));
    setAiNoteId(activeFileId);
    setTimeout(() => {
      setRecorder(r => ({ ...r, phase: "complete" }));
      // The AI now "writes" its summary into the note and draws the new
      // links it found into the Knowledge Web.
      noteTyper.run(AI_SUMMARY_TEXT);
      setAiNodes(AI_NEW_NODES);
      setAiEdges(AI_NEW_EDGES);
      setLinksAnimating(true);
      linkTimer.current = setTimeout(() => setLinksAnimating(false), 5600);
    }, 900);
  }
  function recorderReset() {
    clearAIWork();
    setRecordSession(s => s + 1);
    setRecorder({
      phase: "idle", elapsed: 0, concepts: [],
      targetNoteTitle: activeFile ? activeFile.title : "Current Note",
    });
  }

  useEffect(() => () => { if (linkTimer.current) clearTimeout(linkTimer.current); }, []);

  const aiMemory = {
    concepts: recorder.concepts,
    linked: recorder.concepts.length > 0
      ? ["Chloroplast", "Glucose", "Carbon Dioxide", ...(aiEdges.length > 0 ? ["Calvin Cycle", "Enzymes"] : [])]
      : [],
  };

  return (
    <div className="noto-app" data-screen-label="Noto · Workspace">
      <TitleBar
        slogan="When you listen, Noto remembers"
        onToggleCommand={() => setPaletteOpen(o => !o)}
        onToggleRightSidebar={() => setRightSidebarOn(o => !o)}
        rightSidebarOn={rightSidebarOn}
      />
      <div className="noto-body">
        <VaultSidebar
          vaultName="School Vault"
          query={query}
          setQuery={setQuery}
          files={filteredFiles}
          folderOrder={folderOrder}
          activeFileId={activeFileId}
          onSelect={handleSelect}
          onNewNote={() => {}}
          onOpenGraph={() => setTab("graph")}
        />
        <Workspace
          tab={tab}
          setTab={setTab}
          activeFile={activeFile}
          onWikiOpen={handleWikiOpen}
          graph={visibleGraph}
          activeFileId={activeFileId}
          onGraphSelect={(id) => { setActiveFileId(id); setTab("note"); }}
          filter={graphFilter}
          setFilter={setGraphFilter}
          aiText={activeFileId === aiNoteId ? noteTyper.text : ""}
          aiTyping={activeFileId === aiNoteId && !noteTyper.done}
          createdEdgeKeys={createdEdgeKeys}
          createdNodeIds={createdNodeIds}
          linksAnimating={linksAnimating}
        />
        {rightSidebarOn && (
          <RightContext metadata={activeMetadata} aiMemory={aiMemory} />
        )}
      </div>

      {recorderOpen && (
        <AIRecorder
          key={recordSession}
          phase={recorder.phase}
          elapsed={recorder.elapsed}
          concepts={recorder.concepts}
          targetNoteTitle={recorder.targetNoteTitle}
          questions={AI_QUESTIONS}
          onStart={recorderStart}
          onStop={recorderStop}
          onOpenNote={() => { setTab("note"); }}
          onViewLinks={() => setTab("graph")}
          onRecordMore={recorderReset}
        />
      )}

      {paletteOpen && (
        <CommandPalette onClose={() => setPaletteOpen(false)} onCommand={paletteCommand} />
      )}

      <div className="noto-hint">
        <span><kbd>⌘K</kbd> palette</span>
        <span><kbd>⌃⌘M</kbd> recorder</span>
      </div>
    </div>
  );
}
