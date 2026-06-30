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
  if (row.model) out.model = row.model;
  if (row.api_key_cipher) {
    try {
      out.apiKey = decryptKey(row.api_key_cipher);
    } catch {
      /* corrupt/old cipher → fall back to global */
    }
  }
  return out;
}
