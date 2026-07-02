// Raw SourceProvider: pasted text + uploaded files → RawItems. No network. The
// foundational provider behind paste/upload (Global Constraints §15 source keys).
// github/notion providers (P4/P5) implement the same SourceProvider contract.

import { sha256Hex } from "../../db.ts";
import type { FetchCtx, RawItem, SourceProvider } from "../types.ts";

interface RawFile { name: string; content: string }
interface RawSourceRef {
  type: "raw";
  text?: string;
  files?: RawFile[];
  ref?: string; // optional caller-supplied id (e.g. jobId) for provenance
}

/** First markdown ATX heading text in `content`, if any. */
function firstHeading(content: string): string | null {
  for (const line of content.split(/\r\n|\r|\n/)) {
    const m = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m && m[2].trim()) return m[2].trim();
  }
  return null;
}

/** Filename without its extension (e.g. "Notes On Cells.md" → "Notes On Cells"). */
function stem(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim();
}

export const rawProvider: SourceProvider = {
  async fetch(ctx: FetchCtx): Promise<RawItem[]> {
    const ref = (ctx.sourceRef ?? {}) as RawSourceRef;
    const originRef = ref.ref ?? String(Date.now());
    const items: RawItem[] = [];

    const push = (content: string, titleHint: string): boolean => {
      if (items.length >= ctx.cap) return false;
      const body = content;
      if (!body.trim()) return true; // skip empties, keep enumerating
      const title = firstHeading(body) ?? (titleHint.trim() || "Pasted Notes");
      items.push({
        sourceKey: `raw:${sha256Hex(body)}`,
        title,
        body,
        origin: { type: "raw", ref: originRef },
      });
      ctx.onProgress(items.length);
      return true;
    };

    // Files first (deterministic order), then pasted text.
    for (const f of ref.files ?? []) {
      if (!push(f.content, stem(f.name))) break;
    }
    if (items.length < ctx.cap && ref.text) push(ref.text, "Pasted Notes");

    return items;
  },
};
