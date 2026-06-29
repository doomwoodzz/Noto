type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export interface NotoClientOptions {
  baseUrl: string; token: string; client: string;
  fetchImpl?: FetchImpl;
}
export interface SearchResult { fileId: string; title: string; headingPath: string[]; snippet: string; score: number }
export interface NoteRef { fileId: string; title: string; path: string; updatedAt: number }
export interface Memory { id: string; text: string; type: string; scope: string; sourceClient: string; lastUsed: number; score?: number }

export function createNotoClient(opts: NotoClientOptions) {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as FetchImpl);

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.token}`,
      "X-Noto-Client": opts.client,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await doFetch(base + path, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data: unknown = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      const msg = (data as { error?: string } | null)?.error ?? `Noto request failed (${res.status})`;
      throw new Error(msg);
    }
    return data as T;
  }
  const qs = (o: Record<string, string | number | undefined>) =>
    Object.entries(o).filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

  return {
    // scope/tag are forwarded for forward-compat; SP1's /api/search filters notes by user only.
    searchNotes: (a: { query: string; scope?: string; tag?: string; limit?: number }) =>
      call<{ results: SearchResult[] }>("GET", `/api/search?${qs({ q: a.query, scope: a.scope, tag: a.tag, limit: a.limit ?? 5 })}`),
    listNotes: (a: { by?: string; limit?: number }) =>
      call<{ notes: NoteRef[] }>("GET", `/api/notes?${qs({ by: a.by ?? "recent", limit: a.limit ?? 20 })}`),
    getNote: (a: { fileId: string }) =>
      call<{ file: { id: string; title: string; path: string; content: string; updatedAt: number } }>("GET", `/api/files/${encodeURIComponent(a.fileId)}`),
    getSection: (a: { fileId: string; heading: string }) =>
      call<{ fileId: string; headingPath: string[]; content: string }>("GET", `/api/files/${encodeURIComponent(a.fileId)}/section?heading=${encodeURIComponent(a.heading)}`),
    remember: (a: { text: string; type?: string; scope?: string; supersedes?: string }) =>
      call<{ memoryId: string; deduped: boolean }>("POST", "/api/memory", a),
    recall: (a: { query: string; scope?: string; type?: string; limit?: number }) =>
      call<{ memories: Memory[] }>("GET", `/api/memory?${qs({ q: a.query, scope: a.scope, type: a.type, limit: a.limit ?? 6 })}`),
    createNote: (a: { path: string; title: string; content?: string }) =>
      call<{ fileId: string; path: string }>("POST", "/api/notes", a),
    appendNote: (a: { fileId: string; text: string; underHeading?: string; expectUpdatedAt?: number }) =>
      call<{ fileId: string; updatedAt: number }>("POST", `/api/files/${encodeURIComponent(a.fileId)}/append`, { text: a.text, underHeading: a.underHeading, expectUpdatedAt: a.expectUpdatedAt }),
    updateSection: (a: { fileId: string; heading: string; content: string; expectUpdatedAt?: number }) =>
      call<{ fileId: string; updatedAt: number }>("PATCH", `/api/files/${encodeURIComponent(a.fileId)}/section`, { heading: a.heading, content: a.content, expectUpdatedAt: a.expectUpdatedAt }),
  };
}
export type NotoClient = ReturnType<typeof createNotoClient>;
