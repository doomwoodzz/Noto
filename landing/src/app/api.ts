/**
 * Client for the Noto app API (auth + notes).
 *
 * Same-origin fetch with credentials:"include" so the httpOnly session cookie
 * rides along (never touched by JS). State-changing requests echo the readable
 * CSRF cookie in X-CSRF-Token (double-submit; see server/auth/csrf.ts).
 */
import type { VaultFile } from "../noto-core";

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

export const api = {
  /* auth */
  me: () => request<{ user: PublicUser | null }>("GET", "/api/auth/me"),
  logout: () => request<void>("POST", "/api/auth/logout"),
  savePreferences: (theme: "light" | "dark") =>
    request<{ ok: true }>("PATCH", "/api/auth/preferences", { theme }),

  /* notes */
  listVaults: () => request<{ vaults: Vault[] }>("GET", "/api/vaults"),
  listFiles: (vaultId: string) =>
    request<{ files: VaultFile[] }>("GET", `/api/vaults/${vaultId}/files`),
  createFile: (vaultId: string, input: { path: string; title: string; content: string }) =>
    request<{ file: VaultFile }>("POST", `/api/vaults/${vaultId}/files`, input),
  updateFile: (fileId: string, patch: { path?: string; title?: string; content?: string }) =>
    request<{ file: VaultFile }>("PATCH", `/api/files/${fileId}`, patch),
  deleteFile: (fileId: string) => request<void>("DELETE", `/api/files/${fileId}`),
};
