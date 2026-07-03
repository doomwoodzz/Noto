// Shared Dump types. See docs/superpowers/plans/2026-06-30-noto-dump/overview.md.

export interface ProvenanceOrigin {
  type: "raw" | "github" | "notion";
  ref?: string;
  url?: string;
  path?: string;
  repo?: string;
}

export interface RawItem {
  sourceKey: string;
  title: string;
  body: string;
  origin: ProvenanceOrigin;
}

export interface ShapedNote {
  notePath: string;
  title: string;
  summary: string;
  tags: string[];
  links: string[];
  body: string;
  origin: ProvenanceOrigin;
}

export interface FetchCtx {
  userId: string;
  sourceRef: unknown;
  cap: number;
  onProgress: (fetched: number) => void;
}

export interface SourceProvider {
  fetch(ctx: FetchCtx): Promise<RawItem[]>;
}

export type DumpStatus =
  | "queued" | "fetching" | "shaping" | "awaiting_review" | "committing" | "done" | "failed" | "cancelled";

export type DumpItemStatus =
  | "pending" | "shaped" | "duplicate" | "update" | "selected" | "committed" | "failed" | "skipped";

export interface DumpCounts {
  fetched?: number; shaped?: number; redacted?: number;
  duplicates?: number; updates?: number; committed?: number; failed?: number;
  overCap?: number; totalAvailable?: number;
}

export interface DumpJobRow {
  id: string; user_id: string; vault_id: string;
  source_type: "raw" | "github" | "notion";
  source_ref: string; source_slug: string;
  status: DumpStatus; counts: string; error: string | null;
  created_at: number; updated_at: number;
}

export interface DumpItemRow {
  id: string; job_id: string; source_key: string;
  status: DumpItemStatus; redaction_count: number;
  shaped: string | null; file_id: string | null; dedup_of: string | null; error: string | null;
}

export interface DumpSourceRow {
  user_id: string; vault_id: string; source_key: string; file_id: string;
  content_hash: string; job_id: string | null; created_at: number;
}

export interface ConnectorTokenRow {
  id: string; user_id: string; provider: "github" | "notion";
  external_account: string | null; installation_id: string | null;
  access_token_cipher: Uint8Array | null; refresh_token_cipher: Uint8Array | null;
  expires_at: number | null; scopes: string | null; created_at: number; updated_at: number;
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

// Public job view returned to the client by the poll endpoint.
export interface PublicDumpJob {
  id: string;
  sourceType: "raw" | "github" | "notion";
  status: DumpStatus;
  counts: DumpCounts;
  error: string | null;
  manifest?: ManifestItem[]; // present once status === "awaiting_review"
}
