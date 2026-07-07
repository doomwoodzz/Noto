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
    // Task 2 populates the snapshot → append_note is now revertible.
    expect(append_.revertible).toBe(true);

    const remember_ = activity.find((a) => a.tool === "remember");
    expect(remember_.target.kind).toBe("memory");
    expect(remember_.target.text).toContain("Postgres");
    expect(remember_.revertible).toBe(true);
  });

  it("filters by tool", async () => {
    const { cookie, pat } = await setup("act-filter@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/act-filter.md", title: "A", content: "x" });
    const { fileId } = (await create.json()) as { fileId: string };
    await pat.req("POST", "/api/memory", { text: "fact one", scope: "proj" });
    // Scoped to this test's own file: every signup() in this file resolves to
    // the same shared local owner, so an unscoped ?tool=create_note would also
    // pick up create_note rows from earlier tests in this describe block.
    const res = await cookie.req("GET", `/api/activity?tool=create_note&fileId=${fileId}`);
    const { activity } = (await res.json()) as { activity: ActivityItem[] };
    expect(activity.length).toBe(1);
    expect(activity[0].tool).toBe("create_note");
  });

  it("excludes human (cookie) edits — they write no audit row", async () => {
    const { cookie } = await setup("act-human@example.com");
    const vaults = (await (await cookie.req("GET", "/api/vaults")).json()) as { vaults: { id: string }[] };
    const files = (await (await cookie.req("GET", `/api/vaults/${vaults.vaults[0].id}/files`)).json()) as { files: { id: string }[] };
    const targetFileId = files.files[0].id;
    await cookie.req("PATCH", `/api/files/${targetFileId}`, { content: "human edit" });
    // Scoped to the file the human just edited: with a shared owner, the
    // overall log already has rows from earlier tests, so the real assertion
    // — a human cookie edit writes no audit row — has to be scoped to this
    // one file rather than expecting a globally-empty log.
    const res = await cookie.req("GET", `/api/activity?fileId=${targetFileId}`);
    const { activity } = (await res.json()) as { activity: ActivityItem[] };
    expect(activity.length).toBe(0);
  });

  it("rejects PAT callers — the trust surface is human-only", async () => {
    const { pat } = await setup("act-pat@example.com");
    const res = await pat.req("GET", "/api/activity");
    expect(res.status).toBe(403);
  });
});

describe("GET /api/activity/:id/preview", () => {
  async function setup3(email: string) {
    const cookie = await signup(srv.baseURL, email);
    const token = await mintToken(cookie, ["read", "write", "memory"], "Claude Code");
    return { cookie, pat: makePatClient(srv.baseURL, token) };
  }

  it("returns before (snapshot) + current for an append", async () => {
    const { cookie, pat } = await setup3("prev-append@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/p.md", title: "P", content: "start\n" });
    const { fileId } = (await create.json()) as { fileId: string };
    await pat.req("POST", `/api/files/${fileId}/append`, { text: "more" });
    const { activity } = (await (await cookie.req("GET", `/api/activity?fileId=${fileId}`)).json()) as { activity: Array<{ id: string; tool: string }> };
    const append_ = activity.find((a) => a.tool === "append_note")!;
    const res = await cookie.req("GET", `/api/activity/${append_.id}/preview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { before: string; current: string };
    expect(body.before).toBe("start\n");
    expect(body.current).toContain("more");
  });

});

describe("POST /api/activity/:id/revert — create_note", () => {
  async function setup4(email: string) {
    const cookie = await signup(srv.baseURL, email);
    const token = await mintToken(cookie, ["read", "write", "memory"], "Claude Code");
    return { cookie, pat: makePatClient(srv.baseURL, token), token };
  }

  it("deletes the AI-created note and records a revert row", async () => {
    const { cookie, pat } = await setup4("rev-create@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/del.md", title: "Del", content: "hi" });
    const { fileId } = (await create.json()) as { fileId: string };
    const { activity } = (await (await cookie.req("GET", `/api/activity?fileId=${fileId}`)).json()) as { activity: Array<{ id: string; tool: string; revertible: boolean }> };
    const row = activity.find((a) => a.tool === "create_note")!;

    const res = await cookie.req("POST", `/api/activity/${row.id}/revert`, {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("reverted");

    expect((await pat.req("GET", `/api/files/${fileId}`)).status).toBe(404);
    // Reverting deletes the file, so a target-scoped (fileId) refetch would now
    // 404 — the surviving rows still carry `target = fileId` in the DB, but the
    // route's `?fileId=` filter is for browsing an existing file's history, not
    // a deleted one. Fall back to the "revert" tool filter instead, which is
    // free of the same-millisecond tie risk since only one revert just happened.
    const after = (await (await cookie.req("GET", "/api/activity?tool=revert")).json()) as { activity: Array<{ tool: string; target: { id: string | null } }> };
    expect(after.activity.some((a) => a.target.id === fileId)).toBe(true);
    const afterCreate = (await (await cookie.req("GET", "/api/activity?tool=create_note")).json()) as { activity: Array<{ target: { id: string | null }; revertible: boolean }> };
    expect(afterCreate.activity.find((a) => a.target.id === fileId)!.revertible).toBe(false);
  });

  it("rejects a PAT caller with 403", async () => {
    const { cookie, pat } = await setup4("rev-pat@example.com");
    await pat.req("POST", "/api/notes", { path: "Memory/x.md", title: "X", content: "x" });
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: Array<{ id: string }> };
    const res = await pat.req("POST", `/api/activity/${activity[0].id}/revert`, {});
    expect(res.status).toBe(403);
  });

  it("409 conflict when the note changed since the AI created it; force deletes", async () => {
    const { cookie, pat } = await setup4("rev-conflict@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/rev-conflict.md", title: "C", content: "orig" });
    const { fileId } = (await create.json()) as { fileId: string };
    await cookie.req("PATCH", `/api/files/${fileId}`, { content: "human changed it" });
    const { activity } = (await (await cookie.req("GET", `/api/activity?fileId=${fileId}`)).json()) as { activity: Array<{ id: string; tool: string }> };
    const row = activity.find((a) => a.tool === "create_note")!;

    const conflict = await cookie.req("POST", `/api/activity/${row.id}/revert`, {});
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { status: string }).status).toBe("conflict");

    const forced = await cookie.req("POST", `/api/activity/${row.id}/revert`, { force: true });
    expect(forced.status).toBe(200);
    expect((await pat.req("GET", `/api/files/${fileId}`)).status).toBe(404);
  });
});

describe("revert note edits (snapshot restore)", () => {
  async function setup5(email: string) {
    const cookie = await signup(srv.baseURL, email);
    const token = await mintToken(cookie, ["read", "write", "memory"], "Claude Code");
    return { cookie, pat: makePatClient(srv.baseURL, token) };
  }

  it("restores the pre-image of an append", async () => {
    const { cookie, pat } = await setup5("rev-append@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/rev-append.md", title: "A", content: "original\n" });
    const { fileId } = (await create.json()) as { fileId: string };
    await pat.req("POST", `/api/files/${fileId}/append`, { text: "appended" });
    const { activity } = (await (await cookie.req("GET", `/api/activity?fileId=${fileId}`)).json()) as { activity: Array<{ id: string; tool: string }> };
    const row = activity.find((a) => a.tool === "append_note")!;

    const res = await cookie.req("POST", `/api/activity/${row.id}/revert`, {});
    expect(res.status).toBe(200);
    const file = (await (await pat.req("GET", `/api/files/${fileId}`)).json()) as { file: { content: string } };
    expect(file.file.content).toBe("original\n");
  });

  it("restores the pre-image of an update_section", async () => {
    const { cookie, pat } = await setup5("rev-section@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/s.md", title: "S", content: "# A\nold body\n" });
    const { fileId } = (await create.json()) as { fileId: string };
    await pat.req("PATCH", `/api/files/${fileId}/section`, { heading: "A", content: "# A\nnew body\n" });
    const { activity } = (await (await cookie.req("GET", `/api/activity?fileId=${fileId}`)).json()) as { activity: Array<{ id: string; tool: string }> };
    const row = activity.find((a) => a.tool === "update_section")!;

    await cookie.req("POST", `/api/activity/${row.id}/revert`, {});
    const file = (await (await pat.req("GET", `/api/files/${fileId}`)).json()) as { file: { content: string } };
    expect(file.file.content).toBe("# A\nold body\n");
  });

  it("409 conflict when the note changed since the AI edit; force overwrites", async () => {
    const { cookie, pat } = await setup5("rev-append-conflict@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/ac.md", title: "AC", content: "base\n" });
    const { fileId } = (await create.json()) as { fileId: string };
    await pat.req("POST", `/api/files/${fileId}/append`, { text: "ai" });
    await cookie.req("PATCH", `/api/files/${fileId}`, { content: "human took over" });
    const { activity } = (await (await cookie.req("GET", `/api/activity?fileId=${fileId}`)).json()) as { activity: Array<{ id: string; tool: string }> };
    const row = activity.find((a) => a.tool === "append_note")!;

    expect((await cookie.req("POST", `/api/activity/${row.id}/revert`, {})).status).toBe(409);
    expect((await cookie.req("POST", `/api/activity/${row.id}/revert`, { force: true })).status).toBe(200);
    const file = (await (await pat.req("GET", `/api/files/${fileId}`)).json()) as { file: { content: string } };
    expect(file.file.content).toBe("base\n");
  });
});

describe("provenance population", () => {
  async function setup2(email: string, tokenName = "Claude Code") {
    const cookie = await signup(srv.baseURL, email);
    const token = await mintToken(cookie, ["read", "write", "memory"], tokenName);
    return { cookie, pat: makePatClient(srv.baseURL, token) };
  }

  it("stamps source_client and makes appends revertible via a snapshot", async () => {
    const { cookie, pat } = await setup2("act-prov@example.com");
    const create = await pat.req("POST", "/api/notes", { path: "Memory/act-prov.md", title: "Log", content: "# Log\n" });
    const { fileId } = (await create.json()) as { fileId: string };
    await pat.req("POST", `/api/files/${fileId}/append`, { text: "line" });
    await pat.req("POST", "/api/memory", { text: "uses redis", scope: "p" });

    // Scoped to this test's own file: with a shared owner, an unscoped GET
    // would also return earlier tests' rows (some stamped with other client
    // names, e.g. the "cursor" test below), so the "every row is claude-code"
    // check has to be limited to the rows this test itself just created.
    const { activity } = (await (await cookie.req("GET", `/api/activity?fileId=${fileId}`)).json()) as {
      activity: Array<{ client: string | null; tool: string; hasSnapshot: boolean; revertible: boolean }>;
    };
    for (const a of activity) expect(a.client).toBe("claude-code");
    const append_ = activity.find((a) => a.tool === "append_note")!;
    expect(append_.hasSnapshot).toBe(true);
    expect(append_.revertible).toBe(true);
  });

  it("honours the X-Noto-Client header for the source filter", async () => {
    const { cookie, pat } = await setup2("act-cursor@example.com");
    await pat.req("POST", "/api/notes", { path: "Memory/act-cursor.md", title: "C", content: "x" }, { "X-Noto-Client": "cursor" });
    const { activity } = (await (await cookie.req("GET", "/api/activity?source=cursor")).json()) as {
      activity: Array<{ client: string | null }>;
    };
    expect(activity.length).toBe(1);
    expect(activity[0].client).toBe("cursor");
  });
});

describe("revert memory", () => {
  async function setup6(email: string) {
    const cookie = await signup(srv.baseURL, email);
    const token = await mintToken(cookie, ["read", "write", "memory"], "Claude Code");
    return { cookie, pat: makePatClient(srv.baseURL, token) };
  }

  it("undo of remember retires the memory (gone from recall)", async () => {
    const { cookie, pat } = await setup6("rev-remember@example.com");
    await pat.req("POST", "/api/memory", { text: "ephemeral fact", scope: "p" });
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: Array<{ id: string; tool: string }> };
    const row = activity.find((a) => a.tool === "remember")!;

    expect((await cookie.req("POST", `/api/activity/${row.id}/revert`, {})).status).toBe(200);
    const recall = (await (await pat.req("GET", "/api/memory?q=ephemeral&scope=p")).json()) as { memories: Array<{ text: string }> };
    expect(recall.memories.length).toBe(0);
  });

  it("undo of a supersede reactivates the old memory and retires the new", async () => {
    const { cookie, pat } = await setup6("rev-supersede@example.com");
    const first = await pat.req("POST", "/api/memory", { text: "we use mysql", scope: "p" });
    const { memoryId: oldId } = (await first.json()) as { memoryId: string };
    await pat.req("POST", "/api/memory", { text: "we use postgres now", scope: "p", supersedes: oldId });
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: Array<{ id: string; tool: string }> };
    const row = activity.find((a) => a.tool === "supersede")!;

    expect((await cookie.req("POST", `/api/activity/${row.id}/revert`, {})).status).toBe(200);
    const recall = (await (await pat.req("GET", "/api/memory?q=mysql&scope=p")).json()) as { memories: Array<{ text: string }> };
    expect(recall.memories.some((m) => m.text === "we use mysql")).toBe(true);
    const recall2 = (await (await pat.req("GET", "/api/memory?q=postgres&scope=p")).json()) as { memories: Array<{ text: string }> };
    expect(recall2.memories.some((m) => m.text === "we use postgres now")).toBe(false);
  });

  it("422 when the memory write was already undone", async () => {
    const { cookie, pat } = await setup6("rev-twice@example.com");
    await pat.req("POST", "/api/memory", { text: "one time", scope: "p" });
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: Array<{ id: string; tool: string }> };
    const row = activity.find((a) => a.tool === "remember")!;
    await cookie.req("POST", `/api/activity/${row.id}/revert`, {});
    expect((await cookie.req("POST", `/api/activity/${row.id}/revert`, {})).status).toBe(422);
  });

  it("refuses to revert a deduped supersede (no predecessor; would delete a pre-existing fact)", async () => {
    const { cookie, pat } = await setup6("rev-dedup-supersede@example.com");
    await pat.req("POST", "/api/memory", { text: "we use postgres", scope: "p" });          // Y (active)
    const first = await pat.req("POST", "/api/memory", { text: "we use mysql", scope: "p" }); // X (active)
    const { memoryId: xId } = (await first.json()) as { memoryId: string };
    // Supersede X with text that normalizes to the already-active Y → dedups to Y (supersedes_id null).
    await pat.req("POST", "/api/memory", { text: "we use postgres", scope: "p", supersedes: xId });
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: Array<{ id: string; tool: string }> };
    const row = activity.find((a) => a.tool === "supersede")!;

    expect((await cookie.req("POST", `/api/activity/${row.id}/revert`, {})).status).toBe(422);
    // Y must still be recallable — the revert must NOT have retired a pre-existing fact.
    const recall = (await (await pat.req("GET", "/api/memory?q=postgres&scope=p")).json()) as { memories: Array<{ text: string }> };
    expect(recall.memories.some((m) => m.text === "we use postgres")).toBe(true);
  });

  it("refuses (no 500) when the predecessor's slot was re-occupied after the supersede", async () => {
    const { cookie, pat } = await setup6("rev-collision@example.com");
    const first = await pat.req("POST", "/api/memory", { text: "we use mysql", scope: "p" });    // M1 active
    const { memoryId: m1 } = (await first.json()) as { memoryId: string };
    await pat.req("POST", "/api/memory", { text: "we use postgres", scope: "p", supersedes: m1 }); // M2 active, M1 superseded
    await pat.req("POST", "/api/memory", { text: "we use mysql", scope: "p" });                    // M3 active, same norm as M1
    const { activity } = (await (await cookie.req("GET", "/api/activity")).json()) as { activity: Array<{ id: string; tool: string }> };
    const row = activity.find((a) => a.tool === "supersede")!;

    const res = await cookie.req("POST", `/api/activity/${row.id}/revert`, {});
    expect(res.status).toBe(422); // graceful refusal, NOT a 500

    // Nothing was half-applied: the correction ("postgres") and the re-remembered fact ("mysql") both stay active.
    const pg = (await (await pat.req("GET", "/api/memory?q=postgres&scope=p")).json()) as { memories: Array<{ text: string }> };
    expect(pg.memories.some((m) => m.text === "we use postgres")).toBe(true);
    const my = (await (await pat.req("GET", "/api/memory?q=mysql&scope=p")).json()) as { memories: Array<{ text: string }> };
    expect(my.memories.some((m) => m.text === "we use mysql")).toBe(true);
  });

  it("a duplicate remember creates no separate revertible row (dedup bump is not a write)", async () => {
    const { cookie, pat } = await setup6("dup-remember@example.com");
    // Tagged with a distinguishing X-Noto-Client so the ?source= filter below
    // can isolate this test's own remember calls from the many other "remember"
    // rows earlier tests in this describe block already left on the shared
    // owner's activity log (there is no memory-id filter on GET /api/activity,
    // unlike the fileId filter used for note-target tests elsewhere in this file).
    const src = { "X-Noto-Client": "dup-remember-test" };
    await pat.req("POST", "/api/memory", { text: "we use sqlite", scope: "p" }, src);        // genuine create
    const dup = await pat.req("POST", "/api/memory", { text: "we use sqlite", scope: "p" }, src); // dedup bump
    expect(((await dup.json()) as { deduped: boolean }).deduped).toBe(true);
    const { activity } = (await (await cookie.req("GET", "/api/activity?source=dup-remember-test")).json()) as { activity: Array<{ tool: string }> };
    expect(activity.filter((a) => a.tool === "remember").length).toBe(1); // only the create, not the bump
  });
});
