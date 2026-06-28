import type { VaultFile } from "../noto-core";
import { Icon } from "./icons";

interface Props {
  recents: VaultFile[];
  onNewNote: () => void;
  onRecordLecture: () => void;
  onOpenGraph: () => void;
  onOpenNote: (id: string) => void;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function HomeView({ recents, onNewNote, onRecordLecture, onOpenGraph, onOpenNote }: Props) {
  return (
    <div className="nw-home">
      <div className="nw-home-inner">
        <div className="nw-home-eyebrow">{greeting()}</div>
        <h1 className="nw-home-title">Welcome back to your Second Brain</h1>

        <div className="nw-home-actions">
          <button className="nw-home-action" onClick={onNewNote}>
            <span className="nw-home-action-icn"><Icon name="pen" size={20} stroke={1.7} /></span>
            <span className="nw-home-action-label">New note</span>
          </button>
          <button className="nw-home-action is-accent" onClick={onRecordLecture}>
            <span className="nw-home-action-icn"><Icon name="mic" size={20} stroke={1.7} /></span>
            <span className="nw-home-action-label">Record a lecture</span>
          </button>
          <button className="nw-home-action" onClick={onOpenGraph}>
            <span className="nw-home-action-icn"><Icon name="graph" size={20} stroke={1.7} /></span>
            <span className="nw-home-action-label">Open Knowledge Web</span>
          </button>
        </div>

        <div className="nw-home-label">Jump back in</div>
        <div className="nw-home-grid">
          {recents.map((f) => (
            <button key={f.id} className="nw-home-card" onClick={() => onOpenNote(f.id)}>
              <div className="nw-home-card-folder">
                <Icon name="file" size={13} stroke={1.7} />
                <span>{f.path.split("/")[0]}</span>
              </div>
              <div className="nw-home-card-title">{f.title}</div>
              <div className="nw-home-card-edited">Edited {formatDate(f.updatedAt)}</div>
            </button>
          ))}
          {recents.length === 0 && <div className="nw-empty">No notes yet — create one to get started.</div>}
        </div>
      </div>
    </div>
  );
}
