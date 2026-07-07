import { useVault } from "./useVault";
import { NotoWindow } from "../workspace/NotoWindow";
import { AppLoading, AppError } from "./AppStatus";
import { realAIClient } from "./aiClient";
import { realCitationClient } from "./citationClient";
import { realMcpClient } from "./mcpClient";
import { realDumpClient } from "./dumpClient";
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
    vaults: v.vaults,
    activeVaultId: v.activeVaultId,
    selectVault: v.selectVault,
    createVault: v.createVault,
  };

  return (
    // Key by vault id so switching vaults remounts the workspace: each vault
    // restores its own saved tab session (or resets to the default when it has
    // none), and the per-vault persist effect can't clobber another vault's
    // snapshot with the outgoing vault's tabs.
    <NotoWindow
      key={v.vault?.id ?? "default"}
      controller={controller}
      persistKey={v.vault?.id ?? "default"}
      aiClient={realAIClient}
      citationClient={realCitationClient}
      mcpClient={realMcpClient}
      dumpClient={realDumpClient}
      activityClient={realActivityClient}
    />
  );
}
