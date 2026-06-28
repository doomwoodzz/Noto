import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, signup, mintToken, makePatClient, type TestServer } from "../test-helpers.ts";

interface ActivityItem {
  id: string;
  tool: string;
  createdAt: number;
  client: string | null;
  device: string | null;
  target: { kind: string; id: string | null; title: string | null; path: string | null; text: string | null; status: string | null; exists: boolean };
  revertible: boolean;
  hasSnapshot: boolean;
}

let srv: TestServer;
beforeAll(async () => { srv = await startTestServer(); });
afterAll(() => srv.close());

async function setup(email: string, tokenName = "Claude Code") {
  const cookie = await signup(srv.baseURL, email);
  const token = await mintToken(cookie, ["read", "write", "memory"], tokenName);
  const pat = makePatClient(srv.baseURL, token);
  return { cookie, pat };
}

describe("GET /api/activity (browse)", () => {
  it("lists AI writes enriched with tool/target/device and revertible flags", async () => {
    const { cookie, pat } = await setup("act-list@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/log.md", title: "Log", content: "# Log\n" });
    expect(create.status).toBe(201);
    const { fileId } = (await create.json()) as { fileId: string };
    await pat.req("POST", `/api/files/${fileId}/append`, { text: "first line" });
    await pat.req("POST", "/api/memory", { text: "We use Postgres", scope: "proj" });

    const res = await cookie.req("GET", "/api/activity");
    expect(res.status).toBe(200);
    const { activity } = (await res.json()) as { activity: ActivityItem[] };
    expect(activity.length).toBe(3);

    const create_ = activity.find((a) => a.tool === "create_note");
    expect(create_.device).toBe("Claude Code");
    expect(create_.target.kind).toBe("note");
    expect(create_.target.title).toBe("Log");
    expect(create_.target.exists).toBe(true);
    expect(create_.revertible).toBe(true);

    const append_ = activity.find((a) => a.tool === "append_note");
    // No snapshot populated yet (Task 2 adds it) → not revertible until then.
    expect(append_.revertible).toBe(false);

    const remember_ = activity.find((a) => a.tool === "remember");
    expect(remember_.target.kind).toBe("memory");
    expect(remember_.target.text).toContain("Postgres");
    expect(remember_.revertible).toBe(true);
  });

  it("filters by tool", async () => {
    const { cookie, pat } = await setup("act-filter@example.com");
    await pat.req("POST", "/api/notes", { path: "Memory/a.md", title: "A", content: "x" });
    await pat.req("POST", "/api/memory", { text: "fact one", scope: "proj" });
    const res = await cookie.req("GET", "/api/activity?tool=create_note");
    const { activity } = (await res.json()) as { activity: ActivityItem[] };
    expect(activity.length).toBe(1);
    expect(activity[0].tool).toBe("create_note");
  });

  it("excludes human (cookie) edits — they write no audit row", async () => {
    const { cookie } = await setup("act-human@example.com");
    const vaults = (await (await cookie.req("GET", "/api/vaults")).json()) as { vaults: { id: string }[] };
    const files = (await (await cookie.req("GET", `/api/vaults/${vaults.vaults[0].id}/files`)).json()) as { files: { id: string }[] };
    await cookie.req("PATCH", `/api/files/${files.files[0].id}`, { content: "human edit" });
    const res = await cookie.req("GET", "/api/activity");
    const { activity } = (await res.json()) as { activity: ActivityItem[] };
    expect(activity.length).toBe(0);
  });

  it("isolates users (A cannot see B's activity)", async () => {
    const a = await setup("act-iso-a@example.com");
    const b = await setup("act-iso-b@example.com");
    await a.pat.req("POST", "/api/notes", { path: "Memory/a.md", title: "A", content: "x" });
    const res = await b.cookie.req("GET", "/api/activity");
    expect(((await res.json()) as { activity: ActivityItem[] }).activity.length).toBe(0);
  });

  it("rejects PAT callers — the trust surface is human-only", async () => {
    const { pat } = await setup("act-pat@example.com");
    const res = await pat.req("GET", "/api/activity");
    expect(res.status).toBe(403);
  });
});
