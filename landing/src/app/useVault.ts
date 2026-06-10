import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Vault } from "./api";
import type { VaultFile } from "../noto-core";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_MS = 700;

/** Replace the filename of a path, keeping its folder prefix. */
function repath(path: string, newTitle: string): string {
  const slash = path.lastIndexOf("/");
  const folder = slash === -1 ? "" : path.slice(0, slash + 1);
  return `${folder}${newTitle}.md`;
}

export interface UseVault {
  loading: boolean;
  error: string | null;
  vault: Vault | null;
  files: VaultFile[];
  activeFileId: string;
  activeFile: VaultFile | null;
  saveStatus: SaveStatus;
  selectFile: (id: string) => void;
  updateContent: (fileId: string, content: string, immediate?: boolean) => void;
  createNote: (input?: { folder?: string; title?: string; content?: string }) => Promise<VaultFile | null>;
  createNoteAtPath: (path: string, title: string, content?: string) => Promise<VaultFile | null>;
  renameNote: (fileId: string, newTitle: string) => Promise<void>;
  deleteNote: (fileId: string) => Promise<void>;
}

export function useVault(): UseVault {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [activeFileId, setActiveFileId] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // Latest unsaved content per file id, and the debounce timer.
  const pending = useRef<Map<string, string>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const entries = [...pending.current.entries()];
    if (entries.length === 0) return;
    pending.current.clear();
    try {
      for (const [fileId, content] of entries) {
        const { file } = await api.updateFile(fileId, { content });
        setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, updatedAt: file.updatedAt } : f)));
      }
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }, []);

  // Initial load: vaults → first vault → its files.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { vaults } = await api.listVaults();
        const v = vaults[0];
        if (!v) throw new Error("No vault");
        const { files: loaded } = await api.listFiles(v.id);
        if (cancelled) return;
        setVault(v);
        setFiles(loaded);
        setActiveFileId(loaded[0]?.id ?? "");
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Could not load your vault.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Save on tab close / hide (best-effort).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    window.addEventListener("visibilitychange", onHide);
    return () => window.removeEventListener("visibilitychange", onHide);
  }, [flush]);

  const updateContent = useCallback(
    (fileId: string, content: string, immediate = false) => {
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, content, updatedAt: Date.now() } : f)),
      );
      pending.current.set(fileId, content);
      setSaveStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      if (immediate) {
        void flush();
      } else {
        timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
      }
    },
    [flush],
  );

  const selectFile = useCallback(
    (id: string) => {
      void flush();
      setActiveFileId(id);
    },
    [flush],
  );

  const createNoteAtPath = useCallback(
    async (path: string, title: string, content = `# ${title}\n\n`): Promise<VaultFile | null> => {
      if (!vault) return null;
      try {
        const { file } = await api.createFile(vault.id, { path, title, content });
        setFiles((prev) => [...prev, file]);
        setActiveFileId(file.id);
        return file;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not create the note.");
        return null;
      }
    },
    [vault],
  );

  const createNote = useCallback(
    async (input?: { folder?: string; title?: string; content?: string }): Promise<VaultFile | null> => {
      const folder = input?.folder ?? "Notes";
      let title = input?.title;
      if (!title) {
        const prefix = `${folder}/Untitled`;
        const n = files.filter((f) => f.path.startsWith(prefix)).length + 1;
        title = `Untitled ${n}`;
      }
      const path = `${folder}/${title}.md`;
      return createNoteAtPath(path, title, input?.content ?? `# ${title}\n\n`);
    },
    [files, createNoteAtPath],
  );

  const renameNote = useCallback(
    async (fileId: string, newTitle: string): Promise<void> => {
      const file = files.find((f) => f.id === fileId);
      const title = newTitle.trim();
      if (!file || title.length === 0 || title === file.title) return;
      const path = repath(file.path, title);
      try {
        const { file: updated } = await api.updateFile(fileId, { title, path });
        setFiles((prev) => prev.map((f) => (f.id === fileId ? updated : f)));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not rename the note.");
      }
    },
    [files],
  );

  const deleteNote = useCallback(
    async (fileId: string): Promise<void> => {
      try {
        await api.deleteFile(fileId);
        setFiles((prev) => {
          const next = prev.filter((f) => f.id !== fileId);
          setActiveFileId((cur) => (cur === fileId ? next[0]?.id ?? "" : cur));
          return next;
        });
        pending.current.delete(fileId);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not delete the note.");
      }
    },
    [],
  );

  const activeFile = files.find((f) => f.id === activeFileId) ?? null;

  return {
    loading,
    error,
    vault,
    files,
    activeFileId,
    activeFile,
    saveStatus,
    selectFile,
    updateContent,
    createNote,
    createNoteAtPath,
    renameNote,
    deleteNote,
  };
}
