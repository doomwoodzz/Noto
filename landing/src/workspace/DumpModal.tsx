import { useCallback, useEffect, useRef, useState } from "react";
import "../styles/dump.css";
import { Icon } from "./icons";
import type { DumpClient } from "./dumpClient";
import type {
  PublicDumpJob,
  DumpSource,
  GithubRepoOption,
  NotionPageOption,
  ConnectorInfo,
} from "./dumpTypes";
import { manifestToRows, countsLabel, phaseLabel, type ManifestRow } from "./dumpView";

type Tab = "paste" | "upload" | "github" | "notion";
const TABS: { id: Tab; label: string }[] = [
  { id: "paste", label: "Paste" },
  { id: "upload", label: "Upload" },
  { id: "github", label: "GitHub" },
  { id: "notion", label: "Notion" },
];

interface UploadedFile { name: string; content: string }

export function DumpModal({
  client,
  onClose,
  toast,
}: {
  client: DumpClient;
  onClose: () => void;
  toast: (text: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("paste");

  // source inputs
  const [text, setText] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [repos, setRepos] = useState<GithubRepoOption[]>([]);
  const [pages, setPages] = useState<NotionPageOption[]>([]);
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>("");
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());

  // job + manifest state
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<PublicDumpJob | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // Escape closes; the job keeps running server-side (durable).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Load connectors + lists once.
  useEffect(() => {
    client.connectors().then(setConnectors).catch(() => {});
  }, [client]);

  const isLinked = (provider: string) => connectors.some((c) => c.provider === provider);

  useEffect(() => {
    if (tab === "github" && isLinked("github")) client.githubRepos().then(setRepos).catch(() => {});
    if (tab === "notion" && isLinked("notion")) client.notionPages().then(setPages).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, connectors]);

  /* ------------------------------ polling ------------------------------- */
  const beginPolling = useCallback(
    (id: string) => {
      stopPolling();
      pollRef.current = setInterval(() => {
        client
          .poll(id)
          .then((j) => {
            setJob(j);
            if (j.status === "awaiting_review" && j.manifest) {
              const manifest = j.manifest;
              setSelected((prev) =>
                prev.size > 0
                  ? prev
                  : new Set(manifestToRows(manifest).filter((r) => r.defaultSelected).map((r) => r.itemId)),
              );
            }
            if (j.status === "done") {
              stopPolling();
              toast("Dump complete — notes created.");
              onClose();
            }
            if (j.status === "failed" || j.status === "cancelled") {
              stopPolling();
              setErr(j.error ?? "Dump did not finish.");
            }
          })
          .catch((e) => {
            stopPolling();
            setErr(e instanceof Error ? e.message : "Lost contact with the dump.");
          });
      }, 1000);
    },
    [client, onClose, stopPolling, toast],
  );

  /* ------------------------------- start -------------------------------- */
  function buildSource(): DumpSource | null {
    if (tab === "paste") return text.trim() ? { type: "raw", text } : null;
    if (tab === "upload") return files.length ? { type: "raw", files } : null;
    if (tab === "github") return selectedRepo ? { type: "github", repo: selectedRepo } : null;
    if (tab === "notion") return selectedPages.size ? { type: "notion", pageIds: [...selectedPages] } : null;
    return null;
  }

  const start = async () => {
    const source = buildSource();
    if (!source) return;
    setBusy(true); setErr(null);
    try {
      const { jobId: id } = await client.start(source);
      setJobId(id);
      setJob({ id, sourceType: source.type, status: "queued", counts: {}, error: null });
      beginPolling(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start the dump.");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!jobId) return;
    setBusy(true); setErr(null);
    try {
      await client.commit(jobId, [...selected]);
      setJob((j) => (j ? { ...j, status: "committing", manifest: undefined } : j));
      beginPolling(jobId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the notes.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (jobId) { try { await client.cancel(jobId); } catch { /* ignore */ } }
    stopPolling();
    onClose();
  };

  /* ----------------------------- file input ----------------------------- */
  const onPickFiles = (list: FileList | null) => {
    if (!list) return;
    const reads = Array.from(list).map(
      (f) =>
        new Promise<UploadedFile>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: f.name, content: String(reader.result ?? "") });
          reader.onerror = () => resolve({ name: f.name, content: "" });
          reader.readAsText(f);
        }),
    );
    Promise.all(reads).then((next) => setFiles((prev) => [...prev, ...next]));
  };

  const togglePage = (id: string) =>
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  /* ------------------------------- render ------------------------------- */
  const running = job !== null && job.status !== "awaiting_review";
  const reviewing = job?.status === "awaiting_review" && job.manifest;
  const rows: ManifestRow[] = reviewing ? manifestToRows(job!.manifest!) : [];

  return (
    <>
      <div className="nw-menu-scrim" onClick={onClose} />
      <div className="nw-dump-panel" role="dialog" aria-modal="true" aria-labelledby="dump-dialog-title">
        <header className="nw-dump-head">
          <h2 id="dump-dialog-title">Dump into Noto</h2>
          <button className="nw-dump-x" onClick={onClose} aria-label="Close">×</button>
        </header>

        {!job && (
          <div className="nw-dump-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={"nw-dump-tab" + (tab === t.id ? " is-active" : "")}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="nw-dump-body">
          {/* ----- input stage ----- */}
          {!job && tab === "paste" && (
            <textarea
              className="nw-dump-textarea"
              placeholder="Paste text or markdown to turn into atomic notes…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}

          {!job && tab === "upload" && (
            <div>
              <label className="nw-dump-drop">
                <Icon name="folder" size={20} stroke={1.6} />
                <div>Choose .md / .txt / .markdown files</div>
                <input
                  type="file"
                  multiple
                  accept=".md,.txt,.markdown,text/plain,text/markdown"
                  style={{ display: "none" }}
                  onChange={(e) => onPickFiles(e.target.files)}
                />
              </label>
              {files.length > 0 && (
                <ul className="nw-dump-filelist">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`}>{f.name} · {f.content.length} chars</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!job && tab === "github" && (
            isLinked("github") ? (
              <select
                className="nw-dump-textarea"
                style={{ minHeight: "auto", height: 40 }}
                value={selectedRepo}
                onChange={(e) => setSelectedRepo(e.target.value)}
              >
                <option value="">Choose a repository…</option>
                {repos.map((r) => (
                  <option key={r.fullName} value={r.fullName}>{r.fullName}</option>
                ))}
              </select>
            ) : (
              <div className="nw-dump-drop">
                <p>Connect GitHub to pull docs and issues from a repository.</p>
                <button className="nw-dump-btn" onClick={() => { window.location.href = "/api/auth/github/install"; }}>
                  Connect GitHub
                </button>
              </div>
            )
          )}

          {!job && tab === "notion" && (
            isLinked("notion") ? (
              <ul className="nw-dump-filelist">
                {pages.map((p) => (
                  <li key={p.id}>
                    <label>
                      <input type="checkbox" checked={selectedPages.has(p.id)} onChange={() => togglePage(p.id)} />{" "}
                      {p.title} <span className="nw-dump-tag">{p.type}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="nw-dump-drop">
                <p>Connect Notion to import the pages and databases you select.</p>
                <button className="nw-dump-btn" onClick={() => { window.location.href = "/api/auth/notion/install"; }}>
                  Connect Notion
                </button>
              </div>
            )
          )}

          {/* ----- progress stage ----- */}
          {running && job && (
            <div className="nw-dump-progress">
              <span className="nw-dump-phase">{phaseLabel(job.status)}</span>
              <span className="nw-dump-counts">{countsLabel(job.counts)}</span>
            </div>
          )}

          {/* ----- review stage ----- */}
          {reviewing && (
            <div className="nw-dump-manifest">
              {rows.map((r) => (
                <div key={r.itemId} className={"nw-dump-row" + (r.disabled ? " is-disabled" : "")}>
                  <input
                    type="checkbox"
                    checked={selected.has(r.itemId)}
                    disabled={r.disabled}
                    onChange={() => toggleRow(r.itemId)}
                  />
                  <div className="nw-dump-row-main">
                    <div className="nw-dump-row-title">{r.title}</div>
                    {r.summary && <div className="nw-dump-row-summary">{r.summary}</div>}
                    <div className="nw-dump-row-meta">
                      {r.badge && <span className="nw-dump-badge">{r.badge}</span>}
                      {r.redacted && <span className="nw-dump-badge nw-dump-badge-warn">{r.redactionCount} redacted</span>}
                      {r.linkCount > 0 && <span>{r.linkCount} links</span>}
                      {r.tags.map((t) => <span key={t} className="nw-dump-tag">{t}</span>)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {err && <p className="nw-dump-err">{err}</p>}
        </div>

        <div className="nw-dump-foot">
          {reviewing ? (
            <>
              <button className="nw-dump-btn nw-dump-btn-ghost" onClick={cancel}>Cancel</button>
              <button className="nw-dump-btn" onClick={commit} disabled={busy || selected.size === 0}>
                Create {selected.size} {selected.size === 1 ? "note" : "notes"}
              </button>
            </>
          ) : running ? (
            <button className="nw-dump-btn nw-dump-btn-ghost" onClick={cancel}>Stop</button>
          ) : (
            <>
              <button className="nw-dump-btn nw-dump-btn-ghost" onClick={onClose}>Close</button>
              <button className="nw-dump-btn" onClick={start} disabled={busy || !buildSource()}>
                Start dump
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
