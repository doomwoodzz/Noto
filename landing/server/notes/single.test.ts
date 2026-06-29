// server/notes/single.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";

let s: TestServer;
beforeAll(async () => { s = await startTestServer(); });
afterAll(() => s.close());

async function seed(email: string) {
  const cookie = await signup(s.baseURL, email);
  const { vaults } = await (await cookie.req("GET", "/api/vaults")).json();
  const vaultId = vaults[0].id;
  const created = await cookie.req("POST", `/api/vaults/${vaultId}/files`, {
    path: "Notes/Cells.md",
    title: "Cells",
    content: "# Cells\n\nIntro.\n\n## Mitochondria\n\nMakes ATP.\n\n## Nucleus\n\nHolds DNA.",
  });
  const { file } = await created.json();
  return { cookie, vaultId, file };
}

describe("GET /api/files/:fileId", () => {
  it("returns a single note by id via a read PAT", async () => {
    const { cookie, file } = await seed("single-read@example.com");
    const token = await mintToken(cookie, ["read"]);
    const pat = makePatClient(s.baseURL, token);

    const res = await pat.req("GET", `/api/files/${file.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.file.title).toBe("Cells");
    expect(body.file.content).toContain("Mitochondria");
  });

  it("404s for another user's note and 401s when unauthenticated", async () => {
    const { file } = await seed("single-owner@example.com");
    const other = await signup(s.baseURL, "single-other@example.com");
    const otherToken = await mintToken(other, ["read"]);
    expect((await makePatClient(s.baseURL, otherToken).req("GET", `/api/files/${file.id}`)).status).toBe(404);
    expect((await makePatClient(s.baseURL, "noto_pat_bad").req("GET", `/api/files/${file.id}`)).status).toBe(401);
  });
});

describe("GET /api/files/:fileId/section", () => {
  it("returns a single section by heading path", async () => {
    const { cookie, file } = await seed("section-read@example.com");
    const token = await mintToken(cookie, ["read"]);
    const pat = makePatClient(s.baseURL, token);

    const res = await pat.req("GET", `/api/files/${file.id}/section?heading=${encodeURIComponent("Cells/Mitochondria")}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toContain("Makes ATP.");
    expect(body.headingPath).toEqual(["Cells", "Mitochondria"]);
  });

  it("404s with an outline when the heading is missing", async () => {
    const { cookie, file } = await seed("section-miss@example.com");
    const token = await mintToken(cookie, ["read"]);
    const res = await makePatClient(s.baseURL, token).req(
      "GET",
      `/api/files/${file.id}/section?heading=${encodeURIComponent("Cells/Golgi")}`,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.headings).toContain("Cells/Mitochondria");
  });
});

describe("PATCH /api/files/:fileId/section", () => {
  it("updates only the targeted section, audits, and honors optimistic concurrency", async () => {
    const { cookie } = await seed("section-write@example.com");
    const token = await mintToken(cookie, ["read", "write"]);
    const pat = makePatClient(s.baseURL, token);

    // Create a Memory/ note via PAT so confinement is satisfied
    const created = await pat.req("POST", "/api/notes", {
      path: "Memory/Cells.md",
      title: "Cells",
      content: "# Cells\n\nIntro.\n\n## Mitochondria\n\nMakes ATP.\n\n## Nucleus\n\nHolds DNA.",
    });
    expect(created.status).toBe(201);
    const { fileId } = (await created.json()) as { fileId: string };
    const { file } = await (await pat.req("GET", `/api/files/${fileId}`)).json();

    const ok = await pat.req("PATCH", `/api/files/${fileId}/section`, {
      heading: "Cells/Nucleus",
      content: "## Nucleus\n\nHolds the genome.\n",
      expectUpdatedAt: file.updatedAt,
    });
    expect(ok.status).toBe(200);
    const after = await (await pat.req("GET", `/api/files/${fileId}`)).json();
    expect(after.file.content).toContain("Holds the genome.");
    expect(after.file.content).toContain("Makes ATP."); // sibling intact

    // Stale expectUpdatedAt → 409
    const stale = await pat.req("PATCH", `/api/files/${fileId}/section`, {
      heading: "Cells/Nucleus",
      content: "## Nucleus\n\nx\n",
      expectUpdatedAt: file.updatedAt, // now stale
    });
    expect(stale.status).toBe(409);
  });

  it("rejects section writes from a read-only token", async () => {
    const { cookie, file } = await seed("section-ro@example.com");
    const token = await mintToken(cookie, ["read"]);
    const res = await makePatClient(s.baseURL, token).req("PATCH", `/api/files/${file.id}/section`, {
      heading: "Cells/Nucleus",
      content: "## Nucleus\n\nx\n",
    });
    expect(res.status).toBe(403);
  });

  it("rejects section writes from a read+memory token (lacks write scope)", async () => {
    const { cookie, file } = await seed("section-memscope@example.com");
    const token = await mintToken(cookie, ["read", "memory"]);
    const res = await makePatClient(s.baseURL, token).req("PATCH", `/api/files/${file.id}/section`, {
      heading: "Cells/Nucleus",
      content: "## Nucleus\n\nx\n",
    });
    expect(res.status).toBe(403);
  });

  it("400s when ?heading= is omitted", async () => {
    const { cookie, file } = await seed("section-noq@example.com");
    const token = await mintToken(cookie, ["read"]);
    const res = await makePatClient(s.baseURL, token).req("GET", `/api/files/${file.id}/section`);
    expect(res.status).toBe(400);
  });

  it("409s on an ambiguous heading path (duplicate sibling headings)", async () => {
    const cookie = await signup(s.baseURL, "section-ambig@example.com");
    const { vaults } = await (await cookie.req("GET", "/api/vaults")).json();
    // Create under Memory/ so a PAT can reach the section (confinement)
    const created = await cookie.req("POST", `/api/vaults/${vaults[0].id}/files`, {
      path: "Memory/Dup.md", title: "Dup",
      content: "# Root\n\n## Notes\n\nFirst.\n\n## Notes\n\nSecond.\n",
    });
    const { file } = await created.json();
    const token = await mintToken(cookie, ["read", "write"]);
    const pat = makePatClient(s.baseURL, token);
    expect((await pat.req("GET", `/api/files/${file.id}/section?heading=${encodeURIComponent("Root/Notes")}`)).status).toBe(409);
    expect((await pat.req("PATCH", `/api/files/${file.id}/section`, { heading: "Root/Notes", content: "## Notes\n\nx\n" })).status).toBe(409);
  });
});
