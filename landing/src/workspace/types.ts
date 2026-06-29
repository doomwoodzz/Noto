// Shared types for the redesigned Noto workspace.
//
// The workspace UI is surface-agnostic: it renders against a `VaultController`,
// which the authenticated app implements with the REST API (`useVault`) and the
// marketing demo implements with an in-memory mock vault. Both speak the same
// canonical `VaultFile` shape from noto-core.

import type { VaultFile } from "../noto-core";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** The data + mutation surface the workspace needs from its host. */
export interface VaultController {
  vaultName: string;
  files: VaultFile[];
  saveStatus: SaveStatus;
  /** Account chip shown in the sidebar footer (null in the demo). */
  account?: { email: string | null } | null;
  /** Demo mode disables persistence and account/theme controls. */
  demo?: boolean;
  theme?: "light" | "dark";

  updateContent(fileId: string, content: string, immediate?: boolean): void;
  createNote(input?: { folder?: string; title?: string; content?: string }): Promise<VaultFile | null>;
  createNoteAtPath(
    path: string,
    title: string,
    content?: string,
    select?: boolean,
  ): Promise<VaultFile | null>;
  renameNote(fileId: string, title: string): void | Promise<void>;
  deleteNote(fileId: string): void | Promise<void>;
  togglePin(fileId: string): void | Promise<void>;
  /** Force-write debounced edits (called before switching the active note). */
  flush?(): void | Promise<void>;

  /** Account actions (real app only). */
  onToggleTheme?(): void;
  onLogout?(): void;
}

export type TabKind = "note" | "home" | "graph";

export interface Tab {
  id: string;
  kind: TabKind;
  /** Present when kind === "note". */
  fileId?: string;
}

export type PaneId = "left" | "right";

/** The slice of workspace state that we persist to localStorage per vault. */
export interface PersistedWorkspace {
  leftTabs: Tab[];
  leftActive: string;
  rightTabs: Tab[] | null;
  rightActive: string | null;
  focused: PaneId;
  openFolders: Record<string, boolean>;
  contextOpen: boolean;
  graphFilter: "all" | "linked" | "orphans";
}
