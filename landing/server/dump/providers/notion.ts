/**
 * The `notion` SourceProvider.
 *
 * fetch(ctx): for each selected page (deterministic order, capped), retrieve the
 * page, page through its block children, inline each table's rows, recurse into
 * child pages (bounded depth) as separate RawItems mirroring the tree, and map
 * blocks → markdown. Best-effort per page: a failed page is skipped, others
 * proceed. Self-throttles to ~3 req/s via an injected delay (0 in tests).
 */
import { decryptKey } from "../../ai/keyvault.ts";
import { getConnectorToken } from "../../db.ts";
import { makeNotionClient, type NotionClient, type NotionBlock } from "../../connectors/notion.ts";
import { blocksToMarkdown } from "../blocksToMarkdown.ts";
import type { SourceProvider, FetchCtx, RawItem } from "../types.ts";

const MAX_DEPTH = 4;          // bounded child-page recursion
const MAX_BLOCK_PAGES = 50;   // hard ceiling on cursor pages per block (5000 blocks)
const MAX_BLOCK_DEPTH = 8;    // bounded nested-block recursion (sub-lists/toggles)

interface NotionProviderDeps {
  /** Resolve a client for the user. Production: build from the stored token. */
  getClient: (userId: string) => NotionClient;
  /** Per-request throttle (~340ms ≈ 3 req/s in prod; 0 in tests). */
  delayMs: number;
}

function defaultGetClient(userId: string): NotionClient {
  const row = getConnectorToken(userId, "notion");
  if (!row || !row.access_token_cipher) {
    throw new Error("Notion is not connected");
  }
  return makeNotionClient(decryptKey(row.access_token_cipher));
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

function plainTitle(block: NotionBlock): string {
  const payload = block[block.type];
  if (payload && typeof payload === "object") {
    const title = (payload as { title?: unknown }).title;
    if (typeof title === "string" && title.trim()) return title.trim();
  }
  return "Untitled";
}

export function makeNotionProvider(deps: NotionProviderDeps): SourceProvider {
  const { getClient, delayMs } = deps;

  return {
    async fetch(ctx: FetchCtx): Promise<RawItem[]> {
      const ref = ctx.sourceRef as { pageIds?: unknown };
      const pageIds = Array.isArray(ref?.pageIds)
        ? (ref.pageIds.filter((p): p is string => typeof p === "string"))
        : [];
      const client = getClient(ctx.userId);
      const items: RawItem[] = [];
      const seen = new Set<string>(); // guard against cyclic child references

      // Fetch the flat block list of a block id, paging the cursor, and inline
      // each table's row children right after the table block.
      async function fetchBlocks(blockId: string, depth = 0): Promise<NotionBlock[]> {
        const collected: NotionBlock[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_BLOCK_PAGES; page++) {
          await delay(delayMs);
          const res = await client.blockChildren(blockId, cursor);
          for (const block of res.results) {
            collected.push(block);
            if (block.type === "table" && block.has_children) {
              const rows = await fetchBlocks(block.id, depth + 1); // table_row children
              for (const row of rows) if (row.type === "table_row") collected.push(row);
            } else if (
              block.has_children &&
              block.type !== "child_page" &&
              block.type !== "child_database" &&
              depth < MAX_BLOCK_DEPTH
            ) {
              // Nested content — sub-lists, to_do sub-items, toggle bodies, column
              // layouts — lives as fetched children. Inline it (flattened) so it
              // isn't silently dropped. child_page/child_database are handled
              // separately as their own RawItems, so they're excluded here to
              // avoid double-processing the same content.
              const nested = await fetchBlocks(block.id, depth + 1);
              for (const child of nested) collected.push(child);
            }
          }
          if (!res.has_more || !res.next_cursor) break;
          cursor = res.next_cursor;
        }
        return collected;
      }

      // Process one page → a RawItem, then recurse into its child pages.
      // `titleHint` is the parent-declared `child_page.title`, used when the page
      // itself has no leading heading (so the path mirrors the tree by name).
      async function processPage(
        pageId: string,
        pathSegments: string[],
        depth: number,
        titleHint?: string,
      ): Promise<void> {
        if (items.length >= ctx.cap) return;
        if (seen.has(pageId)) return;
        seen.add(pageId);

        let lastEdited: string;
        let url: string | undefined;
        try {
          await delay(delayMs);
          const page = await client.retrievePage(pageId);
          lastEdited = typeof page.last_edited_time === "string" ? page.last_edited_time : "";
          url = typeof page.url === "string" ? page.url : undefined;
        } catch {
          return; // best-effort: skip a page we cannot read
        }

        let blocks: NotionBlock[];
        try {
          blocks = await fetchBlocks(pageId);
        } catch {
          return; // skip on a hard block-fetch failure
        }

        // Title: first heading_1, else the parent-declared child_page title,
        // else the trailing path segment, else the id.
        const firstHeading = blocks.find((b) => b.type === "heading_1");
        const headingTitle = firstHeading
          ? blocksToMarkdown([firstHeading]).replace(/^#\s+/, "").trim()
          : "";
        const title =
          headingTitle || titleHint || pathSegments[pathSegments.length - 1] || pageId;
        const path = [...pathSegments, title].join("/");

        items.push({
          // Stable identity (no @last_edited) so re-dump detects change via
          // content_hash and updates in place (design D6).
          sourceKey: `notion:${pageId}`,
          title,
          body: blocksToMarkdown(blocks),
          origin: { type: "notion", ref: lastEdited, url, path },
        });

        if (depth >= MAX_DEPTH) return;
        for (const block of blocks) {
          if (items.length >= ctx.cap) return;
          if (block.type === "child_page" && block.has_children !== false) {
            // The child's own first heading wins; the parent-declared child_page
            // title is passed as a fallback so the mirrored path is named.
            const childTitle = plainTitle(block);
            await processPage(block.id, [...pathSegments, title], depth + 1, childTitle);
          }
        }
        ctx.onProgress(items.length);
      }

      for (const pageId of pageIds) {
        if (items.length >= ctx.cap) break;
        await processPage(pageId, [], 0);
      }

      // Systemic failure: pages were requested but NONE produced an item (e.g. a
      // revoked token or a Notion outage failing every retrieve). Surface it so the
      // job lands "failed" rather than a misleading empty "success". A legitimately
      // empty page still yields one item, so this only fires on total failure.
      if (pageIds.length > 0 && items.length === 0) {
        throw new Error(`Notion: all ${pageIds.length} selected page(s) failed to fetch`);
      }

      return items.slice(0, ctx.cap);
    },
  };
}

/** Production provider: real client from the stored token, ~3 req/s throttle. */
export const notionProvider: SourceProvider = makeNotionProvider({
  getClient: defaultGetClient,
  delayMs: 340,
});
