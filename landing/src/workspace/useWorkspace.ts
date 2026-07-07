// Workspace UI state: open tabs per pane, split view, focus, folder expansion,
// search query, context panel, graph filter — plus the note/tab operations the
// chrome calls. For the authenticated app this slice is persisted to
// localStorage per vault; the demo runs it ephemerally (no persistKey).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MetadataCache } from "../noto-core";
import type { PaneId, PersistedWorkspace, Tab, TabKind, VaultController } from "./types";

interface Opts {
  controller: VaultController;
  cache: MetadataCache;
  persistKey?: string;
}

let tabSeq = 100;
const newTabId = () => `t${++tabSeq}`;

// Advance the id counter past any ids carried in from a restored session.
// `tabSeq` lives at module scope, so a page reload resets it to 100 while the
// persisted tabs keep their original ids — without this, the next freshly
// opened tab would re-mint an id (`t101`, `t102`, …) that already belongs to a
// restored tab. Duplicate ids break tab activation (find() returns the wrong
// tab) and closing (filter() drops both), which surfaced as "Knowledge Web
// won't open" and "closing a tab opens a random one".
function bumpTabSeq(...groups: (Tab[] | null | undefined)[]) {
  for (const tabs of groups) {
    for (const t of tabs ?? []) {
      const n = Number(/^t(\d+)$/.exec(t.id)?.[1]);
      if (Number.isFinite(n) && n > tabSeq) tabSeq = n;
    }
  }
}

/** Identity of a tab's *content*: one tab per note / per singleton view. */
function tabKey(t: Tab): string {
  return t.kind === "note" ? `note:${t.fileId ?? ""}` : t.kind;
}

/**
 * Repair a restored pane: drop duplicate tabs (one per note, one per
 * Home/Knowledge-Web view) and guarantee every surviving tab has an id unique
 * across the whole session. Older builds could mint colliding ids — the module
 * counter resets to its seed on every page load — so a persisted session could
 * end up with several tabs sharing an id (and stray duplicate views). That
 * wedges activation, which resolves the active tab with `find(t => t.id === …)`:
 * opening Knowledge Web while a Home tab shares its id leaves Home on screen.
 *
 * `used` is threaded across both panes so ids stay globally unique. Call
 * `bumpTabSeq` on the raw tabs first so any freshly minted replacement id sorts
 * above every restored id and can't re-collide.
 */
function normalizeTabs(tabs: Tab[], activeId: string | null, used: Set<string>) {
  // Mirror the old find-by-id resolution so the active tab carries across the
  // de-duplication: the first tab matching the stored active id wins.
  const activeMatch = tabs.find((t) => t.id === activeId);
  const activeKey = activeMatch ? tabKey(activeMatch) : null;

  const seen = new Set<string>();
  const out: Tab[] = [];
  let active: string | null = null;
  for (const t of tabs) {
    const key = tabKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    const id = used.has(t.id) ? newTabId() : t.id;
    used.add(id);
    out.push({ ...t, id });
    if (key === activeKey && active === null) active = id;
  }
  return { tabs: out, activeId: active ?? out[0]?.id ?? "" };
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "Notes" : path.slice(0, slash);
}

function pickWelcomeId(files: VaultController["files"]): string {
  const welcome = files.find((f) => f.title === "Welcome" || f.path.includes("Welcome"));
  return (welcome ?? files[0])?.id ?? "";
}

export function useWorkspace({ controller, cache, persistKey }: Opts) {
  const files = controller.files;

  // ---- initial state (restore from localStorage, else sensible default) ----
  const initial = useMemo<PersistedWorkspace>(() => {
    const fallback = (): PersistedWorkspace => {
      const id = pickWelcomeId(files);
      const noteTab: Tab = { id: newTabId(), kind: "note", fileId: id };
      const homeTab: Tab = { id: newTabId(), kind: "home" };
      return {
        leftTabs: id ? [noteTab, homeTab] : [homeTab],
        leftActive: id ? noteTab.id : homeTab.id,
        rightTabs: null,
        rightActive: null,
        focused: "left",
        openFolders: {},
        contextOpen: true,
      };
    };
    if (!persistKey) return fallback();
    try {
      const raw = localStorage.getItem(`noto-ws:v1:${persistKey}`);
      if (!raw) return fallback();
      const parsed = JSON.parse(raw) as PersistedWorkspace;
      const exists = new Set(files.map((f) => f.id));
      const prune = (tabs: Tab[] | null) =>
        tabs?.filter((t) => t.kind !== "note" || (t.fileId && exists.has(t.fileId))) ?? null;
      const left = prune(parsed.leftTabs) ?? [];
      if (left.length === 0) return fallback();
      const right = parsed.rightTabs ? prune(parsed.rightTabs) : null;
      bumpTabSeq(left, right);
      const used = new Set<string>();
      const ln = normalizeTabs(left, parsed.leftActive, used);
      const rn = right && right.length ? normalizeTabs(right, parsed.rightActive, used) : null;
      const hasRight = !!(rn && rn.tabs.length);
      return {
        leftTabs: ln.tabs,
        leftActive: ln.activeId,
        rightTabs: hasRight ? rn!.tabs : null,
        rightActive: hasRight ? rn!.activeId : null,
        focused: hasRight && parsed.focused === "right" ? "right" : "left",
        openFolders: parsed.openFolders ?? {},
        contextOpen: parsed.contextOpen ?? true,
      };
    } catch {
      return fallback();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compute once on mount
  }, []);

  const [leftTabs, setLeftTabs] = useState<Tab[]>(initial.leftTabs);
  const [leftActive, setLeftActive] = useState(initial.leftActive);
  const [rightTabs, setRightTabs] = useState<Tab[] | null>(initial.rightTabs);
  const [rightActive, setRightActive] = useState<string | null>(initial.rightActive);
  const [focused, setFocused] = useState<PaneId>(initial.focused);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>(initial.openFolders);
  const [contextOpen, setContextOpen] = useState(initial.contextOpen);
  const [query, setQuery] = useState("");
  const [lastNoteId, setLastNoteId] = useState(() => {
    const t = initial.leftTabs.find((x) => x.id === initial.leftActive);
    return t?.fileId ?? pickWelcomeId(files);
  });

  // ---- persist ----
  useEffect(() => {
    if (!persistKey) return;
    const snapshot: PersistedWorkspace = {
      leftTabs, leftActive, rightTabs, rightActive, focused, openFolders, contextOpen,
    };
    try {
      localStorage.setItem(`noto-ws:v1:${persistKey}`, JSON.stringify(snapshot));
    } catch {
      /* ignore quota / privacy-mode failures */
    }
  }, [persistKey, leftTabs, leftActive, rightTabs, rightActive, focused, openFolders, contextOpen]);

  // Tabs referencing a deleted file are closed by `closeTabsForFile` (called
  // from the delete action) and pruned from any restored session in `initial`,
  // so no reactive effect is needed here. A tab whose file vanishes by some
  // other path renders a graceful "deleted" placeholder until closed.

  const effectivePane = (): PaneId => (focused === "right" && rightTabs ? "right" : "left");
  const getTabs = (pane: PaneId) => (pane === "left" ? leftTabs : rightTabs ?? []);
  const setTabs = (pane: PaneId, tabs: Tab[]) => (pane === "left" ? setLeftTabs(tabs) : setRightTabs(tabs));
  const setActive = (pane: PaneId, id: string | null) =>
    pane === "left" ? setLeftActive(id ?? "") : setRightActive(id);

  // ---- open / activate ----
  const openNote = useCallback(
    (id: string) => {
      if (!id) return;
      void controller.flush?.();
      const pane = effectivePane();
      const tabs = getTabs(pane);
      const existing = tabs.find((t) => t.kind === "note" && t.fileId === id);
      if (existing) {
        setActive(pane, existing.id);
      } else {
        const tab: Tab = { id: newTabId(), kind: "note", fileId: id };
        setTabs(pane, [...tabs, tab]);
        setActive(pane, tab.id);
      }
      setLastNoteId(id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, leftTabs, rightTabs, focused],
  );

  const openKind = useCallback(
    (kind: Exclude<TabKind, "note">) => {
      const pane = effectivePane();
      const tabs = getTabs(pane);
      const existing = tabs.find((t) => t.kind === kind);
      if (existing) {
        setActive(pane, existing.id);
      } else {
        const tab: Tab = { id: newTabId(), kind };
        setTabs(pane, [...tabs, tab]);
        setActive(pane, tab.id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leftTabs, rightTabs, focused],
  );

  const openHome = useCallback(() => openKind("home"), [openKind]);
  const openGraph = useCallback(() => openKind("graph"), [openKind]);

  const activate = useCallback(
    (pane: PaneId, id: string) => {
      void controller.flush?.();
      setFocused(pane);
      setActive(pane, id);
      const tab = getTabs(pane).find((t) => t.id === id);
      if (tab?.kind === "note" && tab.fileId) setLastNoteId(tab.fileId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, leftTabs, rightTabs],
  );

  const closeTab = useCallback(
    (pane: PaneId, id: string) => {
      const tabs = getTabs(pane);
      const idx = tabs.findIndex((t) => t.id === id);
      const next = tabs.filter((t) => t.id !== id);
      if (pane === "right" && next.length === 0) {
        setRightTabs(null);
        setRightActive(null);
        setFocused("left");
        return;
      }
      setTabs(pane, next);
      const activeId = pane === "left" ? leftActive : rightActive;
      if (activeId === id) {
        const fallback = next[idx] ?? next[idx - 1] ?? next[0];
        setActive(pane, fallback?.id ?? null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leftTabs, rightTabs, leftActive, rightActive],
  );

  const splitActive = useCallback(() => {
    if (rightTabs) return;
    const lt = leftTabs.find((t) => t.id === leftActive) ?? leftTabs[0];
    if (!lt) return;
    const tab: Tab = { ...lt, id: newTabId() };
    setRightTabs([tab]);
    setRightActive(tab.id);
    setFocused("right");
  }, [rightTabs, leftTabs, leftActive]);

  const closeSplit = useCallback(() => {
    setRightTabs(null);
    setRightActive(null);
    setFocused("left");
  }, []);

  // Close every tab (both panes) pointing at a now-deleted file, keeping each
  // pane's active id valid. Called from the delete action.
  const closeTabsForFile = useCallback(
    (fileId: string) => {
      const dead = (t: Tab) => t.kind === "note" && t.fileId === fileId;
      const nextLeft = leftTabs.filter((t) => !dead(t));
      const left = nextLeft.length ? nextLeft : [{ id: newTabId(), kind: "home" as const }];
      setLeftTabs(left);
      if (!left.some((t) => t.id === leftActive)) setLeftActive(left[0].id);
      if (rightTabs) {
        const nextRight = rightTabs.filter((t) => !dead(t));
        if (nextRight.length === 0) {
          setRightTabs(null);
          setRightActive(null);
          setFocused("left");
        } else {
          setRightTabs(nextRight);
          if (!nextRight.some((t) => t.id === rightActive)) setRightActive(nextRight[0].id);
        }
      }
    },
    [leftTabs, leftActive, rightTabs, rightActive],
  );

  // Move a tab to a position in any pane. `to.index` is the insertion index in
  // the destination pane's list *after the dragged tab has been removed* — the
  // convention the drag layer computes against. Handles same-pane reordering,
  // cross-pane moves, and the two collapse cases (a pane emptied by the move).
  const moveTab = useCallback(
    (from: { pane: PaneId; id: string }, to: { pane: PaneId; index: number }) => {
      void controller.flush?.();
      const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max));
      const src = [...getTabs(from.pane)];
      const fromIdx = src.findIndex((t) => t.id === from.id);
      if (fromIdx < 0) return;
      const [moved] = src.splice(fromIdx, 1);

      if (from.pane === to.pane) {
        src.splice(clamp(to.index, src.length), 0, moved);
        setTabs(from.pane, src);
        setActive(from.pane, moved.id);
        setFocused(from.pane);
        if (moved.kind === "note" && moved.fileId) setLastNoteId(moved.fileId);
        return;
      }

      const dst = [...getTabs(to.pane)];
      dst.splice(clamp(to.index, dst.length), 0, moved);

      if (src.length === 0) {
        // The source pane lost its last tab: collapse the split into a single
        // (always-present) left pane holding the destination's tabs.
        setLeftTabs(dst);
        setLeftActive(moved.id);
        setRightTabs(null);
        setRightActive(null);
        setFocused("left");
      } else {
        setTabs(from.pane, src);
        const srcActive = from.pane === "left" ? leftActive : rightActive;
        if (srcActive === moved.id) {
          setActive(from.pane, src[Math.min(fromIdx, src.length - 1)]?.id ?? null);
        }
        setTabs(to.pane, dst);
        setActive(to.pane, moved.id);
        setFocused(to.pane);
      }
      if (moved.kind === "note" && moved.fileId) setLastNoteId(moved.fileId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, leftTabs, rightTabs, leftActive, rightActive],
  );

  const toggleFolder = useCallback(
    (name: string) => setOpenFolders((s) => ({ ...s, [name]: !s[name] })),
    [],
  );

  // ---- note creation / wiki resolution ----
  const newNote = useCallback(async () => {
    const f = await controller.createNote();
    if (f) openNote(f.id);
  }, [controller, openNote]);

  const currentNote = useCallback(() => {
    const pane = effectivePane();
    const tab = getTabs(pane).find((t) => t.id === (pane === "left" ? leftActive : rightActive));
    const id = tab?.kind === "note" ? tab.fileId : undefined;
    return files.find((f) => f.id === (id ?? lastNoteId)) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, leftTabs, rightTabs, leftActive, rightActive, focused, lastNoteId]);

  const openTitle = useCallback(
    (title: string) => {
      const id = cache.fileIdByTitle[title];
      if (id) {
        openNote(id);
        return;
      }
      const note = currentNote();
      const folder = note ? folderOf(note.path) : "Notes";
      void controller.createNoteAtPath(`${folder}/${title}.md`, title).then((f) => {
        if (f) openNote(f.id);
      });
    },
    [cache, controller, currentNote, openNote],
  );

  const wikiCreate = useCallback(
    (title: string) => {
      if (cache.fileIdByTitle[title]) return;
      const note = currentNote();
      const folder = note ? folderOf(note.path) : "Notes";
      void controller.createNoteAtPath(`${folder}/${title}.md`, title, undefined, false);
    },
    [cache, controller, currentNote],
  );

  // The note the Context panel + graph focus describe (follows focused pane).
  const currentNoteId = currentNote()?.id ?? "";

  return {
    // state
    leftTabs, leftActive, rightTabs, rightActive, focused,
    openFolders, contextOpen, query, currentNoteId,
    // setters
    setQuery,
    toggleContext: () => setContextOpen((o) => !o),
    setContextOpen,
    toggleFolder,
    // tab ops
    openNote, openHome, openGraph, activate, closeTab, splitActive, closeSplit, moveTab, closeTabsForFile,
    newNote, openTitle, wikiCreate, currentNote,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
