import { describe, it, expect, afterEach } from "vitest";
import { startTestServer, signup } from "../test-helpers.ts";
import { drainOnce } from "./jobs.ts";
import { commitJob } from "./commit.ts";
import { __setEnrichComplete, __resetEnrichComplete } from "./enrich.ts";
import {
  db, createUser, createVault, createFile, createDumpJob, insertDumpItem,
  getOwnedDumpJob, getOwnedFile, getDumpSource, updateDumpItem,
} from "../db.ts";
import type { ShapedNote } from "./types.ts";

afterEach(() => __resetEnrichComplete());

/**
 * Fake LLM: echoes the title hint back and links EVERY offered candidate (≤5).
 * Lets the pipeline resolve real [[links]] deterministically with no API key —
 * enrichNote's allow-list + resolveLinks' two-pass are still fully exercised.
 */
function installLinkingFakeEnrich() {
  __setEnrichComplete((async ({ user }: { user: string }) => {
    const title = /^Title hint: (.*)$/m.exec(user)?.[1] ?? "Untitled";
    const candidates = [...user.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
    return {
      text: JSON.stringify({ title, summary: "Auto summary.", tags: ["auto"], links: candidates.slice(0, 5) }),
      inputTokens: 0,
      outputTokens: 0,
    };
  }) as unknown as typeof import("../ai/openai.ts").complete);
}

type Client = Awaited<ReturnType<typeof signup>>;

async function poll(client: Client, jobId: string) {
  return (await (await client.req("GET", `/api/dump/jobs/${jobId}`)).json()) as {
    status: string;
    counts: Record<string, number>;
    manifest?: { itemId: string; title: string; notePath: string; status: string; dedupOf?: string }[];
  };
}

function userIdByEmail(email: string): string {
  return (db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string }).id;
}

async function filesUnder(uid: string, prefix: string) {
  return db
    .prepare(
      "SELECT f.id, f.path, f.title, f.content FROM files f JOIN vaults v ON v.id=f.vault_id WHERE v.user_id=? AND f.path LIKE ? ORDER BY f.path",
    )
    .all(uid, prefix + "%") as { id: string; path: string; title: string; content: string }[];
}

describe("dump commit (raw, end-to-end)", () => {
  it("creates atomic notes under Dump/<slug>/, resolves a [[link]], builds a MOC, embeds + audits", async () => {
    installLinkingFakeEnrich();
    const srv = await startTestServer();
    try {
      const email = `c-${crypto.randomUUID()}@t.local`;
      const client = await signup(srv.baseURL, email);
      const uid = userIdByEmail(email);

      // Two files → two RawItems (no split needed). Beta is shaped after Alpha,
      // so Alpha appears in Beta's sibling-candidate set and the fake enrich
      // links it → commit resolves a real [[Alpha Service]] wiki-link.
      const create = await client.req("POST", "/api/dump", {
        source: {
          type: "raw",
          files: [
            { name: "Alpha Service.md", content: "The Alpha Service depends on the Beta Service for queueing." },
            { name: "Beta Service.md", content: "The Beta Service is a durable queue used by other services." },
          ],
        },
      });
      expect(create.status).toBe(201);
      const { jobId } = (await create.json()) as { jobId: string };

      await drainOnce(); // shaping
      const review = await poll(client, jobId);
      expect(review.status).toBe("awaiting_review");
      expect(review.manifest!.length).toBe(2);

      // Approve everything.
      const selectedItemIds = review.manifest!.map((m) => m.itemId);
      const commit = await client.req("POST", `/api/dump/jobs/${jobId}/commit`, { selectedItemIds });
      expect(commit.status).toBe(202);

      await drainOnce(); // committing
      const done = await poll(client, jobId);
      expect(done.status).toBe("done");
      expect(done.counts.committed).toBe(2);

      // 2 content notes + 1 MOC under Dump/<slug>/.
      const slugRow = db.prepare("SELECT source_slug FROM dump_jobs WHERE id=?").get(jobId) as { source_slug: string };
      const all = await filesUnder(uid, `Dump/${slugRow.source_slug}/`);
      const contentNotes = all.filter((f) => !f.path.endsWith(" — Index.md"));
      const moc = all.find((f) => f.path.endsWith(" — Index.md"));
      expect(contentNotes.length).toBe(2);
      expect(moc).toBeTruthy();

      // At least one content note has a resolved Related [[link]] to its sibling.
      expect(contentNotes.some((f) => /## Related\n- \[\[/.test(f.content))).toBe(true);
      const beta = contentNotes.find((f) => f.title === "Beta Service")!;
      expect(beta.content).toContain("[[Alpha Service]]");

      // MOC lists both content notes.
      for (const f of contentNotes) expect(moc!.content).toContain(`[[${f.title}]]`);

      // Every content note body carries the untrusted provenance marker.
      for (const f of contentNotes) {
        expect(f.content).toMatch(/<!-- noto:source .*untrusted=1.*-->/);
      }

      // dump_sources rows exist for each committed file.
      for (const f of all) {
        const src = db.prepare("SELECT 1 FROM dump_sources WHERE user_id=? AND file_id=?").get(uid, f.id);
        expect(src).toBeTruthy();
      }

      // Audit: dump:create rows were written (2 notes + MOC).
      const created = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE user_id=? AND tool='dump:create'").get(uid) as { n: number };
      expect(created.n).toBeGreaterThanOrEqual(3);
    } finally {
      srv.close();
    }
  });

  // Spec §9: raw paste has NO persistent source identity — re-pasting identical
  // content is content-hash-skipped (duplicate), and a raw re-dump never
  // "updates" in place (that path belongs to stable-key connectors, P4/P5).
  it("re-dumping identical raw content classifies everything duplicate and writes nothing", async () => {
    const srv = await startTestServer();
    try {
      const email = `r-${crypto.randomUUID()}@t.local`;
      const client = await signup(srv.baseURL, email);
      const uid = userIdByEmail(email);
      const text = "# Alpha Service\n\nAlpha body v1.";

      // First dump: commit the single note.
      const c1 = await client.req("POST", "/api/dump", { source: { type: "raw", text } });
      const { jobId: job1 } = (await c1.json()) as { jobId: string };
      await drainOnce();
      const r1 = await poll(client, job1);
      await client.req("POST", `/api/dump/jobs/${job1}/commit`, { selectedItemIds: r1.manifest!.map((m) => m.itemId) });
      await drainOnce();
      expect((await poll(client, job1)).status).toBe("done");
      const before = await filesUnder(uid, "Dump/");

      // Second dump: identical content → duplicate; nothing selectable; no new files, no second MOC.
      const c2 = await client.req("POST", "/api/dump", { source: { type: "raw", text } });
      const { jobId: job2 } = (await c2.json()) as { jobId: string };
      await drainOnce();
      const r2 = await poll(client, job2);
      expect(r2.status).toBe("awaiting_review");
      expect(r2.manifest!.length).toBe(1);
      expect(r2.manifest![0].status).toBe("duplicate");
      expect(r2.manifest![0].dedupOf).toBeTruthy();

      await client.req("POST", `/api/dump/jobs/${job2}/commit`, { selectedItemIds: [] });
      await drainOnce();
      const done2 = await poll(client, job2);
      expect(done2.status).toBe("done");
      expect(done2.counts.committed ?? 0).toBe(0);

      const after = await filesUnder(uid, "Dump/");
      expect(after.length).toBe(before.length); // no new notes, no duplicate MOC
    } finally {
      srv.close();
    }
  });

  // Direct unit coverage of the update-in-place path (used by stable-key
  // connectors): snapshot → dump:update audit → overwrite → re-embed → sources.
  it("commitJob overwrites an existing note in place for status='update' items", async () => {
    const u = createUser({ email: `upd-${crypto.randomUUID()}@t.local` });
    const v = createVault(u.id, { name: "V" });
    const old = createFile(v.id, { path: "Dump/src/Alpha.md", title: "Alpha", content: "# Alpha\n\nold body\n" });

    const job = createDumpJob({ userId: u.id, vaultId: v.id, sourceType: "raw", sourceRef: {}, sourceSlug: "src" });
    const shaped: ShapedNote = {
      notePath: "Dump/src/Alpha.md",
      title: "Alpha",
      summary: "Updated.",
      tags: [],
      links: [],
      body: "new body v2",
      origin: { type: "raw", ref: "test" },
    };
    const item = insertDumpItem({
      jobId: job.id, sourceKey: "stable:alpha", status: "pending",
      shaped: JSON.stringify(shaped), dedupOf: old.id,
    });
    updateDumpItem(item.id, { status: "update" });

    await commitJob(getOwnedDumpJob(u.id, job.id)!);

    // Overwritten in place: same file id, new content.
    const after = getOwnedFile(u.id, old.id)!;
    expect(after.content).toContain("new body v2");
    expect(after.content).not.toContain("old body");

    // dump:update audit + snapshot of the OLD content exist.
    const upd = db.prepare("SELECT id FROM audit_log WHERE user_id=? AND tool='dump:update' AND target=?").get(u.id, old.id) as { id: string } | undefined;
    expect(upd).toBeTruthy();
    const snap = db.prepare("SELECT content FROM audit_snapshots WHERE audit_id=?").get(upd!.id) as { content: string } | undefined;
    expect(snap?.content).toContain("old body");

    // dump_sources maps the stable key to the same file.
    expect(getDumpSource(u.id, "stable:alpha")?.file_id).toBe(old.id);

    // Job finished with 1 committed.
    const doneJob = getOwnedDumpJob(u.id, job.id)!;
    expect(doneJob.status).toBe("done");
    expect(JSON.parse(doneJob.counts).committed).toBe(1);
  });
});
