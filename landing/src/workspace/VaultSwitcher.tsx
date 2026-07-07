import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { VaultBadge } from "./VaultBadge";
import type { VaultSummary } from "./vaultIcons";

interface Props {
  vaults: VaultSummary[];
  activeVaultId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function VaultSwitcher({ vaults, activeVaultId, onSelect, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const active = vaults.find((v) => v.id === activeVaultId) ?? vaults[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!active) return null;

  return (
    <div className="nw-vswitch">
      <button className="nw-vswitch-trigger" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <VaultBadge icon={active.icon} color={active.color} name={active.name} />
        <span className="nw-vault-text">
          <span className="nw-vault-name">{active.name}</span>
        </span>
        <Icon name="chevron" size={15} stroke={2} />
      </button>

      {open && (
        <>
          <div className="nw-menu-scrim" onClick={() => setOpen(false)} />
          <div className="nw-menu nw-vault-menu" role="menu">
            <div className="nw-menu-label">Vaults</div>
            {vaults.map((v) => (
              <button
                key={v.id}
                className={"nw-menu-item nw-vault-item" + (v.id === active.id ? " is-active" : "")}
                onClick={() => { setOpen(false); if (v.id !== active.id) onSelect(v.id); }}
                role="menuitem"
              >
                <VaultBadge icon={v.icon} color={v.color} name={v.name} size={24} />
                <span className="nw-vault-item-name">{v.name}</span>
                {v.id === active.id && <span className="nw-vault-check" aria-hidden="true">✓</span>}
              </button>
            ))}
            <div className="nw-menu-sep" />
            <button className="nw-menu-item nw-vault-new" onClick={() => { setOpen(false); onCreate(); }} role="menuitem">
              <Icon name="plus" size={16} stroke={1.8} />
              <span>New vault</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
