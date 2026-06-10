import { Fragment } from "react";
import { useCountdown, pad } from "./useCountdown";
import { NotifyForm } from "./NotifyForm";

// June 20, 2026, local time.
const RELEASE = new Date(2026, 5, 20, 0, 0, 0);

export function ComingSoon() {
  const t = useCountdown(RELEASE);
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
            Noto 2.0 — Public release
          </div>
          <h1 className="cs-title">
            The download opens <em>June 20.</em>
          </h1>
          <p className="cs-sub">
            We're finishing the last few things — iCloud vault sync, a faster graph,
            and Lecture AI in twelve languages. The Mac app goes public the moment the clock hits zero.
          </p>
        </div>

        <div className="cs-grid">
          {/* The one filled cell: the countdown */}
          <div className="cs-grid-cell cs-cell-timer">
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
