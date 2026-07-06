// landing/server/graph/query.ts
import { getVaultEdges, getNoteGraphState } from "../db.ts";
import { budgetedQuery, type GraphQueryResult } from "../../src/noto-core/graphEdges.ts";

export interface VaultGraphQueryResult extends GraphQueryResult {
  community: number | null;
}

/** The compact neighborhood around one note: EXTRACTED edges before INFERRED, capped at `budget`. Internal-only for now. */
export function queryVaultGraph(vaultId: string, fileId: string, budget = 20): VaultGraphQueryResult {
  const edges = getVaultEdges(vaultId);
  const result = budgetedQuery(edges, fileId, budget);
  return { ...result, community: getNoteGraphState(fileId)?.community ?? null };
}
