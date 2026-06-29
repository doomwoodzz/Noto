// Session-scoped cache for cited-link metadata and thumbnails.
//
// `inlineHtml` stays pure (it never fetches); the editor's favicon-decoration
// pass and the hover card read this cache synchronously and subscribe to be
// notified when a fetch resolves. Fetches are de-duped per URL so re-renders,
// repeated hovers, and the paste-enrichment never fire the same request twice.

import type { CitationClient, CitationMeta } from "./citationClient";

const metaCache = new Map<string, CitationMeta>();
const metaInflight = new Map<string, Promise<CitationMeta>>();
const imageCache = new Map<string, string | null>();
const imageInflight = new Map<string, Promise<string | null>>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** Subscribe to cache updates (favicon/thumbnail arrivals). Returns an unsub. */
export function subscribeCitations(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getCitationMeta(url: string): CitationMeta | undefined {
  return metaCache.get(url);
}

/** Resolve metadata for a URL, fetching at most once and caching the result. */
export function ensureCitationMeta(url: string, client: CitationClient): Promise<CitationMeta> {
  const cached = metaCache.get(url);
  if (cached) return Promise.resolve(cached);
  const inflight = metaInflight.get(url);
  if (inflight) return inflight;
  const p = client
    .metadata(url)
    .then((m) => {
      metaCache.set(url, m);
      metaInflight.delete(url);
      notify();
      return m;
    })
    .catch((err) => {
      metaInflight.delete(url);
      throw err;
    });
  metaInflight.set(url, p);
  return p;
}

/** `undefined` = not fetched yet, `null` = fetched but no image, string = data URL. */
export function getCitationImage(url: string): string | null | undefined {
  return imageCache.get(url);
}

export function ensureCitationImage(url: string, client: CitationClient): Promise<string | null> {
  if (imageCache.has(url)) return Promise.resolve(imageCache.get(url) ?? null);
  const inflight = imageInflight.get(url);
  if (inflight) return inflight;
  const p = client
    .image(url)
    .then((d) => {
      imageCache.set(url, d);
      imageInflight.delete(url);
      notify();
      return d;
    })
    .catch(() => {
      imageCache.set(url, null);
      imageInflight.delete(url);
      notify();
      return null;
    });
  imageInflight.set(url, p);
  return p;
}
