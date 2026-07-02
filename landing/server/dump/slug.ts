// Filesystem-safe slugs for Dump folder + note paths. Mirrors pathSchema rules
// (no leading '/', no '\', no control chars, no '.'/'..' segments).
// NOTE: '-' and ' ' are intentionally NOT in ILLEGAL — source slugs keep the
// dash from the '/'→'-' rewrite (e.g. "octocat/Hello-World" → "octocat-Hello-World").
const ILLEGAL = /[\\/:*?"<>|]/g;

export function slugifySource(name: string): string {
  const s = name.replace(/\//g, "-").replace(ILLEGAL, " ").replace(/\s+/g, " ").trim();
  return (s || "Source").slice(0, 60).trim();
}

export function slugifyTitle(title: string): string {
  const s = title.replace(ILLEGAL, " ").replace(/\s+/g, " ").trim();
  return (s || "Untitled").slice(0, 120).trim();
}
