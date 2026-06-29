export interface ActivityTarget {
  kind: "note" | "memory";
  id: string | null;
  title: string | null;
  path: string | null;
  text: string | null;
  status: string | null;
  exists: boolean;
}
export interface ActivityEntry {
  id: string;
  tool: string;
  createdAt: number;
  client: string | null;
  device: string | null;
  target: ActivityTarget;
  revertible: boolean;
  hasSnapshot: boolean;
}
export interface ActivityFilter {
  tool?: string;
  source?: string;
  fileId?: string;
  before?: number;
  limit?: number;
}
export interface RevertOutcome {
  status: string;
  before?: string | null;
  current?: string | null;
  reason?: string;
}

/** Surface-agnostic contract the Activity view needs; real impl wraps `api`. */
export interface ActivityClient {
  list(filter?: ActivityFilter): Promise<ActivityEntry[]>;
  preview(auditId: string): Promise<{ before: string | null; current: string | null }>;
  revert(auditId: string, force?: boolean): Promise<RevertOutcome>;
}
