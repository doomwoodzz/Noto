// Client-side mirror of the server Dump wire types (server/dump/types.ts).
// Kept parallel so the client never imports server code at runtime.

export type DumpStatus =
  | "queued" | "fetching" | "shaping" | "awaiting_review" | "committing" | "done" | "failed" | "cancelled";

export interface DumpCounts {
  fetched?: number;
  shaped?: number;
  redacted?: number;
  duplicates?: number;
  updates?: number;
  committed?: number;
  failed?: number;
  overCap?: number;
  totalAvailable?: number;
}

export interface ManifestItem {
  itemId: string;
  title: string;
  summary: string;
  tags: string[];
  linkCount: number;
  notePath: string;
  redactionCount: number;
  status: "new" | "update" | "duplicate" | "skipped";
  dedupOf?: string;
}

export interface PublicDumpJob {
  id: string;
  sourceType: "raw" | "github" | "notion";
  status: DumpStatus;
  counts: DumpCounts;
  error: string | null;
  manifest?: ManifestItem[];
}

/** A source selector the client sends to POST /api/dump. */
export type DumpSource =
  | { type: "raw"; text?: string; files?: { name: string; content: string }[] }
  | { type: "github"; repo: string; includeIssues?: boolean; glob?: string }
  | { type: "notion"; pageIds: string[] };

/** A linked connector as reported by GET /api/connectors. */
export interface ConnectorInfo {
  provider: string;
  externalAccount: string | null;
}

export interface GithubRepoOption {
  fullName: string;
  defaultBranch: string;
}

export interface NotionPageOption {
  id: string;
  title: string;
  type: string;
}
