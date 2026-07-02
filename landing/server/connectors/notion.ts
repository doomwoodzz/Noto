/**
 * Minimal dependency-free Notion REST client.
 *
 * We deliberately avoid @notionhq/client: this thin wrapper over fetch keeps the
 * bundle clean and routes every request through an SSRF host check (Notion's
 * host must resolve to a public IP). The token is sent as a Bearer credential
 * and never appears in a thrown error or a log line. `fetchImpl` is injectable
 * so unit tests run entirely offline.
 */
import { assertPublicHost } from "../links/fetchMeta.ts";

const NOTION_VERSION = "2022-06-28";
const API_BASE = "https://api.notion.com";
const TIMEOUT_MS = 10_000;

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

/* ----- Narrow shapes we actually read (Notion returns far more) -------- */
export interface NotionRichText {
  plain_text?: string;
}
export interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  // Block payloads are keyed by `type`; we read them dynamically in the mapper.
  [key: string]: unknown;
}
export interface NotionPage {
  id: string;
  object?: string;
  last_edited_time?: string;
  url?: string;
  properties?: Record<string, unknown>;
  // Databases come back with object:"database" and a `title` array.
  title?: NotionRichText[];
}
export interface NotionSearchResult {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}
export interface NotionBlockChildren {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface NotionClient {
  search(input?: { query?: string; cursor?: string; pageSize?: number }): Promise<NotionSearchResult>;
  blockChildren(blockId: string, cursor?: string): Promise<NotionBlockChildren>;
  retrievePage(pageId: string): Promise<NotionPage>;
}

export function makeNotionClient(token: string, fetchImpl: FetchImpl = fetch): NotionClient {
  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const url = new URL(path, API_BASE);
    await assertPublicHost(url.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetchImpl(url.href, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      // Drain + drop the body; never echo the token or response text.
      await resp.body?.cancel().catch(() => {});
      throw new Error(`Notion API error ${resp.status}`);
    }
    return resp.json();
  }

  return {
    async search(input = {}) {
      const payload: Record<string, unknown> = { page_size: input.pageSize ?? 100 };
      if (input.query) payload.query = input.query;
      if (input.cursor) payload.start_cursor = input.cursor;
      return (await call("POST", "/v1/search", payload)) as NotionSearchResult;
    },
    async blockChildren(blockId, cursor) {
      const u = new URL(`/v1/blocks/${encodeURIComponent(blockId)}/children`, API_BASE);
      u.searchParams.set("page_size", "100");
      if (cursor) u.searchParams.set("start_cursor", cursor);
      return (await call("GET", u.pathname + u.search)) as NotionBlockChildren;
    },
    async retrievePage(pageId) {
      return (await call("GET", `/v1/pages/${encodeURIComponent(pageId)}`)) as NotionPage;
    },
  };
}
