/**
 * Resolve a vault's AI key + model for a request, ownership-checked. Returns an
 * empty object when there's no owned vault, no per-vault config, or the key can't
 * be decrypted — callers then fall back to the global OPENAI_API_KEY.
 */
import { getOwnedVault, getVaultAIRow } from "../db.ts";
import { decryptKey } from "./keyvault.ts";

export interface ResolvedVaultAI {
  apiKey?: string;
  model?: string;
}

export function resolveVaultAI(userId: string | null, vaultId: string | null | undefined): ResolvedVaultAI {
  if (!userId || !vaultId) return {};
  if (!getOwnedVault(userId, vaultId)) return {};
  const row = getVaultAIRow(vaultId);
  if (!row) return {};
  const out: ResolvedVaultAI = {};
  if (row.api_key_cipher) {
    try {
      out.apiKey = decryptKey(row.api_key_cipher);
      if (row.model) out.model = row.model; // model applies only with a working vault key
    } catch (e) {
      // Corrupt/rotated cipher → fall back fully to the global key + default model.
      console.warn("vaultAI: failed to decrypt key for vault %s — using global fallback", vaultId, e);
    }
  }
  return out;
}
