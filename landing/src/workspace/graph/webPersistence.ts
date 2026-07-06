// Per-vault persistence of Knowledge Web settings (sliders + groups) in
// localStorage. Tolerant of missing/corrupt data — never throws.

import { DEFAULT_SLIDERS, type WebGroup, type WebSettings, type WebSliders } from "./webTypes";

const PREFIX = "noto:web:v1:";

export function loadWebSettings(vaultKey: string): WebSettings | null {
  try {
    const raw = localStorage.getItem(PREFIX + vaultKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const groups = sanitizeGroups((parsed as Record<string, unknown>)?.groups);
    if (!groups) return null;
    return { sliders: sanitizeSliders((parsed as Record<string, unknown>)?.sliders), groups };
  } catch {
    return null;
  }
}

export function saveWebSettings(vaultKey: string, settings: WebSettings): void {
  try {
    localStorage.setItem(PREFIX + vaultKey, JSON.stringify(settings));
  } catch {
    /* storage full or unavailable — non-fatal */
  }
}

function sanitizeSliders(s: unknown): WebSliders {
  const src = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) =>
    typeof v === "number" && v >= 0 && v <= 1 ? v : d;
  return {
    node: num(src.node, DEFAULT_SLIDERS.node),
    link: num(src.link, DEFAULT_SLIDERS.link),
    text: num(src.text, DEFAULT_SLIDERS.text),
    center: num(src.center, DEFAULT_SLIDERS.center),
    repel: num(src.repel, DEFAULT_SLIDERS.repel),
    spring: num(src.spring, DEFAULT_SLIDERS.spring),
  };
}

/** Returns a cleaned group list, or null if `g` is not an array at all. */
function sanitizeGroups(g: unknown): WebGroup[] | null {
  if (!Array.isArray(g)) return null;
  const out: WebGroup[] = [];
  for (const item of g) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.query !== "string" || typeof rec.color !== "string") continue;
    out.push({ query: rec.query, color: rec.color, visible: rec.visible !== false });
  }
  return out;
}
