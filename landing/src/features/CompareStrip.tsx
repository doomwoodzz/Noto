import { X, Check, ArrowRight } from "lucide-react";

const SCATTERED = [
  "Notes in one app, tasks in another",
  "A recorder app you forget to start",
  "Transcripts pasted in by hand later",
  "Links that break when you rename a file",
  "Your thinking locked in someone's cloud",
  "No map of how any of it connects",
];

const NOTO = [
  "Notes, tasks, and links in one Markdown file",
  "Lecture AI one keystroke away",
  "Structured notes drafted as you listen",
  "Wiki links that resolve by title, not path",
  "Plain files on a disk you own",
  "A Knowledge Web generated automatically",
];

export function CompareStrip() {
  return (
    <section className="l-section" id="why">
      <div className="l-shell">
        <div className="l-section-head">
          <div className="l-section-label">
            <span className="l-section-label-bar" /> Why Noto
          </div>
          <h2 className="l-section-title">One workspace beats five tabs.</h2>
          <p className="l-section-sub">
            Most note-taking is spread across a writing app, a recorder, a task list, and
            a folder of orphaned transcripts. Noto folds all of it into one local vault.
          </p>
        </div>

        <div className="f-compare">
          <div className="f-compare-col f-compare-bad">
            <div className="f-compare-head">The scattered way</div>
            <ul>
              {SCATTERED.map((s) => (
                <li key={s}>
                  <span className="f-compare-x"><X size={13} strokeWidth={2.2} /></span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <div className="f-compare-col f-compare-good">
            <div className="f-compare-head">The Noto way</div>
            <ul>
              {NOTO.map((s) => (
                <li key={s}>
                  <span className="f-compare-check"><Check size={13} strokeWidth={2.2} /></span>
                  {s}
                </li>
              ))}
            </ul>
            <a href="#download" className="l-btn l-btn-primary f-compare-cta">
              Switch to one workspace
              <ArrowRight size={14} strokeWidth={1.7} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
