import { useEffect, useState, useCallback } from "react";
import type { ActivityClient, ActivityEntry } from "./activityClient";
import { describeActivity } from "./activityFormat";

const TOOL_FILTERS = [
  { value: "", label: "All actions" },
  { value: "create_note", label: "Created" },
  { value: "append_note", label: "Appended" },
  { value: "update_section", label: "Edited" },
  { value: "remember", label: "Remembered" },
  { value: "supersede", label: "Corrected" },
];
const CLIENT_FILTERS = [
  { value: "", label: "All tools" },
  { value: "claude-code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "codex", label: "Codex" },
];

function when(ts: number): string {
  const s = Math.max(0, Date.now() - ts) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface Props {
  client: ActivityClient;
  initialFileId?: string;
  onClose: () => void;
  onOpenNote?: (fileId: string) => void;
}

export function ActivityView({ client, initialFileId, onClose, onOpenNote }: Props) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [tool, setTool] = useState("");
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ entry: ActivityEntry; before: string | null; current: string | null; conflict: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    let cancelled = false;
    client
      .list({ tool: tool || undefined, source: source || undefined, fileId: initialFileId })
      .then((rows) => { if (!cancelled) { setEntries(rows); setErr(null); } })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load activity."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, tool, source, initialFileId]);

  // load() sets loading state and returns a cleanup that cancels the in-flight
  // request; running it on mount / when its inputs change is the intended effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => load(), [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirm) setConfirm(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirm]);

  const openConfirm = async (entry: ActivityEntry) => {
    setErr(null);
    try {
      const { before, current } = await client.preview(entry.id);
      setConfirm({ entry, before, current, conflict: false });
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load preview."); }
  };

  const doRevert = async (force: boolean) => {
    if (!confirm) return;
    setBusy(true); setErr(null);
    try {
      const r = await client.revert(confirm.entry.id, force);
      if (r.status === "conflict") { setConfirm({ ...confirm, before: r.before ?? confirm.before, current: r.current ?? confirm.current, conflict: true }); return; }
      if (r.status === "not_revertible") { setConfirm(null); setErr(r.reason ?? "This can no longer be reverted."); load(); return; }
      setConfirm(null);
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Revert failed."); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="nw-menu-scrim" onClick={onClose} />
      <div className="nw-act-panel" role="dialog" aria-modal="true" aria-labelledby="act-title">
        <header className="nw-act-head">
          <h2 id="act-title">AI Activity</h2>
          <button className="nw-mcp-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <p className="nw-act-sub">Everything your AI tools wrote{initialFileId ? " to this note" : ""}. Revert anything.</p>

        <div className="nw-act-filters">
          <select value={tool} onChange={(e) => setTool(e.target.value)} aria-label="Filter by action">
            {TOOL_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filter by tool">
            {CLIENT_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>

        {err && <p className="nw-mcp-err">{err}</p>}
        {loading && <p className="nw-mcp-empty">Loading…</p>}
        {!loading && entries.length === 0 && <p className="nw-mcp-empty">No AI writes yet.</p>}

        <ul className="nw-act-list">
          {entries.map((e) => (
            <li key={e.id} className="nw-act-row">
              <div className="nw-act-main">
                <span className="nw-act-desc">{describeActivity(e)}</span>
                <span className="nw-act-meta">
                  {e.device ? `${e.device} · ` : ""}{when(e.createdAt)}
                </span>
              </div>
              <div className="nw-act-actions">
                {e.target.kind === "note" && e.target.exists && e.target.id && onOpenNote && (
                  <button className="nw-act-link" onClick={() => { onOpenNote(e.target.id as string); onClose(); }}>Open</button>
                )}
                {e.revertible ? (
                  <button className="nw-act-revert" onClick={() => openConfirm(e)} disabled={busy}>Revert</button>
                ) : e.tool === "revert" ? (
                  <span className="nw-act-badge">undo</span>
                ) : (
                  <span className="nw-act-badge" title="No snapshot — this edit predates the trust layer, or it was already reverted.">view only</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {confirm && (
        <>
          <div className="nw-act-confirm-scrim" onClick={() => setConfirm(null)} />
          <div className="nw-act-confirm" role="dialog" aria-modal="true" aria-labelledby="act-confirm-title">
            <h3 id="act-confirm-title">{confirm.conflict ? "This changed since the AI wrote it" : "Revert this change?"}</h3>
            <p className="nw-act-desc">{describeActivity(confirm.entry)}</p>
            {confirm.conflict && <p className="nw-mcp-err">Reverting will discard edits made after the AI write.</p>}
            <div className="nw-act-diff">
              <div><div className="nw-act-difflabel">Before</div><pre>{confirm.before ?? "(did not exist)"}</pre></div>
              <div><div className="nw-act-difflabel">Current</div><pre>{confirm.current ?? "(deleted)"}</pre></div>
            </div>
            <div className="nw-act-confirm-actions">
              <button onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
              <button className="nw-act-revert" onClick={() => doRevert(confirm.conflict)} disabled={busy}>
                {confirm.conflict ? "Revert anyway" : "Revert"}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
