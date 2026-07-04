// Mirrors noto-mcp/src/notoClient.ts return types (the frozen tool contract).
export interface SearchResult { fileId: string; title: string; path: string; headingPath: string[]; snippet: string; score: number }
export interface NoteRef { fileId: string; title: string; path: string; updatedAt: number }
export interface Memory { id: string; text: string; type: string; scope: string; sourceClient: string; lastUsed: number; score?: number }

export interface NotoBridgeClient {
  searchNotes(a: { query: string; scope?: string; tag?: string; limit?: number }): Promise<{ results: SearchResult[] }>;
  listNotes(a: { by?: string; limit?: number }): Promise<{ notes: NoteRef[] }>;
  getNote(a: { fileId: string }): Promise<{ file: { id: string; title: string; path: string; content: string; updatedAt: number } }>;
  getSection(a: { fileId: string; heading: string }): Promise<{ fileId: string; headingPath: string[]; content: string }>;
  remember(a: { text: string; type?: string; scope?: string; supersedes?: string }): Promise<{ memoryId: string; deduped: boolean }>;
  recall(a: { query: string; scope?: string; type?: string; limit?: number }): Promise<{ memories: Memory[] }>;
  createNote(a: { path: string; title: string; content?: string }): Promise<{ fileId: string; path: string }>;
  appendNote(a: { fileId: string; text: string; underHeading?: string; expectUpdatedAt?: number }): Promise<{ fileId: string; updatedAt: number }>;
  updateSection(a: { fileId: string; heading: string; content: string; expectUpdatedAt?: number }): Promise<{ fileId: string; updatedAt: number }>;
}

const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

/**
 * Build a NotoBridgeClient whose calls are replayed through the app's own /api
 * stack over a 127.0.0.1 loopback `fetch`. `baseUrl` is the app's loopback origin
 * (e.g. `http://127.0.0.1:8787`); `token` is the verbatim Authorization header
 * ("Bearer noto_pat_…"); `client` becomes X-Noto-Client for provenance.
 *
 * We loop back over a real socket rather than dispatching in-process: a synthetic
 * in-process request nested inside the real /mcp request leaves `req.headers`
 * undefined and entangles the mock request with the real socket's lifecycle
 * (light-my-request `inject(app)` is only safe at the top level, not re-entrantly
 * inside a live request). A localhost roundtrip is negligible and reuses every
 * SP1–SP3 guard (PAT auth bypasses CSRF, Memory/ confinement, scope checks, audit)
 * with zero duplication.
 */
export function makeLoopbackClient(baseUrl: string, opts: { token: string; client: string }): NotoBridgeClient {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: opts.token, "x-noto-client": opts.client };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(baseUrl + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data: unknown = null;
    try { data = JSON.parse(await res.text()); } catch { /* empty body */ }
    if (!res.ok) {
      throw new Error((data as { error?: string } | null)?.error ?? `Noto request failed (${res.status})`);
    }
    return data as T;
  }
  const enc = encodeURIComponent;
  return {
    searchNotes: (a) => call("GET", `/api/search?${qs({ q: a.query, scope: a.scope, tag: a.tag, limit: a.limit ?? 5 })}`),
    listNotes: (a) => call("GET", `/api/notes?${qs({ by: a.by ?? "recent", limit: a.limit ?? 20 })}`),
    getNote: (a) => call("GET", `/api/files/${enc(a.fileId)}`),
    getSection: (a) => call("GET", `/api/files/${enc(a.fileId)}/section?heading=${enc(a.heading)}`),
    remember: (a) => call("POST", "/api/memory", a),
    recall: (a) => call("GET", `/api/memory?${qs({ q: a.query, scope: a.scope, type: a.type, limit: a.limit ?? 6 })}`),
    createNote: (a) => call("POST", "/api/notes", a),
    appendNote: (a) => call("POST", `/api/files/${enc(a.fileId)}/append`, { text: a.text, underHeading: a.underHeading, expectUpdatedAt: a.expectUpdatedAt }),
    updateSection: (a) => call("PATCH", `/api/files/${enc(a.fileId)}/section`, { heading: a.heading, content: a.content, expectUpdatedAt: a.expectUpdatedAt }),
  };
}
