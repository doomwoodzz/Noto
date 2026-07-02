import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";
import { setEmbedder, realEmbedder } from "./embedder.ts";

let s: TestServer;
beforeAll(async () => { s = await startTestServer(); });
afterAll(() => s.close());

beforeEach(() => setEmbedder({ ready: () => false, embed: async (texts) => texts.map(() => new Float32Array(384)) }));
afterEach(() => setEmbedder(realEmbedder));

async function seed(email: string) {
  const cookie = await signup(s.baseURL, email);
  const { vaults } = await (await cookie.req("GET", "/api/vaults")).json();
  const vaultId = vaults[0].id;
  await cookie.req("POST", `/api/vaults/${vaultId}/files`, {
    path: "Bio/Cells.md", title: "Cells",
    content: "# Cells\n\n## Mitochondria\n\nThe mitochondria makes ATP.\n\n## Nucleus\n\nHolds DNA.",
  });
  const token = await mintToken(cookie, ["read"], "r");
  return makePatClient(s.baseURL, token);
}

describe("GET /api/search", () => {
  it("finds a note by content and returns heading-addressable refs", async () => {
    const pat = await seed("search-a@example.com");
    const res = await pat.req("GET", "/api/search?q=ATP&limit=5");
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: { title: string; headingPath: string[]; snippet: string }[] };
    expect(results[0].title).toBe("Cells");
    expect(results[0].headingPath).toEqual(["Cells", "Mitochondria"]);
    expect(results[0].snippet).toContain("ATP");
  });

  it("does not return another user's notes", async () => {
    await seed("search-owner@example.com");
    const other = await signup(s.baseURL, "search-other@example.com");
    const pat = makePatClient(s.baseURL, await mintToken(other, ["read"], "r"));
    const { results } = (await (await pat.req("GET", "/api/search?q=ATP")).json()) as { results: unknown[] };
    expect(results).toHaveLength(0);
  });
});

describe("GET /api/search — untrusted tagging (§10.3 L2)", () => {
  it("tags a Dump/ result as untrusted and leaves a normal note alone", async () => {
    const cookie = await signup(s.baseURL, "search-untrusted@example.com");
    const { vaults } = await (await cookie.req("GET", "/api/vaults")).json();
    const vaultId = vaults[0].id;
    await cookie.req("POST", `/api/vaults/${vaultId}/files`, {
      path: "Dump/acme/X.md", title: "Dumped Photosynthesis",
      content: "# Dumped\n\nPhotosynthesis converts sunlight into glucose.",
    });
    await cookie.req("POST", `/api/vaults/${vaultId}/files`, {
      path: "Notes/Y.md", title: "Notes Photosynthesis",
      content: "# Notes\n\nPhotosynthesis converts sunlight into glucose.",
    });
    const pat = makePatClient(s.baseURL, await mintToken(cookie, ["read"], "r"));
    const { results } = (await (await pat.req("GET", "/api/search?q=Photosynthesis&limit=10")).json()) as {
      results: { path: string; untrusted?: boolean; untrustedNote?: string }[];
    };
    const dumped = results.find((r) => r.path === "Dump/acme/X.md");
    const normal = results.find((r) => r.path === "Notes/Y.md");
    expect(dumped?.untrusted).toBe(true);
    expect(dumped?.untrustedNote).toMatch(/untrusted/i);
    expect(normal?.untrusted).toBeUndefined();
  });
});

describe("GET /api/notes", () => {
  it("lists recent notes as refs (no bodies)", async () => {
    const pat = await seed("notes-list@example.com");
    const res = await pat.req("GET", "/api/notes?by=recent&limit=20");
    expect(res.status).toBe(200);
    const { notes } = (await res.json()) as { notes: { title: string; path: string; content?: string }[] };
    expect(notes.some((n) => n.title === "Cells")).toBe(true);
    expect(notes[0]).not.toHaveProperty("content");
  });
});
