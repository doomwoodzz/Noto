import { Fragment } from "react";
import { Download } from "lucide-react";
import { useCountdown, pad } from "./useCountdown";
import { NotifyForm } from "./NotifyForm";
import { RELEASE_DATE, RELEASE_LABEL, VERSION_LABEL, DOWNLOAD_URL } from "../shared/release";

export function ComingSoon() {
  const t = useCountdown(RELEASE_DATE);
  const launched = t.done;
  const units = [
    { v: t.days, label: "Days" },
    { v: t.hours, label: "Hours" },
    { v: t.minutes, label: "Minutes" },
    { v: t.seconds, label: "Seconds" },
  ];
  // Empty cells flow around the explicitly-placed timer cell.
  const empties = Array.from({ length: 9 });

  return (
    <section className="cs-hero" id="download">
      <div className="l-shell">
        <div className="cs-hero-head">
          <div className="cs-eyebrow">
            <span className="cs-eyebrow-dot" />
            {VERSION_LABEL} — Public release
          </div>
          <h1 className="cs-title">
            {launched ? (
              <>The download is <em>open.</em></>
            ) : (
              <>The download opens <em>{RELEASE_LABEL}.</em></>
            )}
          </h1>
          <p className="cs-sub">
            {launched
              ? "Noto is out of beta and ready to install. Your vault stays on disk — no cloud lock-in, no database, no surprises."
              : "We're finishing the last few things — iCloud vault sync, a faster graph, and Lecture AI in twelve languages. The Mac app goes public the moment the clock hits zero."}
          </p>
        </div>

        <div className="cs-grid">
          {/* The one filled cell: countdown before launch, download/notify after */}
          <div className="cs-grid-cell cs-cell-timer">
            {launched ? (
              <>
                <div className="cs-timer-label">
                  <span className="cs-timer-label-bar" /> Now available for macOS
                </div>
                {DOWNLOAD_URL ? (
                  <a className="l-btn l-btn-primary l-btn-lg" href={DOWNLOAD_URL}>
                    <Download size={15} strokeWidth={1.7} />
                    Download for macOS
                  </a>
                ) : (
                  <p className="cs-launch-note">
                    Drop your email below and we'll send the download link straight to your inbox.
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="cs-timer-label">
                  <span className="cs-timer-label-bar" /> Counting down to release
                </div>
                <div className="cs-timer">
                  {units.map((u, i) => (
                    <Fragment key={u.label}>
                      <div className="cs-timer-unit">
                        <div className="cs-timer-num">{pad(u.v)}</div>
                        <div className="cs-timer-unit-cap">{u.label}</div>
                      </div>
                      {i < units.length - 1 && <div className="cs-timer-colon">:</div>}
                    </Fragment>
                  ))}
                </div>
              </>
            )}
          </div>
          {/* Empty cells — just the grid lines stretching out */}
          {empties.map((_, i) => (
            <div key={i} className="cs-grid-cell is-empty" />
          ))}
        </div>

        <div className="cs-grid-foot" id="notify">
          <div className="cs-grid-foot-meta">
            <span>Free during beta</span>
            <span className="l-hero-meta-dot" />
            <span>macOS 14+ · Apple silicon</span>
          </div>
          <NotifyForm />
        </div>
      </div>
    </section>
  );
}
