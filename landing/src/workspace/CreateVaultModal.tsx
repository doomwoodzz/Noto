import { useState } from "react";
import { VaultBadge } from "./VaultBadge";
import { VAULT_EMOJI, VAULT_COLORS, type VaultSummary } from "./vaultIcons";

interface Props {
  onClose: () => void;
  onCreate: (input: { name: string; icon: string; color: string }) => Promise<VaultSummary | null>;
}

export function CreateVaultModal({ onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string>(VAULT_EMOJI[0]);
  const [color, setColor] = useState<string>(VAULT_COLORS[0].token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const created = await onCreate({ name: name.trim(), icon, color });
    setBusy(false);
    if (created) onClose();
    else setError("Could not create the vault. Please try again.");
  }

  return (
    <>
      <div className="nw-menu-scrim" onClick={onClose} />
      <div className="nw-modal nw-createvault" role="dialog" aria-modal="true" aria-labelledby="cv-title">
        <header className="nw-modal-head">
          <h2 id="cv-title">Create a new vault</h2>
          <button className="nw-mcp-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <p className="nw-modal-sub">Name it and give it an icon.</p>

        <div className="nw-cv-namerow">
          <VaultBadge icon={icon} color={color} name={name || "?"} size={48} />
          <label className="nw-cv-field">
            <span className="nw-cv-label">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder="e.g. Thesis"
              maxLength={60}
            />
          </label>
        </div>

        <div className="nw-cv-label">Choose an icon</div>
        <div className="nw-cv-emoji">
          {VAULT_EMOJI.map((e) => (
            <button
              key={e}
              className={"nw-cv-emoji-btn" + (e === icon ? " is-sel" : "")}
              onClick={() => setIcon(e)}
              aria-label={`Icon ${e}`}
              aria-pressed={e === icon}
            >
              {e}
            </button>
          ))}
        </div>

        <div className="nw-cv-colors">
          {VAULT_COLORS.map((c) => (
            <button
              key={c.token}
              className={"nw-cv-color" + (c.token === color ? " is-sel" : "")}
              style={{ background: c.swatch }}
              onClick={() => setColor(c.token)}
              aria-label={`Color ${c.token}`}
              aria-pressed={c.token === color}
            />
          ))}
        </div>

        {error && <p className="nw-cv-error">{error}</p>}

        <footer className="nw-modal-foot">
          <button className="nw-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="nw-btn-primary" onClick={() => void submit()} disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create vault"}
          </button>
        </footer>
      </div>
    </>
  );
}
