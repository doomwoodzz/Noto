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

/** The `title` string off a child_page/child_database block payload. */
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
      async function fetchBlocks(blockId: string): Promise<NotionBlock[]> {
        const collected: NotionBlock[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_BLOCK_PAGES; page++) {
          await delay(delayMs);
          const res = await client.blockChildren(blockId, cursor);
          for (const block of res.results) {
            collected.push(block);
            if (block.type === "table" && block.has_children) {
              const rows = await fetchBlocks(block.id); // table_row children
              for (const row of rows) if (row.type === "table_row") collected.push(row);
            }
          }
          if (!res.has_more || !res.next_cursor) break;
          cursor = res.next_cursor;
        }
        return collected;
      }

      // Process one page → a RawItem, then recurse into its child pages.
      // `titleHint` carries the child_page block's title so the mirrored path
      // stays meaningful even when the child page has no leading heading.
      async function processPage(pageId: string, pathSegments: string[], depth: number, titleHint?: string): Promise<void> {
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

        // Title: first heading_1 → child_page title hint → trailing path segment → id.
        const firstHeading = blocks.find((b) => b.type === "heading_1");
        const headingTitle = firstHeading
          ? blocksToMarkdown([firstHeading]).replace(/^#\s+/, "").trim()
          : "";
        const title = headingTitle || titleHint || pathSegments[pathSegments.length - 1] || pageId;
        const path = [...pathSegments, title].join("/");

        items.push({
          sourceKey: `notion:${pageId}@${lastEdited}`,
          title,
          body: blocksToMarkdown(blocks),
          origin: { type: "notion", ref: lastEdited, url, path },
        });

        if (depth >= MAX_DEPTH) return;
        for (const block of blocks) {
          if (items.length >= ctx.cap) return;
          if (block.type === "child_page" && block.has_children !== false) {
            // A failing subtree never aborts the batch.
            await processPage(block.id, [...pathSegments, title], depth + 1, plainTitle(block)).catch(() => {});
          }
        }
        ctx.onProgress(items.length);
      }

      for (const pageId of pageIds) {
        if (items.length >= ctx.cap) break;
        await processPage(pageId, [], 0);
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
