// Single source of truth for the public release date + version string.
//
// These were previously hardcoded and had drifted out of sync across surfaces
// (the landing/features said "Noto 1.4", the download page said "Noto 2.0", and
// the countdown targeted a date that had already passed — leaving a dead
// 00:00:00 timer). Set the real values here and every surface stays consistent.

/** Public release target. When it has passed, the download page shows the
 *  "launched" state instead of a countdown. */
export const RELEASE_DATE = new Date(2026, 5, 20, 0, 0, 0); // June 20, 2026, local time

/** Current product version shown in eyebrows/badges across all pages. */
export const VERSION = "1.4";

/** Convenience label, e.g. "Noto 1.4". */
export const VERSION_LABEL = `Noto ${VERSION}`;

/** Human-readable release date, e.g. "June 20". */
export const RELEASE_LABEL = RELEASE_DATE.toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
});

/** Real macOS build URL once the app ships. Empty string = not yet downloadable,
 *  so the launched state keeps the email-the-link form instead of a dead button. */
export const DOWNLOAD_URL = "";
