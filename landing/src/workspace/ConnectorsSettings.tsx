import { useEffect, useState } from "react";
import "../styles/dump.css";
import type { DumpClient } from "./dumpClient";
import type { ConnectorInfo } from "./dumpTypes";

const PROVIDERS: { id: string; label: string; installPath: string; blurb: string }[] = [
  { id: "github", label: "GitHub", installPath: "/api/auth/github/install", blurb: "Pull docs and issues from a repository (read-only)." },
  { id: "notion", label: "Notion", installPath: "/api/auth/notion/install", blurb: "Import the pages and databases you select." },
];

export function ConnectorsSettings({ client, onClose }: { client: DumpClient; onClose: () => void }) {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => client.connectors().then(setConnectors).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [client]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const linked = (id: string) => connectors.find((c) => c.provider === id) ?? null;

  const disconnect = async (id: string) => {
    setBusy(id); setErr(null);
    try { await client.disconnect(id); refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not disconnect."); }
    finally { setBusy(null); }
  };

  return (
    <>
      <div className="nw-menu-scrim" onClick={onClose} />
      <div className="nw-dump-panel" role="dialog" aria-modal="true" aria-labelledby="connectors-dialog-title">
        <header className="nw-dump-head">
          <h2 id="connectors-dialog-title">Connectors</h2>
          <button className="nw-dump-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="nw-dump-body">
          <div className="nw-dump-manifest">
            {PROVIDERS.map((p) => {
              const conn = linked(p.id);
              return (
                <div key={p.id} className="nw-dump-row">
                  <div className="nw-dump-row-main">
                    <div className="nw-dump-row-title">{p.label}</div>
                    <div className="nw-dump-row-summary">
                      {conn ? `Connected${conn.externalAccount ? ` as ${conn.externalAccount}` : ""}` : p.blurb}
                    </div>
                  </div>
                  {conn ? (
                    <button className="nw-dump-btn nw-dump-btn-ghost" disabled={busy === p.id} onClick={() => disconnect(p.id)}>
                      {busy === p.id ? "…" : "Disconnect"}
                    </button>
                  ) : (
                    <button className="nw-dump-btn" onClick={() => { window.location.href = p.installPath; }}>
                      Connect
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {err && <p className="nw-dump-err">{err}</p>}
        </div>
      </div>
    </>
  );
}
