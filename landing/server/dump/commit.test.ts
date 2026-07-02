import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, signup } from "../test-helpers.ts";
import { drainOnce } from "./jobs.ts";
import { commitJob } from "./commit.ts";
import { __setEnrichComplete, __resetEnrichComplete } from "./enrich.ts";
import {
  db, createUser, createVault, createFile, getOwnedFile,
  createDumpJob, getOwnedDumpJob, setDumpJobStatus, insertDumpItem,
} from "../db.ts";
import type { ShapedNote } from "./types.ts";

// Deterministic, OFFLINE enrichment (a dev .env may set OPENAI_API_KEY). Returns
// candidate links so two-pass resolution yields a real ## Related [[link]] between
// sibling notes. title:"" → enrichNote falls back to the split heading; links are
// allow-listed to each note's candidate set, and shape stages siblings incrementally,
// so the 2nd note in a job links back to the 1st.
beforeAll(() => {
  __setEnrichComplete(async () => ({
    text: JSON.stringify({ title: "", summary: "Auto summary.", tags: ["svc"], links: ["Alpha Service", "Beta Service", "Uno", "Dos"] }),
    inputTokens: 0, outputTokens: 0,
  }));
});
afterAll(() => __resetEnrichComplete());

// splitIntoNotes only splits when there are >=2 top-level (#) headings AND the body is
// > 6000 chars, so build a large 2-section doc to get one note per section.
const FILLER = "lorem ipsum dolor sit amet consectetur ".repeat(180); // ~7k chars/section
function bigDoc(sections: { title: string; body: string }[]): string {
  return sections.map((s) => `# ${s.title}\n\n${s.body}`).join("\n\n");
}

type Client = Awaited<ReturnType<typeof signup>>;
async function poll(client: Client, jobId: string) {
  return (await (await client.req("GET", `/api/dump/jobs/${jobId}`)).json()) as {
    status: string; counts: Record<string, number>;
    manifest?: { itemId: string; title: string; notePath: string; status: string; dedupOf?: string }[];
  };
}
async function filesUnder(uid: string, prefix: string) {
  return db.prepare(
    "SELECT f.id, f.path, f.title, f.content FROM files f JOIN vaults v ON v.id=f.vault_id WHERE v.user_id=? AND f.path LIKE ? ORDER BY f.path",
  ).all(uid, prefix + "%") as { id: string; path: string; title: string; content: string }[];
}

describe("dump commit (raw, end-to-end)", () => {
  it("creates atomic notes under Dump/<slug>/, resolves a [[link]], builds a MOC, embeds + audits", async () => {
    const srv = await startTestServer();
    try {
      const email = `c-${crypto.randomUUID()}@t.local`;
      const client = await signup(srv.baseURL, email);
      const uid = (db.prepare("SELECT id FROM users WHERE email=?").get(email.toLowerCase()) as { id: string }).id;

      const text = bigDoc([
        { title: "Alpha Service", body: `Depends on the Beta Service. ${FILLER}` },
        { title: "Beta Service", body: `A durable queue. ${FILLER}` },
      ]);
      const create = await client.req("POST", "/api/dump", { source: { type: "raw", text } });
      expect(create.status).toBe(201);
      const { jobId } = (await create.json()) as { jobId: string };

      await drainOnce(); // shaping
      const review = await poll(client, jobId);
      expect(review.status).toBe("awaiting_review");
      expect(review.manifest!.length).toBe(2);
      expect(review.manifest!.map((m) => m.title).sort()).toEqual(["Alpha Service", "Beta Service"]);

      const commit = await client.req("POST", `/api/dump/jobs/${jobId}/commit`, { selectedItemIds: review.manifest!.map((m) => m.itemId) });
      expect(commit.status).toBe(202);

      await drainOnce(); // committing
      const done = await poll(client, jobId);
      expect(done.status).toBe("done");
      expect(done.counts.committed).toBe(2);

      const slug = (db.prepare("SELECT source_slug FROM dump_jobs WHERE id=?").get(jobId) as { source_slug: string }).source_slug;
      const all = await filesUnder(uid, `Dump/${slug}/`);
      const contentNotes = all.filter((f) => !f.path.endsWith(" — Index.md"));
      const moc = all.find((f) => f.path.endsWith(" — Index.md"));
      expect(contentNotes.length).toBe(2);
      expect(moc).toBeTruthy();
      expect(contentNotes.some((f) => /## Related\n- \[\[/.test(f.content))).toBe(true);
      for (const f of contentNotes) expect(moc!.content).toContain(`[[${f.title}]]`);
      for (const f of contentNotes) expect(f.content).toMatch(/<!-- noto:source .*untrusted=1.*-->/);
      for (const f of all) expect(db.prepare("SELECT 1 FROM dump_sources WHERE user_id=? AND file_id=?").get(uid, f.id)).toBeTruthy();
      const created = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE user_id=? AND tool='dump:create'").get(uid) as { n: number };
      expect(created.n).toBeGreaterThanOrEqual(3);
    } finally {
      srv.close();
    }
  }, 30000);

  it("raw re-dump of identical content is skipped (duplicate) — no new notes", async () => {
    const srv = await startTestServer();
    try {
      const email = `r-${crypto.randomUUID()}@t.local`;
      const client = await signup(srv.baseURL, email);
      const uid = (db.prepare("SELECT id FROM users WHERE email=?").get(email.toLowerCase()) as { id: string }).id;
      const text = bigDoc([
        { title: "Uno", body: `First section. ${FILLER}` },
        { title: "Dos", body: `Second section. ${FILLER}` },
      ]);

      const c1 = await client.req("POST", "/api/dump", { source: { type: "raw", text } });
      const { jobId: job1 } = (await c1.json()) as { jobId: string };
      await drainOnce();
      const r1 = await poll(client, job1);
      expect(r1.manifest!.length).toBe(2);
      await client.req("POST", `/api/dump/jobs/${job1}/commit`, { selectedItemIds: r1.manifest!.map((m) => m.itemId) });
      await drainOnce();
      const slug = (db.prepare("SELECT source_slug FROM dump_jobs WHERE id=?").get(job1) as { source_slug: string }).source_slug;
      const before = await filesUnder(uid, `Dump/${slug}/`);
      expect(before.filter((f) => !f.path.endsWith(" — Index.md")).length).toBe(2);

      // Second dump, IDENTICAL content → both notes classify as duplicate (same
      // source_key + same content_hash). This is what verifies the content_hash fix.
      const c2 = await client.req("POST", "/api/dump", { source: { type: "raw", text } });
      const { jobId: job2 } = (await c2.json()) as { jobId: string };
      await drainOnce();
      const r2 = await poll(client, job2);
      expect(r2.manifest!.length).toBe(2);
      expect(r2.manifest!.every((m) => m.status === "duplicate")).toBe(true);
      await client.req("POST", `/api/dump/jobs/${job2}/commit`, { selectedItemIds: [] });
      await drainOnce();
      const done2 = await poll(client, job2);
      expect(done2.status).toBe("done");
      expect(done2.counts.committed ?? 0).toBe(0);

      const after = await filesUnder(uid, `Dump/${slug}/`);
      expect(after.filter((f) => !f.path.endsWith(" — Index.md")).length).toBe(2); // no new notes
    } finally {
      srv.close();
    }
  }, 30000);

  it("commitUpdate overwrites an existing note in place with a snapshot + dump:update audit", async () => {
    // Focused test of the update path. Raw shaping can't produce 'update' (content-hash
    // keys), so we craft an update-status dump_item directly and call commitJob.
    const u = createUser({ email: `upd-${crypto.randomUUID()}@t.local` });
    const v = createVault(u.id, { name: "V" });
    const old = createFile(v.id, { path: "Dump/src/Existing.md", title: "Existing", content: "# Existing\n\nOLD BODY" });
    const job = createDumpJob({ userId: u.id, vaultId: v.id, sourceType: "raw", sourceRef: {}, sourceSlug: "src" });
    setDumpJobStatus(job.id, "committing");
    const shaped: ShapedNote = {
      notePath: old.path, title: "Existing", summary: "s", tags: [], links: [], body: "NEW BODY", origin: { type: "raw" },
    };
    insertDumpItem({ jobId: job.id, sourceKey: "raw:existing-key", status: "update", shaped: JSON.stringify(shaped), dedupOf: old.id });

    await commitJob(getOwnedDumpJob(u.id, job.id)!);

    const updated = getOwnedFile(u.id, old.id)!;
    expect(updated.content).toContain("NEW BODY");
    expect(updated.content).not.toContain("OLD BODY");
    const upd = db.prepare("SELECT id FROM audit_log WHERE user_id=? AND tool='dump:update' AND target=?").get(u.id, old.id) as { id: string } | undefined;
    expect(upd).toBeTruthy();
    expect(db.prepare("SELECT 1 FROM audit_snapshots WHERE audit_id=?").get(upd!.id)).toBeTruthy();
    const item = db.prepare("SELECT status, file_id FROM dump_items WHERE job_id=?").get(job.id) as { status: string; file_id: string };
    expect(item.status).toBe("committed");
    expect(item.file_id).toBe(old.id);
  }, 30000);
});
