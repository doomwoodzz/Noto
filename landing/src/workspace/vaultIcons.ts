export interface VaultSummary {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

/** Choose the vault to open on load: the persisted one if present, else the first. */
export function pickInitialVault<T extends { id: string }>(vaults: T[], persistedId: string | null): T | null {
  if (vaults.length === 0) return null;
  if (persistedId) {
    const hit = vaults.find((v) => v.id === persistedId);
    if (hit) return hit;
  }
  return vaults[0];
}

export const VAULT_EMOJI = ["📚", "🧪", "💼", "🎓", "🧠", "🔬", "📐", "☕", "📓", "🗂️", "🎨", "💡"] as const;

/** Color tokens stored on the vault; each maps to a swatch + a soft tile tint. */
export const VAULT_COLORS = [
  { token: "blue", swatch: "#578FFA", tint: "rgba(87,143,250,0.18)" },
  { token: "amber", swatch: "#EF9F27", tint: "rgba(239,159,39,0.18)" },
  { token: "teal", swatch: "#1D9E75", tint: "rgba(29,158,117,0.20)" },
  { token: "purple", swatch: "#7F77DD", tint: "rgba(127,119,221,0.22)" },
  { token: "coral", swatch: "#D85A30", tint: "rgba(216,90,48,0.20)" },
  { token: "pink", swatch: "#D4537E", tint: "rgba(212,83,126,0.20)" },
  { token: "gray", swatch: "#888780", tint: "rgba(136,135,128,0.22)" },
] as const;

export function tintFor(color: string | null | undefined): string {
  const hit = VAULT_COLORS.find((c) => c.token === color);
  return (hit ?? VAULT_COLORS[0]).tint;
}
export function swatchFor(color: string | null | undefined): string {
  const hit = VAULT_COLORS.find((c) => c.token === color);
  return (hit ?? VAULT_COLORS[0]).swatch;
}
