import { describe, expect, it } from "vitest";
import type dns from "node:dns";
import { extractMetadata, guardedLookup, isPrivateIp } from "./fetchMeta.ts";

describe("extractMetadata", () => {
  it("pulls Open Graph metadata and resolves relative URLs", () => {
    const html = `
      <html><head>
        <title>SKYMAGIC | Breathtaking Drone Shows</title>
        <meta property="og:site_name" content="SKYMAGIC Drone Shows" />
        <meta property="og:title" content="SKYMAGIC — Drone Light Shows" />
        <meta property="og:description" content="The world&#39;s leading drone light show company." />
        <meta property="og:image" content="/images/hero.jpg" />
        <meta property="article:published_time" content="2026-05-21T15:06:51Z" />
        <link rel="apple-touch-icon" href="/touch-icon.png" />
        <link rel="icon" href="/favicon.ico" />
      </head><body>…</body></html>`;
    const m = extractMetadata(html, "https://skymagic.show/about");
    expect(m.siteName).toBe("SKYMAGIC Drone Shows");
    expect(m.title).toBe("SKYMAGIC — Drone Light Shows");
    expect(m.description).toBe("The world's leading drone light show company.");
    expect(m.imageUrl).toBe("https://skymagic.show/images/hero.jpg");
    expect(m.faviconUrl).toBe("https://skymagic.show/touch-icon.png"); // apple-touch wins
    expect(m.publishedDate).toBe("2026-05-21T15:06:51Z");
  });

  it("falls back to <title>, twitter tags, and meta description", () => {
    const html = `
      <head>
        <title>Plain Page</title>
        <meta name="description" content="A plain description.">
        <meta name="twitter:image" content="https://cdn.example.com/x.png">
      </head>`;
    const m = extractMetadata(html, "https://example.com/p");
    expect(m.siteName).toBe("Plain Page");
    expect(m.title).toBe("Plain Page");
    expect(m.description).toBe("A plain description.");
    expect(m.imageUrl).toBe("https://cdn.example.com/x.png");
  });

  it("falls back to host and the conventional favicon when nothing is present", () => {
    const m = extractMetadata("<head></head>", "https://news.ycombinator.com/item?id=1");
    expect(m.siteName).toBe("news.ycombinator.com");
    expect(m.title).toBe("news.ycombinator.com");
    expect(m.description).toBe("");
    expect(m.imageUrl).toBeNull();
    expect(m.faviconUrl).toBe("https://news.ycombinator.com/favicon.ico");
    expect(m.publishedDate).toBeNull();
  });

  it("reads JSON-LD datePublished when meta tags lack a date", () => {
    const html = `<head><script type="application/ld+json">
      {"@type":"Article","datePublished":"2025-01-02T00:00:00Z"}
    </script></head>`;
    expect(extractMetadata(html, "https://blog.example.com/post").publishedDate).toBe(
      "2025-01-02T00:00:00Z",
    );
  });
});

describe("isPrivateIp (SSRF guard)", () => {
  it("rejects loopback, private, and link-local ranges", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.9.9", "192.168.1.1", "169.254.1.1", "0.0.0.0", "::1"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "151.101.1.69"]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
  it("rejects IPv4-mapped IPv6 to a private address", () => {
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
  });
  it("rejects private IPv6 in non-canonical encodings (expanded / hex-mapped / compat)", () => {
    for (const ip of [
      "::ffff:7f00:1",             // hex IPv4-mapped loopback (127.0.0.1)
      "0:0:0:0:0:0:0:1",           // fully-expanded loopback
      "::127.0.0.1",               // deprecated IPv4-compatible loopback
      "::ffff:c0a8:1",             // hex IPv4-mapped 192.168.0.1
      "fe80:0:0:0:0:0:0:1",        // expanded link-local
      "fc00::1", "fd12:3456::1",   // unique-local
      "ff02::1",                   // multicast
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it("still allows public IPv6 (Cloudflare / Google DNS)", () => {
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe("guardedLookup (DNS-rebinding guard)", () => {
  const resolve = (hostname: string, options: dns.LookupOptions = {}) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: string | dns.LookupAddress[] }>(
      (done) => {
        guardedLookup(hostname, options, (err, address) => done({ err, address }));
      },
    );

  it("errors instead of yielding an address when the host resolves privately", async () => {
    // localhost resolves to loopback everywhere; the connector must never see it.
    const { err } = await resolve("localhost");
    expect(err).toBeTruthy();
    expect(err?.message).toMatch(/private address/);
  });

  it("errors for hosts that do not resolve", async () => {
    const { err } = await resolve("definitely-not-a-real-host.invalid");
    expect(err).toBeTruthy();
  });
});
