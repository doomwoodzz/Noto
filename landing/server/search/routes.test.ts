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
  // Path must be unique per call: every signup() in this file now resolves to
  // the same shared local owner's one default vault (see ensureLocalOwner in
  // db.ts), so a fixed "Bio/Cells.md" would silently 409 (duplicate path) on
  // the second call — the response status wasn't checked, so this collision
  // was previously invisible. Derive uniqueness from the email each call
  // already passes in, which is distinct per test.
  const slug = email.split("@")[0];
  const create = await cookie.req("POST", `/api/vaults/${vaultId}/files`, {
    path: `Bio/Cells-${slug}.md`, title: "Cells",
    content: "# Cells\n\n## Mitochondria\n\nThe mitochondria makes ATP.\n\n## Nucleus\n\nHolds DNA.",
  });
  if (create.status !== 201) throw new Error(`seed file create failed: ${create.status}`);
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
