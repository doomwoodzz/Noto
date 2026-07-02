/**
 * Link-metadata extraction for inline citations.
 *
 * `safeFetch` is an SSRF-guarded fetch: it only allows http(s), resolves the
 * hostname and rejects private / loopback / link-local addresses, follows a
 * bounded number of redirects (re-validating each hop so a redirect can't
 * bypass the IP check), times out, and caps the bytes it reads. `extractMetadata`
 * is a pure regex scan of a page's `<head>` for Open Graph / Twitter / standard
 * meta tags plus the favicon and published date — no DOM dependency, so it is
 * trivially unit-testable.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface ExtractedMeta {
  siteName: string;
  title: string;
  description: string;
  imageUrl: string | null;
  faviconUrl: string | null;
  publishedDate: string | null;
}

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/* ------------------------------ SSRF guard ----------------------------- */

/** True for IPs we must never fetch from (loopback, private, link-local…). */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip.toLowerCase());
  return true; // not a recognizable IP → refuse
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map((n) => parseInt(n, 10));
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true; // this-net, private, loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 (IETF) + 192.0.2 docs
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  if (ip === "::1" || ip === "::") return true;
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateV4(mapped[1]);
  const head = ip.split(":")[0] ?? "";
  if (head.startsWith("fe8") || head.startsWith("fe9") || head.startsWith("fea") || head.startsWith("feb"))
    return true; // fe80::/10 link-local
  if (head.startsWith("fc") || head.startsWith("fd")) return true; // fc00::/7 ULA
  return false;
}

/** SSRF guard: reject a hostname that resolves to a private/loopback/link-local IP.
 *  Shared by safeFetch and the connector clients (GitHub/Notion). */
export async function assertPublicHost(hostname: string): Promise<void> {
  // Literal IPs are validated directly; hostnames are resolved first.
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("Refusing to fetch a private address");
    return;
  }
  const addrs = await lookup(hostname, { all: true });
  if (addrs.length === 0) throw new Error("Host did not resolve");
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error("Refusing to fetch a private address");
  }
}

export interface SafeFetchOptions {
  accept: string;
  timeoutMs?: number;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  response: Response;
  finalUrl: string;
}

/** Fetch with SSRF guards, manual redirect re-validation, and a timeout. */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const maxRedirects = opts.maxRedirects ?? 3;

  let current = parseHttpUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; ; hop++) {
      await assertPublicHost(current.hostname);
      const response = await fetch(current.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": DESKTOP_UA, Accept: opts.accept },
      });
      const status = response.status;
      const location = response.headers.get("location");
      if (status >= 300 && status < 400 && location) {
        if (hop >= maxRedirects) throw new Error("Too many redirects");
        await response.body?.cancel().catch(() => {});
        current = parseHttpUrl(new URL(location, current).href);
        continue;
      }
      return { response, finalUrl: current.href };
    }
  } finally {
    clearTimeout(timer);
  }
}

function parseHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Unsupported protocol");
  return u;
}

/** Read a response body, stopping once `maxBytes` is reached. */
export async function readCapped(
  response: Response,
  maxBytes: number,
  truncate = true,
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      if (truncate) {
        chunks.push(Buffer.from(value));
        break;
      }
      throw new Error("Response too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/* --------------------------- metadata parsing -------------------------- */

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .trim();
}

function safeCodePoint(n: number): string {
  try {
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

/** Read an attribute's value from a single tag string (quote-agnostic). */
function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? "");
}

function absolutize(href: string | null, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/** Extract citation metadata from a page's HTML. Pure and dependency-free. */
export function extractMetadata(html: string, baseUrl: string): ExtractedMeta {
  // Limit work to the head where meta tags live (fall back to the whole doc).
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd === -1 ? html : html.slice(0, headEnd);

  const metas = head.match(/<meta\b[^>]*>/gi) ?? [];
  const byKey = new Map<string, string>();
  for (const tag of metas) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop"))?.toLowerCase();
    const content = attr(tag, "content");
    if (key && content && !byKey.has(key)) byKey.set(key, content);
  }
  const meta = (k: string) => byKey.get(k) ?? null;

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const pageTitle = titleTag ? decodeEntities(titleTag[1]) : null;

  const host = safeHost(baseUrl);
  const ogTitle = meta("og:title") ?? meta("twitter:title");
  const title = firstNonEmpty(ogTitle, pageTitle, host);
  const siteName = firstNonEmpty(meta("og:site_name"), meta("application-name"), ogTitle, pageTitle, host);
  const description = firstNonEmpty(
    meta("og:description"),
    meta("twitter:description"),
    meta("description"),
    "",
  );

  const imageUrl = absolutize(
    meta("og:image") ?? meta("og:image:url") ?? meta("twitter:image") ?? meta("twitter:image:src"),
    baseUrl,
  );

  const publishedDate = firstNonEmpty(
    meta("article:published_time"),
    meta("article:modified_time"),
    meta("og:updated_time"),
    meta("date"),
    meta("datepublished"),
    jsonLdDate(head),
    "",
  ) || null;

  return {
    siteName,
    title,
    description,
    imageUrl,
    faviconUrl: resolveFavicon(head, baseUrl),
    publishedDate,
  };
}

function resolveFavicon(head: string, baseUrl: string): string | null {
  const links = head.match(/<link\b[^>]*>/gi) ?? [];
  const icons: { href: string; weight: number }[] = [];
  for (const tag of links) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    if (!/\bicon\b/.test(rel)) continue;
    const href = absolutize(attr(tag, "href"), baseUrl);
    if (!href) continue;
    // Prefer apple-touch-icon (crisp) > icon > shortcut icon.
    const weight = rel.includes("apple-touch") ? 3 : rel === "icon" ? 2 : 1;
    icons.push({ href, weight });
  }
  icons.sort((a, b) => b.weight - a.weight);
  if (icons.length > 0) return icons[0].href;
  // Fallback: the conventional /favicon.ico at the origin.
  try {
    return new URL("/favicon.ico", baseUrl).href;
  } catch {
    return null;
  }
}

function jsonLdDate(head: string): string | null {
  const m = /"datePublished"\s*:\s*"([^"]+)"/i.exec(head);
  return m ? m[1] : null;
}

function firstNonEmpty(...vals: (string | null | undefined)[]): string {
  for (const v of vals) {
    if (v && v.trim()) return v.trim();
  }
  return "";
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
