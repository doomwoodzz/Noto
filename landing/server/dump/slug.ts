// Filesystem-safe slugs for Dump folder + note paths. Mirrors pathSchema rules
// (no leading '/', no '\', no control chars, no '.'/'..' segments).
// NOTE: '-' and ' ' are intentionally NOT in ILLEGAL — source slugs keep the
// dash from the '/'→'-' rewrite (e.g. "octocat/Hello-World" → "octocat-Hello-World").
// The `\x00-\x1f\x7f` range covers C0 controls (incl. NUL and — as whitespace —
// tab/newline/CR): untrusted dumped titles reach createFile directly, bypassing
// the HTTP pathSchema, so control chars must be scrubbed here or a NUL byte lands
// in a stored note path. All matches collapse to a single space via `\s+`.
// eslint-disable-next-line no-control-regex -- matching C0 controls is the intent here
const ILLEGAL = /[\\/:*?"<>|\x00-\x1f\x7f]/g;

export function slugifySource(name: string): string {
  const s = name.normalize("NFC").replace(/\//g, "-").replace(ILLEGAL, " ").replace(/\s+/g, " ").trim();
  return (s || "Source").slice(0, 60).trim();
}

export function slugifyTitle(title: string): string {
  // NFC so a combining vs. precomposed title (e.g. "Café") yields one canonical path
  // instead of two byte-distinct files that look identical.
  const s = title.normalize("NFC").replace(ILLEGAL, " ").replace(/\s+/g, " ").trim();
  return (s || "Untitled").slice(0, 120).trim();
}
