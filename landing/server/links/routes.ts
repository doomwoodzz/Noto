/**
 * Link-citation API — authenticated link unfurling for inline citations.
 *
 * Security & abuse model (mirrors ai/routes.ts):
 *  - Every route requires a valid session (requireUserId → 401), so anonymous
 *    traffic can't use the server as an open URL fetcher. The public marketing
 *    demo uses a client-side mock instead of these routes.
 *  - A dedicated rate limiter caps per-IP calls.
 *  - All outbound fetches go through safeFetch (SSRF-guarded: http(s) only,
 *    private/loopback IPs rejected, redirects re-validated, timeout, byte caps).
 *  - Responses (favicon/thumbnail) are returned inline as `data:` URLs so the
 *    browser renders them under the strict `img-src 'self' data:` CSP without a
 *    third-party request — matching how OpenAI is proxied through the server.
 */
import express, { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { getCurrentUser } from "../auth/session.ts";
import { extractMetadata, readCapped, safeFetch } from "./fetchMeta.ts";

export const linksRouter = Router();

export interface CitationMeta {
  url: string;
  host: string;
  siteName: string;
  title: string;
  description: string;
  faviconDataUrl: string | null;
  imageUrl: string | null;
  publishedDate: string | null;
}

/* ------------------------------ validation ----------------------------- */

const urlSchema = z.object({ url: z.string().url().max(2048) });
const jsonBody = express.json({ limit: "8kb" });

const HTML_CAP = 1_500_000; // 1.5 MB of HTML is plenty for <head>.
const FAVICON_CAP = 96_000; // ~94 KB inlined favicon.
const IMAGE_CAP = 3_000_000; // 3 MB thumbnail ceiling.

const linksLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many link requests. Please slow down." },
});

/* -------------------------------- caching ------------------------------ */

const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_ENTRIES = 500;
const metaCache = new Map<string, { value: CitationMeta; expires: number }>();
const imageCache = new Map<string, { value: string | null; expires: number }>();

function cacheGet<T>(cache: Map<string, { value: T; expires: number }>, key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires < nowMs()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet<T>(cache: Map<string, { value: T; expires: number }>, key: string, value: T): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expires: nowMs() + TTL_MS });
}

// Wrapped so the rest of the file stays free of the lint rule against Date.now
// in workflow scripts; here in server code it's fine.
function nowMs(): number {
  return Date.now();
}

/* ------------------------------- helpers ------------------------------- */

function requireUserId(req: Request, res: Response): string | null {
  const user = getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return user.id;
}

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err: unknown) => {
      console.error("Links route error:", err);
      if (!res.headersSent) res.status(502).json({ error: "Could not fetch that link." });
    });
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Fetch an image through safeFetch and return it as a size-capped data URL. */
async function fetchImageDataUrl(url: string, cap: number): Promise<string | null> {
  try {
    const { response } = await safeFetch(url, { accept: "image/*", timeoutMs: 6000 });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!type.startsWith("image/")) return null;
    const buf = await readCapped(response, cap, false);
    if (buf.length === 0) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/* -------------------------------- routes ------------------------------- */

// Unfurl a URL into citation metadata (site name, title, description, favicon).
linksRouter.post(
  "/metadata",
  linksLimiter,
  jsonBody,
  handle(async (req, res) => {
    if (!requireUserId(req, res)) return;
    const parsed = urlSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid URL" });
      return;
    }
    const url = parsed.data.url;

    const cached = cacheGet(metaCache, url);
    if (cached) {
      res.json(cached);
      return;
    }

    let meta: CitationMeta;
    try {
      const { response, finalUrl } = await safeFetch(url, { accept: "text/html,*/*", timeoutMs: 6000 });
      if (!response.ok) {
        meta = fallbackMeta(url);
      } else {
        const html = (await readCapped(response, HTML_CAP, true)).toString("utf8");
        const extracted = extractMetadata(html, finalUrl);
        const faviconDataUrl = extracted.faviconUrl
          ? await fetchImageDataUrl(extracted.faviconUrl, FAVICON_CAP)
          : null;
        meta = {
          url,
          host: hostOf(url),
          siteName: extracted.siteName || hostOf(url),
          title: extracted.title || hostOf(url),
          description: extracted.description,
          faviconDataUrl,
          imageUrl: extracted.imageUrl,
          publishedDate: extracted.publishedDate,
        };
      }
    } catch {
      // Unreachable host, blocked address, timeout, etc. — degrade gracefully so
      // the chip still works from the URL alone.
      meta = fallbackMeta(url);
    }

    cacheSet(metaCache, url, meta);
    res.json(meta);
  }),
);

// Fetch a citation's main thumbnail as a data URL (lazy — only on hover).
linksRouter.post(
  "/image",
  linksLimiter,
  jsonBody,
  handle(async (req, res) => {
    if (!requireUserId(req, res)) return;
    const parsed = urlSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid URL" });
      return;
    }
    const url = parsed.data.url;
    const cached = cacheGet(imageCache, url);
    if (cached !== undefined) {
      res.json({ dataUrl: cached });
      return;
    }
    const dataUrl = await fetchImageDataUrl(url, IMAGE_CAP);
    cacheSet(imageCache, url, dataUrl);
    res.json({ dataUrl });
  }),
);

function fallbackMeta(url: string): CitationMeta {
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
}
