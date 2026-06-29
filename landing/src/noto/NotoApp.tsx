// Marketing-site preview of the Noto workspace.
//
// Runs the exact same redesigned workspace as the authenticated app, but against
// an in-memory mock vault (no auth, no persistence). This keeps the landing-page
// preview pixel-identical to the real product.
import { useCallback, useState } from "react";
import { NotoWindow } from "../workspace/NotoWindow";
import type { VaultController } from "../workspace/types";
import { SCHOOL_VAULT_FILES } from "../noto-core/mockVault";
import type { VaultFile } from "../noto-core";

const DAY = 86_400_000;
const SEED: VaultFile[] = SCHOOL_VAULT_FILES.map((f, i) => ({
  ...f,
  // Stagger timestamps so "Recent" has a sensible order in the demo.
  updatedAt: Date.now() - i * DAY,
  pinned: f.id === "biology-photosynthesis" || f.id === "ai-biology-lecture-may-13",
}));

let demoSeq = 0;

export function NotoApp() {
  const [files, setFiles] = useState<VaultFile[]>(SEED);

  const createNoteAtPath = useCallback<VaultController["createNoteAtPath"]>(
    async (path, title, content = `# ${title}\n\n`) => {
      const file: VaultFile = {
        id: `demo-${++demoSeq}`,
        path,
        title,
        content,
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setFiles((prev) => [file, ...prev]);
      return file;
    },
    [],
  );

  const createNote = useCallback<VaultController["createNote"]>(
    async (input) => {
      const folder = input?.folder ?? "Notes";
      const title = input?.title ?? `Untitled ${demoSeq + 1}`;
      return createNoteAtPath(`${folder}/${title}.md`, title, input?.content ?? `# ${title}\n\n`);
    },
    [createNoteAtPath],
  );

  const controller: VaultController = {
    vaultName: "Second Brain",
    files,
    saveStatus: "saved",
    demo: true,
    theme: "dark",
    updateContent: (id, content) =>
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, content, updatedAt: Date.now() } : f))),
    createNote,
    createNoteAtPath,
    renameNote: (id, title) => {
      setFiles((prev) =>
        prev.map((f) => {
          if (f.id !== id) return f;
          const slash = f.path.lastIndexOf("/");
          const folder = slash === -1 ? "" : f.path.slice(0, slash + 1);
          return { ...f, title, path: `${folder}${title}.md` };
        }),
      );
    },
    deleteNote: (id) => setFiles((prev) => prev.filter((f) => f.id !== id)),
    togglePin: (id) =>
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, pinned: !f.pinned } : f))),
  };

  return <NotoWindow controller={controller} />;
}
