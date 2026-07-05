import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";

let s: TestServer;
beforeAll(async () => { s = await startTestServer(); });
afterAll(() => s.close());

async function writer(email: string, scopes: string[] = ["read", "write"]) {
  const cookie = await signup(s.baseURL, email);
  return { cookie, pat: makePatClient(s.baseURL, await mintToken(cookie, scopes, "w")) };
}

describe("POST /api/notes (create in default vault)", () => {
  it("creates a Memory/ note via a write PAT and returns its id", async () => {
    const { pat } = await writer("create-mem@example.com");
    const res = await pat.req("POST", "/api/notes", { path: "Memory/decisions.md", title: "Decisions", content: "# Decisions\n" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { fileId: string; path: string };
    expect(body.fileId).toBeTruthy();
    expect(body.path).toBe("Memory/decisions.md");
  });

  it("rejects a create OUTSIDE Memory/ from a PAT with 403 (confinement)", async () => {
    const { pat } = await writer("create-outside@example.com");
    const res = await pat.req("POST", "/api/notes", { path: "Notes/secret.md", title: "x", content: "" });
    expect(res.status).toBe(403);
  });

  it("rejects create from a read/memory-only token with 403 (scope)", async () => {
    const { pat } = await writer("create-noscope@example.com", ["read", "memory"]);
    const res = await pat.req("POST", "/api/notes", { path: "Memory/x.md", title: "x", content: "" });
    expect(res.status).toBe(403);
  });

  it("allows a cookie session to create OUTSIDE Memory/ (unconfined)", async () => {
    const { cookie } = await writer("create-cookie@example.com");
    const res = await cookie.req("POST", "/api/notes", { path: "Notes/cookie.md", title: "C", content: "" });
    expect(res.status).toBe(201);
  });

  it("409s on a duplicate path", async () => {
    const { pat } = await writer("create-dup@example.com");
    await pat.req("POST", "/api/notes", { path: "Memory/a.md", title: "A", content: "" });
    const res = await pat.req("POST", "/api/notes", { path: "Memory/a.md", title: "A", content: "" });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/files/:id/append", () => {
  async function memNote(pat: ReturnType<typeof makePatClient>, path: string, content: string) {
    const r = await pat.req("POST", "/api/notes", { path, title: "T", content });
    return ((await r.json()) as { fileId: string }).fileId;
  }

  it("appends to the end of a Memory/ note", async () => {
    const { pat } = await writer("append-end@example.com");
    const id = await memNote(pat, "Memory/log.md", "# Log\n\nfirst");
    const res = await pat.req("POST", `/api/files/${id}/append`, { text: "second" });
    expect(res.status).toBe(200);
    const note = (await (await pat.req("GET", `/api/files/${id}`)).json()) as { file: { content: string } };
    expect(note.file.content).toContain("first");
    expect(note.file.content).toContain("second");
  });

  it("appends under a heading", async () => {
    const { pat } = await writer("append-head@example.com");
    const id = await memNote(pat, "Memory/h.md", "# Root\n\n## Log\n\n- one\n\n## Other\n\ntail");
    const res = await pat.req("POST", `/api/files/${id}/append`, { text: "- two", underHeading: "Root/Log" });
    expect(res.status).toBe(200);
    const c = ((await (await pat.req("GET", `/api/files/${id}`)).json()) as { file: { content: string } }).file.content;
    expect(c.indexOf("- two")).toBeLessThan(c.indexOf("## Other"));
  });

  it("409s on a stale expectUpdatedAt", async () => {
    const { pat } = await writer("append-stale@example.com");
    const id = await memNote(pat, "Memory/s.md", "# S\n\nx");
    const res = await pat.req("POST", `/api/files/${id}/append`, { text: "y", expectUpdatedAt: 1 });
    expect(res.status).toBe(409);
  });

  it("404s appending under a missing heading", async () => {
    const { pat } = await writer("append-nohead@example.com");
    const id = await memNote(pat, "Memory/h2.md", "# Root\n\nbody");
    const res = await pat.req("POST", `/api/files/${id}/append`, { text: "x", underHeading: "Root/Nonexistent" });
    expect(res.status).toBe(404);
  });

  it("403s appending to a note OUTSIDE Memory/ via PAT", async () => {
    const { cookie, pat } = await writer("append-outside@example.com");
    // create a non-Memory note via the cookie session (unconfined)
    const { vaults } = await (await cookie.req("GET", "/api/vaults")).json();
    const made = await cookie.req("POST", `/api/vaults/${vaults[0].id}/files`, { path: "Notes/Plain.md", title: "P", content: "# P\n\nx" });
    const id = ((await made.json()) as { file: { id: string } }).file.id;
    const res = await pat.req("POST", `/api/files/${id}/append`, { text: "sneaky" });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/files/:id/section confinement", () => {
  it("403s a section edit on a non-Memory note via PAT, but allows it via cookie", async () => {
    const { cookie, pat } = await writer("section-confine@example.com");
    const { vaults } = await (await cookie.req("GET", "/api/vaults")).json();
    const made = await cookie.req("POST", `/api/vaults/${vaults[0].id}/files`, { path: "Notes/Doc.md", title: "Doc", content: "# Doc\n\n## A\n\nbody" });
    const id = ((await made.json()) as { file: { id: string } }).file.id;
    // PAT (write) blocked by confinement
    expect((await pat.req("PATCH", `/api/files/${id}/section`, { heading: "Doc/A", content: "## A\n\nedited" })).status).toBe(403);
    // cookie session is unconfined
    expect((await cookie.req("PATCH", `/api/files/${id}/section`, { heading: "Doc/A", content: "## A\n\nedited" })).status).toBe(200);
  });

  it("allows a section edit on a Memory/ note via PAT", async () => {
    const { pat } = await writer("section-mem@example.com");
    const made = await pat.req("POST", "/api/notes", { path: "Memory/m.md", title: "M", content: "# M\n\n## A\n\nbody" });
    const id = ((await made.json()) as { fileId: string }).fileId;
    expect((await pat.req("PATCH", `/api/files/${id}/section`, { heading: "M/A", content: "## A\n\nedited" })).status).toBe(200);
  });
});
