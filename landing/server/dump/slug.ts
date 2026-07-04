// Filesystem-safe slugs for Dump folder + note paths. Mirrors pathSchema rules
// (no leading '/', no '\', no control chars, no '.'/'..' segments).
// eslint-disable-next-line no-control-regex -- intentionally strips control chars
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;

export function slugifySource(name: string): string {
  const s = name.replace(/\//g, "-").replace(ILLEGAL, " ").replace(/\s+/g, " ").trim();
  return (s || "Source").slice(0, 60).trim();
}

export function slugifyTitle(title: string): string {
  const s = title.replace(ILLEGAL, " ").replace(/\s+/g, " ").trim();
  return (s || "Untitled").slice(0, 120).trim();
}
