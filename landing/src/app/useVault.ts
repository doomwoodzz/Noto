import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, setActiveVault, type Vault } from "./api";
import type { VaultFile } from "../noto-core";
import { pickInitialVault } from "../workspace/vaultIcons";

const ACTIVE_VAULT_KEY = (userId: string) => `noto:active-vault:${userId}`;

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
  vaults: Vault[];
  activeVaultId: string;
  vault: Vault | null;
  files: VaultFile[];
  activeFileId: string;
  activeFile: VaultFile | null;
  saveStatus: SaveStatus;
  selectFile: (id: string) => void;
  updateContent: (fileId: string, content: string, immediate?: boolean) => void;
  createNote: (input?: { folder?: string; title?: string; content?: string }) => Promise<VaultFile | null>;
  createNoteAtPath: (path: string, title: string, content?: string, select?: boolean) => Promise<VaultFile | null>;
  renameNote: (fileId: string, newTitle: string) => Promise<void>;
  deleteNote: (fileId: string) => Promise<void>;
  togglePin: (fileId: string) => Promise<void>;
  /** Force-write any debounced edits now (e.g. before switching notes). */
  flush: () => Promise<void>;
  selectVault: (id: string) => Promise<void>;
  createVault: (input: { name: string; icon?: string | null; color?: string | null }) => Promise<Vault | null>;
}

export function useVault(userId: string): UseVault {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vaults, setVaults] = useState<Vault[]>([]);
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

  // Initial load: vaults → persisted or first vault → its files.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { vaults: list } = await api.listVaults();
        let persisted: string | null = null;
        try { persisted = localStorage.getItem(ACTIVE_VAULT_KEY(userId)); } catch { /* ignore */ }
        const initial = pickInitialVault(list, persisted);
        if (!initial) throw new Error("No vault");
        const { files: loaded } = await api.listFiles(initial.id);
        if (cancelled) return;
        setVaults(list);
        setVault(initial);
        setActiveVault(initial.id);
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
  }, [userId]);

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
    async (path: string, title: string, content = `# ${title}\n\n`, select = true): Promise<VaultFile | null> => {
      if (!vault) return null;
      try {
        const { file } = await api.createFile(vault.id, { path, title, content });
        setFiles((prev) => [...prev, file]);
        if (select) setActiveFileId(file.id);
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

  const togglePin = useCallback(
    async (fileId: string): Promise<void> => {
      const file = files.find((f) => f.id === fileId);
      if (!file) return;
      const next = !file.pinned;
      // Optimistic — pinning is a low-stakes toggle; revert on failure.
      setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, pinned: next } : f)));
      try {
        const { file: updated } = await api.updateFile(fileId, { pinned: next });
        setFiles((prev) => prev.map((f) => (f.id === fileId ? updated : f)));
      } catch (e) {
        setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, pinned: !next } : f)));
        setError(e instanceof ApiError ? e.message : "Could not update the note.");
      }
    },
    [files],
  );

  const selectVault = useCallback(
    async (id: string): Promise<void> => {
      if (id === vault?.id) return;
      await flush();
      try {
        const target = vaults.find((v) => v.id === id);
        if (!target) return;
        const { files: loaded } = await api.listFiles(id);
        setVault(target);
        setActiveVault(id);
        setFiles(loaded);
        setActiveFileId(loaded[0]?.id ?? "");
        setSaveStatus("idle");
        try { localStorage.setItem(ACTIVE_VAULT_KEY(userId), id); } catch { /* ignore */ }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not open that vault.");
      }
    },
    [vault, vaults, flush, userId],
  );

  const createVault = useCallback(
    async (input: { name: string; icon?: string | null; color?: string | null }): Promise<Vault | null> => {
      try {
        const { vault: created } = await api.createVault(input);
        setVaults((prev) => [...prev, created]);
        await flush();
        const { files: loaded } = await api.listFiles(created.id);
        setVault(created);
        setActiveVault(created.id);
        setFiles(loaded);
        setActiveFileId(loaded[0]?.id ?? "");
        try { localStorage.setItem(ACTIVE_VAULT_KEY(userId), created.id); } catch { /* ignore */ }
        return created;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not create the vault.");
        return null;
      }
    },
    [flush, userId],
  );

  const activeFile = files.find((f) => f.id === activeFileId) ?? null;

  return {
    loading,
    error,
    vaults,
    activeVaultId: vault?.id ?? "",
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
    togglePin,
    flush,
    selectVault,
    createVault,
  };
}
