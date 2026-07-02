import { describe, it, expect } from "vitest";
import { env } from "../env.ts";
import { makeNotionClient } from "./notion.ts";

describe("notion env", () => {
  it("exposes a notionConfigured boolean (false under test — no creds)", () => {
    expect(typeof env.notionConfigured).toBe("boolean");
    expect(env.notionConfigured).toBe(false);
  });
});

describe("notion REST client", () => {
  function fakeFetch(routes: Record<string, unknown>) {
    return async (url: string, init?: RequestInit): Promise<Response> => {
      const key = `${init?.method ?? "GET"} ${new URL(url).pathname}`;
      const body = routes[key];
      if (body === undefined) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  }

  it("retrievePage hits the right URL and returns the page JSON", async () => {
    const client = makeNotionClient("ntn_secret", fakeFetch({
      "GET /v1/pages/p1": { id: "p1", last_edited_time: "2026-01-01T00:00:00.000Z" },
    }));
    const page = await client.retrievePage("p1");
    expect(page.id).toBe("p1");
  });

  it("search posts a query and returns results", async () => {
    const client = makeNotionClient("ntn_secret", fakeFetch({
      "POST /v1/search": { results: [{ id: "p1", object: "page" }], has_more: false },
    }));
    const out = await client.search();
    expect(out.results).toHaveLength(1);
  });

  it("blockChildren paginates via start_cursor", async () => {
    const client = makeNotionClient("ntn_secret", fakeFetch({
      "GET /v1/blocks/b1/children": { results: [{ id: "c1", type: "paragraph" }], has_more: true, next_cursor: "cur2" },
    }));
    const out = await client.blockChildren("b1");
    expect(out.results).toHaveLength(1);
    expect(out.next_cursor).toBe("cur2");
  });

  it("throws (redacted) on a non-2xx without leaking the token", async () => {
    const client = makeNotionClient("ntn_secret", async () => new Response("forbidden", { status: 403 }));
    await expect(client.retrievePage("p1")).rejects.toThrow(/Notion API error 403/);
    await expect(client.retrievePage("p1")).rejects.not.toThrow(/ntn_secret/);
  });
});
