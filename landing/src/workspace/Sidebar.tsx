import { useState } from "react";
import type { VaultFile } from "../noto-core";
import { Icon, type IconName } from "./icons";
import type { TabKind } from "./types";
import { VaultSwitcher } from "./VaultSwitcher";

interface Props {
  vaultName: string;
  files: VaultFile[];
  pinned: VaultFile[];
  recent: VaultFile[];
  folderOrder: string[];
  openFolders: Record<string, boolean>;
  currentNoteId: string;
  activeKind: TabKind;
  filtering: boolean;
  onNewNote: () => void;
  onOpenHome: () => void;
  onOpenGraph: () => void;
  onOpenNote: (id: string) => void;
  onToggleFolder: (name: string) => void;
  account?: { label: string } | null;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  onOpenConnect?: () => void;
  onOpenDump?: () => void;
  onOpenActivity?: () => void;
  vaults?: import("./vaultIcons").VaultSummary[];
  activeVaultId?: string;
  onSelectVault?: (id: string) => void;
  onCreateVault?: () => void;
}

function topFolder(path: string): string {
  return path.split("/")[0] || "Notes";
}

export function Sidebar(props: Props) {
  const {
    vaultName, files, pinned, recent, folderOrder, openFolders,
    currentNoteId, activeKind, filtering,
    onNewNote, onOpenHome, onOpenGraph, onOpenNote, onToggleFolder,
    account, theme, onToggleTheme, onOpenConnect, onOpenDump, onOpenActivity,
    vaults, activeVaultId, onSelectVault, onCreateVault,
  } = props;

  const isActiveNote = (id: string) => activeKind === "note" && currentNoteId === id;

  // The same note can appear in Pinned, Recent, and a Folder at once, so keys
  // are scoped per section to stay unique among siblings.
  const fileRow = (f: VaultFile, scope: string) => (
    <button
      key={`${scope}:${f.id}`}
      className={"nw-file-row" + (isActiveNote(f.id) ? " is-active" : "")}
      onClick={() => onOpenNote(f.id)}
    >
      <span className="nw-file-icn"><Icon name="file" size={14} stroke={1.6} /></span>
      <span className="nw-file-title">{f.title}</span>
    </button>
  );

  return (
    <aside className="nw-sidebar">
      <div className="nw-sidebar-top">
        {vaults && vaults.length > 0 && activeVaultId !== undefined && onSelectVault && onCreateVault ? (
          <VaultSwitcher
            vaults={vaults}
            activeVaultId={activeVaultId}
            onSelect={onSelectVault}
            onCreate={onCreateVault}
          />
        ) : (
          <div className="nw-vault">
            <div className="nw-vault-badge">{(vaultName[0] || "N").toUpperCase()}</div>
            <div className="nw-vault-text">
              <div className="nw-vault-name">{vaultName}</div>
            </div>
          </div>
        )}
        <button className="nw-newnote" onClick={onNewNote}>
          <Icon name="pen" size={14} stroke={1.8} />
          <span>New note</span>
        </button>
      </div>

      <div className="nw-sidebar-scroll">
        <NavButton icon="home" label="Home" active={activeKind === "home"} onClick={onOpenHome} />
        <NavButton icon="graph" label="Knowledge Web" active={activeKind === "graph"} onClick={onOpenGraph} />
        {onOpenActivity && (
          <NavButton icon="clock" label="AI Activity" active={false} onClick={onOpenActivity} />
        )}

        {pinned.length > 0 && (
          <Section icon="pin" label="Pinned">
            {pinned.map((f) => fileRow(f, "pin"))}
          </Section>
        )}

        <Section icon="clock" label="Recent">
          {recent.map((f) => fileRow(f, "rec"))}
        </Section>

        <Section label="Folders">
          {folderOrder.map((folder) => {
            const folderFiles = files.filter((f) => topFolder(f.path) === folder);
            if (folderFiles.length === 0 && filtering) return null;
            const open = openFolders[folder] ?? false;
            return (
              <div key={folder}>
                <button className="nw-folder" onClick={() => onToggleFolder(folder)}>
                  <span className={"nw-folder-chev" + (open ? " is-open" : "")}>
                    <Icon name="chevron" size={13} stroke={2} />
                  </span>
                  <span className="nw-folder-icn"><Icon name="folder" size={15} stroke={1.7} /></span>
                  <span className="nw-folder-name">{folder}</span>
                  <span className="nw-folder-count">{folderFiles.length}</span>
                </button>
                {open && (
                  <div className="nw-folder-files">
                    {folderFiles.map((f) => fileRow(f, `fld-${folder}`))}
                  </div>
                )}
              </div>
            );
          })}
        </Section>
      </div>

      {account !== undefined && (
        <AccountFooter account={account} theme={theme} onToggleTheme={onToggleTheme} onOpenConnect={onOpenConnect} onOpenDump={onOpenDump} />
      )}
    </aside>
  );
}

function NavButton({
  icon, label, active, onClick,
}: { icon: IconName; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={"nw-nav" + (active ? " is-active" : "")} onClick={onClick}>
      <Icon name={icon} size={16} stroke={1.7} />
      <span>{label}</span>
    </button>
  );
}

function Section({ icon, label, children }: { icon?: IconName; label: string; children: React.ReactNode }) {
  return (
    <div className="nw-section">
      <div className="nw-section-label">
        {icon && <Icon name={icon} size={12} stroke={1.8} />}
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

function AccountFooter({
  account, theme, onToggleTheme, onOpenConnect, onOpenDump,
}: {
  account: { label: string } | null;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  onOpenConnect?: () => void;
  onOpenDump?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!account) return null;
  const label = account.label;
  return (
    <div className="nw-account">
      <button className="nw-account-btn" onClick={() => setOpen((o) => !o)}>
        <div className="nw-account-avatar">{(label[0] || "N").toUpperCase()}</div>
        <span className="nw-account-email" title={label}>{label}</span>
        <Icon name="more" size={16} stroke={1.7} />
      </button>
      {open && (
        <>
          <div className="nw-menu-scrim" onClick={() => setOpen(false)} />
          <div className="nw-menu nw-account-menu" role="menu">
            {onToggleTheme && (
              <button
                className="nw-menu-item"
                onClick={() => {
                  setOpen(false);
                  onToggleTheme();
                }}
              >
                <Icon name={theme === "dark" ? "sun" : "moon"} size={14} stroke={1.7} />
                <span>{theme === "dark" ? "Light theme" : "Dark theme"}</span>
              </button>
            )}
            {onOpenConnect && (
              <button
                className="nw-menu-item"
                onClick={() => { setOpen(false); onOpenConnect(); }}
              >
                <Icon name="settings" size={14} stroke={1.7} />
                <span>Connect AI tools</span>
              </button>
            )}
            {onOpenDump && (
              <button
                className="nw-menu-item"
                onClick={() => { setOpen(false); onOpenDump(); }}
              >
                <Icon name="folder" size={14} stroke={1.7} />
                <span>Dump into Noto…</span>
              </button>
            )}
            <button className="nw-menu-item" disabled title="Settings are coming soon">
              <Icon name="settings" size={14} stroke={1.7} />
              <span>Settings</span>
              <span className="nw-menu-soon">Soon</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
