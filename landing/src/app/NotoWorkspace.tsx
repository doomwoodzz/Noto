import { useVault } from "./useVault";
import { NotoWindow } from "../workspace/NotoWindow";
import { AppLoading, AppError } from "./AppStatus";
import { realAIClient } from "./aiClient";
import { realCitationClient } from "./citationClient";
import { realMcpClient } from "./mcpClient";
import { realActivityClient } from "./activityClient";
import type { VaultController } from "../workspace/types";
import type { Theme } from "../landing/useTheme";
import type { PublicUser } from "./api";

interface Props {
  user: PublicUser;
  theme: Theme;
  onToggleTheme: () => void;
  onLogout: () => void;
}

/**
 * The authenticated workspace. Adapts the REST-backed `useVault` into the
 * surface-agnostic `VaultController` the redesigned workspace renders against,
 * and persists the tab session per vault.
 */
export function NotoWorkspace({ user, theme, onToggleTheme, onLogout }: Props) {
  const v = useVault(user.id);

  if (v.loading) {
    return <AppLoading message="Loading your vault…" />;
  }
  if (v.error) {
    return <AppError message={v.error} />;
  }

  const controller: VaultController = {
    vaultName: v.vault?.name ?? "My Vault",
    files: v.files,
    saveStatus: v.saveStatus,
    account: { email: user.email },
    theme,
    updateContent: v.updateContent,
    createNote: v.createNote,
    createNoteAtPath: v.createNoteAtPath,
    renameNote: v.renameNote,
    deleteNote: v.deleteNote,
    togglePin: v.togglePin,
    flush: v.flush,
    onToggleTheme,
    onLogout,
  };

  return (
    <NotoWindow
      controller={controller}
      persistKey={v.vault?.id ?? "default"}
      aiClient={realAIClient}
      citationClient={realCitationClient}
      mcpClient={realMcpClient}
      activityClient={realActivityClient}
    />
  );
}
