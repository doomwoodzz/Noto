/**
 * Thin client for the auth API.
 *
 * - Same-origin fetch with credentials:"include" so the httpOnly session cookie
 *   rides along (and is never touched by JS).
 * - Reads the readable CSRF cookie and echoes it back in X-CSRF-Token on every
 *   state-changing request (double-submit pattern; see server/auth/csrf.ts).
 */

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  theme: "light" | "dark" | string;
  emailVerified: boolean;
}

const CSRF_COOKIE = "noto_csrf";

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Make sure the server has issued a CSRF cookie, then return its value. */
async function ensureCsrfToken(): Promise<string> {
  let token = readCookie(CSRF_COOKIE);
  if (!token) {
    // Any GET to /api issues the cookie.
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

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty body (e.g. 204) */
  }
  if (!res.ok) {
    throw new ApiError(data?.error ?? "Something went wrong. Please try again.", res.status);
  }
  return data as T;
}

export const authApi = {
  health: () => request<{ ok: boolean; googleConfigured: boolean }>("GET", "/api/health"),
  me: () => request<{ user: PublicUser | null }>("GET", "/api/auth/me"),
  signup: (email: string, password: string) =>
    request<{ user: PublicUser }>("POST", "/api/auth/signup", { email, password }),
  login: (email: string, password: string) =>
    request<{ user: PublicUser }>("POST", "/api/auth/login", { email, password }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  savePreferences: (theme: "light" | "dark") =>
    request<{ ok: true }>("PATCH", "/api/auth/preferences", { theme }),
  /** Full-page redirect to begin the Google OAuth flow. */
  googleLoginUrl: "/api/auth/google",
};
