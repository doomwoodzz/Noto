import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../styles/workspace.css";
import { McpSettings } from "./McpSettings";
import { DumpModal } from "./DumpModal";
import type { DumpClient } from "./dumpClient";
import { CreateVaultModal } from "./CreateVaultModal";
import type { McpClient } from "./mcpClient";
import { ActivityView } from "./ActivityView";
import type { ActivityClient } from "./activityClient";
import {
  buildGraph,
  buildMetadataCache,
  createLectureNote,
  filterGraph,
  type VaultFile,
} from "../noto-core";
import type { Tab, VaultController } from "./types";
import { useWorkspace } from "./useWorkspace";
import { useNotoAI, type AIContext } from "./useNotoAI";
import { mockAIClient, type AIClient } from "./aiClient";
import { CitationClientContext, mockCitationClient, type CitationClient } from "./citationClient";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { WorkspacePanes } from "./Panes";
import { NoteView } from "./NoteView";
import { HomeView } from "./HomeView";
import { GraphView } from "./GraphView";
import { ContextPanel } from "./ContextPanel";
import { NotoAI } from "./NotoAI";
import { CommandPalette } from "./CommandPalette";
import { Toasts, type ToastItem } from "./Toasts";
import { SmartSearchPanel } from "./smartSearch/SmartSearchPanel";
import { useSmartSearch } from "./smartSearch/useSmartSearch";
import type { SmartResult } from "./smartSearch/types";

interface Props {
  controller: VaultController;
  /** localStorage namespace for the workspace session (omit to run ephemerally). */
  persistKey?: string;
  /** AI backend. Defaults to the scripted demo mock; the auth app injects the real one. */
  aiClient?: AIClient;
  /** Link-citation backend. Defaults to the offline demo mock; the auth app injects the real one. */
  citationClient?: CitationClient;
  /** MCP client for the "Connect AI tools" Settings panel (omit in the demo). */
  mcpClient?: McpClient;
  /** Bulk-ingest backend for the Dump modal (omit in the demo). */
  dumpClient?: DumpClient;
  /** Provenance/trust surface backend (omit in the demo). */
  activityClient?: ActivityClient;
}

export function NotoWindow({
  controller,
  persistKey,
  aiClient = mockAIClient,
  citationClient = mockCitationClient,
  mcpClient,
  dumpClient,
  activityClient,
}: Props) {
  const files = controller.files;

  const cache = useMemo(() => buildMetadataCache(files), [files]);
  const fullGraph = useMemo(() => buildGraph(files, cache), [files, cache]);

  const ws = useWorkspace({ controller, cache, persistKey });

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [dumpOpen, setDumpOpen] = useState(false);
  const [createVaultOpen, setCreateVaultOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityFileId, setActivityFileId] = useState<string | undefined>(undefined);
  const openActivity = (fileId?: string) => { setActivityFileId(fileId); setActivityOpen(true); };

  /* ----------------------------- smart search ---------------------------- */
  const [smartOpen, setSmartOpen] = useState(false);
  const smartOpenRef = useRef(smartOpen);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const [pendingReveal, setPendingReveal] = useState<{ fileId: string; text: string } | null>(null);
  const smart = useSmartSearch({ files, cache, vaultKey: persistKey ?? "demo", active: smartOpen });
  const smartResetRef = useRef(smart.reset);
  useEffect(() => {
    smartOpenRef.current = smartOpen;
    smartResetRef.current = smart.reset;
  });
  const closeSmart = useCallback(() => {
    setSmartOpen(false);
    smartResetRef.current();
  }, []);
  const openSmartResult = useCallback(
    (r: SmartResult) => {
      ws.openNote(r.fileId);
      setPendingReveal(r.highlightSentence ? { fileId: r.fileId, text: r.highlightSentence } : null);
      closeSmart();
    },
    [ws, closeSmart],
  );

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const createLecture = useCallback(
    (title: string, content: string) =>
      controller.createNoteAtPath(`AI Lecture Notes/${title}.md`, title, content, true),
    [controller],
  );

  // Grounding context for AI: the open note + a lightweight outline (titles +
  // headings) of the whole vault, and the other note titles for find-links.
  const getContext = useCallback((): AIContext => {
    const note = ws.currentNote();
    const outline = files
      .map((f) => {
        const headings = cache.filesById[f.id]?.headings ?? [];
        return headings.length
          ? `- ${f.title}\n${headings.map((h) => `  - ${h}`).join("\n")}`
          : `- ${f.title}`;
      })
      .join("\n");
    return {
      noteTitle: note?.title,
      noteContent: note?.content,
      outline,
      titles: files.filter((f) => f.id !== note?.id).map((f) => f.title),
    };
  }, [files, cache, ws]);

  const ai = useNotoAI({
    ai: aiClient,
    getContext,
    getCurrentNote: ws.currentNote,
    appendToNote: (id, content, immediate) => controller.updateContent(id, content, immediate),
    createLecture,
    openTitle: ws.openTitle,
    toast,
    initialOpen: controller.demo,
  });

  /* ----------------------------- derived data ---------------------------- */
  const filteredFiles = useMemo(() => {
    const q = ws.query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.title.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
  }, [files, ws.query]);

  const pinned = useMemo(() => filteredFiles.filter((f) => f.pinned), [filteredFiles]);
  const recent = useMemo(
    () => [...filteredFiles].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5),
    [filteredFiles],
  );
  const homeRecents = useMemo(
    () => [...files].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6),
    [files],
  );
  const folderOrder = useMemo(() => {
    const set = new Set<string>();
    for (const f of files) set.add(f.path.split("/")[0] || "Notes");
    return [...set].sort();
  }, [files]);

  const currentMeta = cache.filesById[ws.currentNoteId];
  const visibleGraph = useMemo(
    () => filterGraph(fullGraph, ws.graphFilter, ws.currentNoteId),
    [fullGraph, ws.graphFilter, ws.currentNoteId],
  );

  const focusedTabs = ws.focused === "right" && ws.rightTabs ? ws.rightTabs : ws.leftTabs;
  const focusedActiveId = ws.focused === "right" && ws.rightTabs ? ws.rightActive : ws.leftActive;
  const activeKind = focusedTabs.find((t) => t.id === focusedActiveId)?.kind ?? "note";

  const noteTitle = useCallback(
    (fileId: string | undefined) => files.find((f) => f.id === fileId)?.title ?? "Untitled",
    [files],
  );

  /* ------------------------------ shortcuts ------------------------------ */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.metaKey && e.ctrlKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        ai.toggle();
      }
      if (e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (smartOpenRef.current) closeSmart();
        else setSmartOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ai, closeSmart]);

  const paletteCommand = useCallback(
    (cmd: string) => {
      setPaletteOpen(false);
      switch (cmd) {
        case "smart-search": setSmartOpen(true); break;
        case "new-note": void ws.newNote(); break;
        case "open-home": ws.openHome(); break;
        case "open-graph": ws.openGraph(); break;
        case "toggle-ai": ai.toggle(); break;
        case "open-beside": ws.splitActive(); break;
        case "toggle-context": ws.toggleContext(); break;
        case "create-lecture": {
          const note = createLectureNote(`Lecture ${new Date().toLocaleDateString()}`, Date.now());
          void controller.createNoteAtPath(note.path, note.title, note.content).then((f) => {
            if (f) ws.openNote(f.id);
          });
          break;
        }
        case "insert-backlink": {
          const note = ws.currentNote();
          if (note) {
            controller.updateContent(note.id, `${note.content}\n- [[]]`);
            ws.openNote(note.id);
          }
          break;
        }
        case "open-dump": if (dumpClient) setDumpOpen(true); break;
      }
    },
    [ws, ai, controller, dumpClient],
  );

  /* ------------------------------- render -------------------------------- */
  const renderBody = (tab: Tab) => {
    if (tab.kind === "home") {
      return (
        <HomeView
          recents={homeRecents}
          onNewNote={() => void ws.newNote()}
          onRecordLecture={ai.requestRecord}
          onOpenGraph={ws.openGraph}
          onOpenNote={ws.openNote}
        />
      );
    }
    if (tab.kind === "graph") {
      return (
        <GraphView
          graph={visibleGraph}
          focusId={ws.currentNoteId}
          filter={ws.graphFilter}
          setFilter={ws.setGraphFilter}
          onSelect={ws.openNote}
        />
      );
    }
    const file: VaultFile | undefined = files.find((f) => f.id === tab.fileId);
    if (!file) return <div className="nw-empty nw-empty-pane">This note was deleted.</div>;
    return (
      <NoteView
        key={file.id}
        file={file}
        meta={cache.filesById[file.id]}
        saveStatus={controller.saveStatus}
        onContentChange={(content) => controller.updateContent(file.id, content)}
        onRename={(title) => void controller.renameNote(file.id, title)}
        onTogglePin={() => void controller.togglePin(file.id)}
        onDelete={() => {
          if (window.confirm(`Delete “${file.title}”? This can't be undone.`)) {
            ws.closeTabsForFile(file.id);
            void controller.deleteNote(file.id);
          }
        }}
        onWikiOpen={ws.openTitle}
        onWikiCreate={ws.wikiCreate}
        revealText={pendingReveal?.fileId === file.id ? pendingReveal.text : undefined}
        onRevealed={() => setPendingReveal((p) => (p?.fileId === file.id ? null : p))}
      />
    );
  };

  return (
    <CitationClientContext.Provider value={citationClient}>
    <div className="nw-root" data-screen-label="Noto · Workspace">
      <div className="nw-window">
        <TitleBar
          query={ws.query}
          setQuery={ws.setQuery}
          contextOpen={ws.contextOpen}
          onToggleContext={ws.toggleContext}
          onAskAI={ai.toggle}
          searchBoxRef={searchBoxRef}
        />
        <div className="nw-body">
          <Sidebar
            vaultName={controller.vaultName}
            files={filteredFiles}
            pinned={pinned}
            recent={recent}
            folderOrder={folderOrder}
            openFolders={ws.openFolders}
            currentNoteId={ws.currentNoteId}
            activeKind={activeKind}
            filtering={ws.query.trim().length > 0}
            onNewNote={() => void ws.newNote()}
            onOpenHome={ws.openHome}
            onOpenGraph={ws.openGraph}
            onOpenNote={ws.openNote}
            onToggleFolder={ws.toggleFolder}
            account={controller.demo ? undefined : controller.account ?? null}
            theme={controller.theme}
            onToggleTheme={controller.onToggleTheme}
            onLogout={controller.onLogout}
            onOpenConnect={mcpClient ? () => setMcpOpen(true) : undefined}
            onOpenDump={dumpClient ? () => setDumpOpen(true) : undefined}
            onOpenActivity={activityClient ? () => openActivity() : undefined}
            vaults={controller.vaults}
            activeVaultId={controller.activeVaultId}
            onSelectVault={controller.selectVault ? (id) => void controller.selectVault!(id) : undefined}
            onCreateVault={controller.createVault ? () => setCreateVaultOpen(true) : undefined}
          />
          <WorkspacePanes ws={ws} noteTitle={noteTitle} renderBody={renderBody} />
          {ws.contextOpen && (
            <ContextPanel
              meta={currentMeta}
              onOpenTitle={ws.openTitle}
              onOpenAiChanges={
                activityClient && activeKind === "note" && ws.currentNoteId
                  ? () => openActivity(ws.currentNoteId)
                  : undefined
              }
            />
          )}
        </div>
      </div>

      <NotoAI ai={ai} currentNoteTitle={ws.currentNote()?.title ?? null} />
      <Toasts toasts={toasts} />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onCommand={paletteCommand} />}
      {mcpOpen && mcpClient && <McpSettings client={mcpClient} onClose={() => setMcpOpen(false)} />}
      {dumpOpen && dumpClient && <DumpModal client={dumpClient} onClose={() => setDumpOpen(false)} toast={toast} />}
      {activityOpen && activityClient && (
        <ActivityView
          client={activityClient}
          initialFileId={activityFileId}
          onClose={() => setActivityOpen(false)}
          onOpenNote={ws.openNote}
        />
      )}
      {createVaultOpen && controller.createVault && (
        <CreateVaultModal
          onClose={() => setCreateVaultOpen(false)}
          onCreate={(input) => controller.createVault!(input)}
        />
      )}
      {smartOpen && (
        <SmartSearchPanel
          smart={smart}
          anchorRef={searchBoxRef}
          onClose={closeSmart}
          onOpenResult={openSmartResult}
        />
      )}
    </div>
    </CitationClientContext.Provider>
  );
}
