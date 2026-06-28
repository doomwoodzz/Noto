// The link-citation surface the workspace renders against — mirrors the
// AIClient / VaultController DI pattern. The authenticated app injects a real
// server-backed client (see src/app/citationClient.ts) that unfurls links via
// /api/links/*; the marketing demo injects `mockCitationClient`, which derives
// a chip from the URL alone so the preview stays free, offline, and identical
// looking without touching the network.

import { createContext, useContext } from "react";

/** Metadata for a single cited link (returned by /api/links/metadata). */
export interface CitationMeta {
  url: string;
  host: string;
  siteName: string;
  title: string;
  description: string;
  /** Favicon inlined as a `data:` URL (CSP-safe), or null if unavailable. */
  faviconDataUrl: string | null;
  /** Absolute URL of the main thumbnail, fetched lazily via `image()`. */
  imageUrl: string | null;
  publishedDate: string | null;
}

export interface CitationClient {
  /** True for the demo's offline client: derive from the URL, never fetch. */
  simulated: boolean;
  /** Unfurl a URL into citation metadata (site name, favicon, description…). */
  metadata(url: string): Promise<CitationMeta>;
  /** Fetch a thumbnail (by its absolute URL) as a `data:` URL, or null. */
  image(url: string): Promise<string | null>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Zero-cost, offline client for the public marketing demo. */
export const mockCitationClient: CitationClient = {
  simulated: true,
  async metadata(url) {
    const host = hostOf(url);
    return {
      url,
      host,
      siteName: host,
      title: host,
      description: "",
      faviconDataUrl: null,
      imageUrl: null,
      publishedDate: null,
    };
  },
  async image() {
    return null;
  },
};

/* ------------------------------ injection ------------------------------ */

export const CitationClientContext = createContext<CitationClient>(mockCitationClient);

export function useCitationClient(): CitationClient {
  return useContext(CitationClientContext);
}
