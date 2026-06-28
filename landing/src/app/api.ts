/**
 * Client for the Noto app API (auth + notes).
 *
 * Same-origin fetch with credentials:"include" so the httpOnly session cookie
 * rides along (never touched by JS). State-changing requests echo the readable
 * CSRF cookie in X-CSRF-Token (double-submit; see server/auth/csrf.ts).
 */
import type { VaultFile } from "../noto-core";
import type { CitationMeta } from "../workspace/citationClient";

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

  /* notes */
  listVaults: () => request<{ vaults: Vault[] }>("GET", "/api/vaults"),
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
