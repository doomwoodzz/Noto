/**
 * Client for the Noto app API (auth + notes).
 *
 * Same-origin fetch with credentials:"include" so the httpOnly session cookie
 * rides along (never touched by JS). State-changing requests echo the readable
 * CSRF cookie in X-CSRF-Token (double-submit; see server/auth/csrf.ts).
 */
import type { VaultFile } from "../noto-core";
import type { CitationMeta } from "../workspace/citationClient";
import type { ActivityEntry, RevertOutcome } from "../workspace/activityClient";
import type {
  PublicDumpJob,
  DumpSource,
  ConnectorInfo,
  GithubRepoOption,
  NotionPageOption,
} from "../workspace/dumpTypes";

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  theme: "light" | "dark" | string;
  emailVerified: boolean;
}

export interface Vault {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

export interface VaultAIConfig {
  provider: string;
  model: string | null;
  configured: boolean;
}

let activeVaultId: string | null = null;
/** Set the vault whose context (per-vault AI key/model) AI requests should use. */
export function setActiveVault(id: string | null): void {
  activeVaultId = id;
}

const CSRF_COOKIE = "noto_csrf";

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

async function ensureCsrfToken(): Promise<string> {
  let token = readCookie(CSRF_COOKIE);
  if (!token) {
    await fetch("/api/auth/me", { credentials: "include" }).catch(() => {});
    token = readCookie(CSRF_COOKIE);
  }
  return token ?? "";
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    headers["X-CSRF-Token"] = await ensureCsrfToken();
  }
  if (activeVaultId) headers["x-noto-vault"] = activeVaultId;
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body (e.g. 204) */
  }
  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? "Something went wrong. Please try again.";
    throw new ApiError(message, res.status);
  }
  return data as T;
}

/**
 * Upload a recorded audio Blob as a raw body (the server reads it with
 * express.raw and forwards it to OpenAI). Carries the CSRF token + session
 * cookie exactly like {@link request}.
 */
async function uploadAudio(path: string, audio: Blob): Promise<{ transcript: string }> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": audio.type || "audio/webm",
      "X-CSRF-Token": await ensureCsrfToken(),
    },
    body: audio,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    throw new ApiError(
      (data as { error?: string } | null)?.error ?? "Transcription failed.",
      res.status,
    );
  }
  return data as { transcript: string };
}

export const api = {
  /* auth */
  me: () => request<{ user: PublicUser | null }>("GET", "/api/auth/me"),
  logout: () => request<void>("POST", "/api/auth/logout"),
  savePreferences: (theme: "light" | "dark") =>
    request<{ ok: true }>("PATCH", "/api/auth/preferences", { theme }),

  /* ai (authenticated OpenAI-backed features) */
  ai: {
    chat: (input: {
      noteTitle?: string;
      noteContent?: string;
      outline?: string;
      question: string;
    }) => request<{ reply: string }>("POST", "/api/ai/chat", input),
    summarize: (input: { noteTitle: string; noteContent: string }) =>
      request<{ reply: string }>("POST", "/api/ai/summarize", input),
    flashcards: (input: { noteTitle: string; noteContent: string }) =>
      request<{ cards: { q: string; a: string }[] }>("POST", "/api/ai/flashcards", input),
    findLinks: (input: { noteTitle: string; noteContent: string; titles: string[] }) =>
      request<{ related: string[] }>("POST", "/api/ai/find-links", input),
    transcribe: (audio: Blob) => uploadAudio("/api/ai/transcribe", audio),
    lectureNotes: (input: { transcript: string; titles: string[] }) =>
      request<{ markdown: string }>("POST", "/api/ai/lecture-notes", input),
  },

  /* link citations (authenticated, server-proxied unfurling) */
  links: {
    metadata: (url: string) => request<CitationMeta>("POST", "/api/links/metadata", { url }),
    image: (url: string) =>
      request<{ dataUrl: string | null }>("POST", "/api/links/image", { url }),
  },

  /* personal access tokens (for MCP / external AI tools) */
  pat: {
    list: () =>
      request<{ tokens: { id: string; name: string; scopes: string[]; createdAt: number; lastUsedAt: number | null }[] }>("GET", "/api/tokens"),
    mint: (input: { name: string; scopes: ("read" | "write" | "destructive" | "memory")[] }) =>
      request<{ id: string; token: string; name: string; scopes: string[] }>("POST", "/api/tokens", input),
    revoke: (id: string) => request<void>("DELETE", `/api/tokens/${id}`),
  },

  /* shared memory (read-only browse for the Settings panel) */
  memory: {
    list: (params?: { scope?: string; limit?: number }) =>
      request<{ memories: { id: string; text: string; type: string; scope: string; sourceClient: string; lastUsed: number }[] }>(
        "GET",
        `/api/memory/list?${new URLSearchParams({ ...(params?.scope ? { scope: params.scope } : {}), limit: String(params?.limit ?? 100) }).toString()}`,
      ),
  },

  /* AI activity (provenance/trust surface — cookie only) */
  activity: {
    list: (params?: { tool?: string; source?: string; fileId?: string; before?: number; limit?: number }) =>
      request<{ activity: ActivityEntry[] }>(
        "GET",
        `/api/activity?${new URLSearchParams({
          ...(params?.tool ? { tool: params.tool } : {}),
          ...(params?.source ? { source: params.source } : {}),
          ...(params?.fileId ? { fileId: params.fileId } : {}),
          ...(params?.before ? { before: String(params.before) } : {}),
          limit: String(params?.limit ?? 50),
        }).toString()}`,
      ),
    preview: (auditId: string) =>
      request<{ before: string | null; current: string | null }>("GET", `/api/activity/${auditId}/preview`),
    // Revert resolves the 409 "conflict" outcome as data (not an error) so the
    // UI can show the diff + offer force; other non-2xx still throw.
    revert: async (auditId: string, force = false): Promise<RevertOutcome> => {
      const res = await fetch(`/api/activity/${auditId}/revert`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": await ensureCsrfToken() },
        body: JSON.stringify({ force }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; error?: string; reason?: string; before?: string | null; current?: string | null };
      if (!res.ok && res.status !== 409 && res.status !== 422) {
        throw new ApiError(data.error ?? "Revert failed.", res.status);
      }
      return data as RevertOutcome;
    },
  },

  /* dump (bulk ingest → atomic notes; cookie-session only, never PAT) */
  dump: {
    start: (source: DumpSource) =>
      request<{ jobId: string }>("POST", "/api/dump", { source }),
    poll: (jobId: string) =>
      request<PublicDumpJob>("GET", `/api/dump/jobs/${jobId}`),
    commit: (
      jobId: string,
      selectedItemIds: string[],
      updates?: Record<string, "overwrite" | "skip">,
    ) =>
      request<{ ok: true }>("POST", `/api/dump/jobs/${jobId}/commit`, {
        selectedItemIds,
        ...(updates ? { updates } : {}),
      }),
    cancel: (jobId: string) =>
      request<{ ok: true }>("POST", `/api/dump/jobs/${jobId}/cancel`),
    remove: (jobId: string, purgeNotes: boolean) =>
      request<void>("DELETE", `/api/dump/jobs/${jobId}${purgeNotes ? "?purgeNotes=1" : ""}`),
    githubRepos: () =>
      request<{ repos: GithubRepoOption[] }>("GET", "/api/dump/github/repos"),
    notionPages: () =>
      request<{ pages: NotionPageOption[] }>("GET", "/api/dump/notion/pages"),
    connectors: () =>
      request<{ connectors: ConnectorInfo[] }>("GET", "/api/connectors"),
    disconnect: (provider: string) =>
      request<void>("DELETE", `/api/connectors/${provider}`),
  },

  /* notes */
  listVaults: () => request<{ vaults: Vault[] }>("GET", "/api/vaults"),
  createVault: (input: { name: string; icon?: string | null; color?: string | null }) =>
    request<{ vault: Vault }>("POST", "/api/vaults", input),
  vaultAI: {
    get: (vaultId: string) => request<VaultAIConfig>("GET", `/api/vaults/${vaultId}/ai`),
    set: (vaultId: string, input: { provider: string; model?: string | null; apiKey?: string }) =>
      request<VaultAIConfig>("PUT", `/api/vaults/${vaultId}/ai`, input),
  },
  listFiles: (vaultId: string) =>
    request<{ files: VaultFile[] }>("GET", `/api/vaults/${vaultId}/files`),
  createFile: (vaultId: string, input: { path: string; title: string; content: string }) =>
    request<{ file: VaultFile }>("POST", `/api/vaults/${vaultId}/files`, input),
  updateFile: (
    fileId: string,
    patch: { path?: string; title?: string; content?: string; pinned?: boolean },
  ) => request<{ file: VaultFile }>("PATCH", `/api/files/${fileId}`, patch),
  deleteFile: (fileId: string) => request<void>("DELETE", `/api/files/${fileId}`),
};
