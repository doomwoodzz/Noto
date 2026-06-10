import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppTitleBar } from "./AppTitleBar";
import { NoteEditor } from "./Editor";
import { AppKnowledgeGraph } from "./AppKnowledgeGraph";
import { useVault } from "./useVault";
import { VaultSidebar } from "../noto/VaultSidebar";
import { RightContext } from "../noto/RightContext";
import { CommandPalette } from "../noto/CommandPalette";
import { AIRecorder } from "../noto/AIRecorder";
import { AI_QUESTIONS } from "../noto/aiDemo";
import type { FileMetadata as DemoMeta, VaultFile as DemoFile } from "../noto/types";
import type { Theme } from "../landing/useTheme";
import type { PublicUser } from "./api";
import {
  AIRecorder as RecorderCore,
  appendAINotes,
  buildGraph,
  buildMetadataCache,
  createLectureNote,
  filterGraph,
  type GraphFilter,
} from "../noto-core";

interface Props {
  user: PublicUser;
  theme: Theme;
  onToggleTheme: () => void;
  onLogout: () => void;
}

type RecPhase = "idle" | "recording" | "processing" | "complete";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "Notes" : path.slice(0, slash);
}

export function NotoWorkspace({ user, theme, onToggleTheme, onLogout }: Props) {
  const vault = useVault();
  const {
    files,
    activeFile,
    activeFileId,
    selectFile,
    updateContent,
    createNote,
    createNoteAtPath,
    renameNote,
    deleteNote,
    saveStatus,
  } = vault;

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"note" | "graph">("note");
  const [editMode, setEditMode] = useState(false);
  const [rightOn, setRightOn] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [graphFilter, setGraphFilter] = useState<GraphFilter>("all");

  /* ----------------------------- derived data ---------------------------- */
  const cache = useMemo(() => buildMetadataCache(files), [files]);
  const graph = useMemo(() => buildGraph(files, cache), [files, cache]);
  const visibleGraph = useMemo(
    () => filterGraph(graph, graphFilter, activeFileId),
    [graph, graphFilter, activeFileId],
  );

  const demoFiles: DemoFile[] = useMemo(
    () => files.map((f) => ({ id: f.id, path: f.path, title: f.title, updatedAt: formatDate(f.updatedAt), content: f.content })),
    [files],
  );
  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return demoFiles;
    return demoFiles.filter((f) => f.title.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
  }, [query, demoFiles]);

  const folderOrder = useMemo(() => {
    const set = new Set<string>();
    for (const f of files) set.add(f.path.split("/")[0]);
    return [...set].sort();
  }, [files]);

  const activeMeta = cache.filesById[activeFileId];
  const demoMeta: DemoMeta | undefined = activeMeta
    ? { ...activeMeta, updatedAt: formatDate(activeMeta.updatedAt) }
    : undefined;

  /* ------------------------------- recorder ------------------------------ */
  const recorderRef = useRef(new RecorderCore());
  const [recPhase, setRecPhase] = useState<RecPhase>("idle");
  const [recElapsed, setRecElapsed] = useState(0);
  const [recConcepts, setRecConcepts] = useState<string[]>([]);
  const [recLinked, setRecLinked] = useState<string[]>([]);
  const [recTarget, setRecTarget] = useState("Current Note");
  const [recSession, setRecSession] = useState(0);

  useEffect(() => {
    if (recPhase !== "recording") return;
    const id = setInterval(() => {
      const r = recorderRef.current;
      r.tick();
      setRecElapsed(r.elapsedSeconds);
      setRecConcepts([...r.memory.concepts]);
      setRecLinked([...r.memory.linkedNotes]);
    }, 2000);
    return () => clearInterval(id);
  }, [recPhase]);

  const recorderStart = useCallback(() => {
    const r = new RecorderCore();
    recorderRef.current = r;
    r.start(Date.now());
    setRecTarget(activeFile?.title ?? "Current Note");
    setRecSession((s) => s + 1);
    setRecPhase("recording");
    setRecElapsed(0);
    setRecConcepts([]);
    setRecLinked([]);
  }, [activeFile]);

  const recorderStop = useCallback(() => {
    const r = recorderRef.current;
    r.stop();
    setRecPhase("processing");
    setRecConcepts([...r.memory.concepts]);
    setRecLinked([...r.memory.linkedNotes]);
    const target = activeFile;
    setTimeout(() => {
      if (target) {
        const updated = appendAINotes(target, r.memory, Date.now());
        updateContent(target.id, updated.content, true);
      }
      r.finishProcessing(target?.title ?? "Current Note");
      setRecPhase("complete");
    }, 900);
  }, [activeFile, updateContent]);

  const recorderReset = useCallback(() => {
    recorderRef.current.reset();
    setRecSession((s) => s + 1);
    setRecPhase("idle");
    setRecElapsed(0);
    setRecConcepts([]);
    setRecLinked([]);
  }, []);

  /* ----------------------------- interactions ---------------------------- */
  const newNote = useCallback(async () => {
    const file = await createNote();
    if (file) {
      setTab("note");
      setEditMode(true);
    }
  }, [createNote]);

  const handleWikiOpen = useCallback(
    (title: string) => {
      const id = cache.fileIdByTitle[title];
      if (id) {
        selectFile(id);
        setTab("note");
        return;
      }
      const folder = activeFile ? folderOf(activeFile.path) : "Notes";
      if (window.confirm(`“${title}” doesn't exist yet. Create it?`)) {
        void createNoteAtPath(`${folder}/${title}.md`, title).then((f) => {
          if (f) {
            setTab("note");
            setEditMode(true);
          }
        });
      }
    },
    [cache, selectFile, activeFile, createNoteAtPath],
  );

  const paletteCommand = useCallback(
    (cmd: string) => {
      setPaletteOpen(false);
      switch (cmd) {
        case "new-note":
          void newNote();
          break;
        case "open-graph":
          setTab("graph");
          break;
        case "toggle-recorder":
          setRecorderOpen((o) => !o);
          break;
        case "local-graph":
          setTab("graph");
          setGraphFilter("local");
          break;
        case "create-lecture": {
          const note = createLectureNote(`Lecture ${new Date().toLocaleDateString()}`, Date.now());
          void createNoteAtPath(note.path, note.title, note.content).then((f) => {
            if (f) {
              setTab("note");
              setEditMode(true);
            }
          });
          break;
        }
        case "insert-backlink":
          if (activeFile) {
            updateContent(activeFile.id, `${activeFile.content}\n- [[]]`);
            setTab("note");
            setEditMode(true);
          }
          break;
        default:
          setTab("note");
      }
    },
    [newNote, createNoteAtPath, activeFile, updateContent],
  );

  // Global shortcuts: ⌘K palette, ⌃⌘M recorder.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.metaKey && e.ctrlKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setRecorderOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const aiMemory = { concepts: recConcepts, linked: recLinked };

  if (vault.loading) {
    return <div className="app-loading">Loading your vault…</div>;
  }
  if (vault.error) {
    return <div className="app-loading">{vault.error}</div>;
  }

  return (
    <div className="noto-app app-fullscreen" data-screen-label="Noto · Workspace">
      <AppTitleBar
        slogan="When you listen, Noto remembers"
        email={user.email}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onToggleCommand={() => setPaletteOpen((o) => !o)}
        onToggleRightSidebar={() => setRightOn((o) => !o)}
        onLogout={onLogout}
      />
      <div className="noto-body">
        <VaultSidebar
          vaultName={vault.vault?.name ?? "My Vault"}
          query={query}
          setQuery={setQuery}
          files={filteredFiles}
          folderOrder={folderOrder}
          activeFileId={activeFileId}
          onSelect={(id) => {
            selectFile(id);
            setTab("note");
          }}
          onNewNote={() => void newNote()}
          onOpenGraph={() => setTab("graph")}
        />

        <div className="noto-workspace">
          <div className="noto-tabbar">
            <button className={"noto-tab" + (tab === "note" ? " is-active" : "")} onClick={() => setTab("note")}>
              Note
            </button>
            <button className={"noto-tab" + (tab === "graph" ? " is-active" : "")} onClick={() => setTab("graph")}>
              Knowledge Web
            </button>
          </div>
          <div className="noto-workspace-body">
            {tab === "note" ? (
              activeFile ? (
                <NoteEditor
                  file={activeFile}
                  editMode={editMode}
                  setEditMode={setEditMode}
                  onContentChange={(content) => updateContent(activeFile.id, content)}
                  onRename={(title) => void renameNote(activeFile.id, title)}
                  onWikiOpen={handleWikiOpen}
                  onDelete={() => {
                    if (window.confirm(`Delete “${activeFile.title}”? This can't be undone.`)) {
                      void deleteNote(activeFile.id);
                    }
                  }}
                  saveStatus={saveStatus}
                />
              ) : (
                <div className="noto-empty" style={{ padding: 48 }}>
                  No note selected. Create one to get started.
                </div>
              )
            ) : (
              <AppKnowledgeGraph
                graph={visibleGraph}
                activeFileId={activeFileId}
                onSelect={(id) => {
                  selectFile(id);
                  setTab("note");
                }}
                filter={graphFilter}
                setFilter={setGraphFilter}
              />
            )}
          </div>
        </div>

        {rightOn && <RightContext metadata={demoMeta} aiMemory={aiMemory} />}
      </div>

      {recorderOpen && (
        <AIRecorder
          key={recSession}
          phase={recPhase}
          elapsed={recElapsed}
          concepts={recConcepts}
          targetNoteTitle={recTarget}
          questions={AI_QUESTIONS}
          onStart={recorderStart}
          onStop={recorderStop}
          onOpenNote={() => setTab("note")}
          onViewLinks={() => setTab("graph")}
          onRecordMore={recorderReset}
        />
      )}

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onCommand={paletteCommand} />}

      <div className="noto-hint">
        <span>
          <kbd>⌘K</kbd> palette
        </span>
        <span>
          <kbd>⌃⌘M</kbd> recorder
        </span>
      </div>
    </div>
  );
}
