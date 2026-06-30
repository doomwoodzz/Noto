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
