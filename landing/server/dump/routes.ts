/**
 * Dump API — create/poll/commit/cancel/delete bulk-import jobs.
 *
 * Security model (see 00-global-constraints.md §12):
 *  - Cookie-session ONLY. PAT/MCP callers get 403 — Dump is a human surface.
 *  - Every job access is ownership-scoped (getOwnedDumpJob); a miss is 404.
 *  - Job creation is rate-limited (dumpLimiter, 20/min).
 */
import express, { type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { getCurrentUser } from "../auth/session.ts";
import {
  db, ensureDefaultVault, getVaultsForUser, getOwnedVault, getOwnedDumpJob,
  listDumpItems, updateDumpItem, setDumpJobStatus, deleteOwnedFile,
  getConnectorToken,
} from "../db.ts";
import { env } from "../env.ts";
import { keyvaultConfigured, decryptKey } from "../ai/keyvault.ts";
import { mintInstallationToken, ghFetch, type FetchImpl } from "../connectors/githubApp.ts";
import { makeNotionClient } from "../connectors/notion.ts";
import { enqueueDump, requestCancel } from "./jobs.ts";
import { buildManifest } from "./shape.ts";
import { slugifySource } from "./slug.ts";
import type { PublicDumpJob, DumpCounts } from "./types.ts";

export const dumpRouter = express.Router();
const jsonBody = express.json({ limit: "2mb" }); // pasted text / small uploads
const dumpLimiter = rateLimit({
  windowMs: 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many dumps. Please slow down." },
});

// Cookie-session ONLY. Dump is never reachable via PAT/MCP.
function cookieUser(req: Request, res: Response): string | null {
  if (req.apiUser) { res.status(403).json({ error: "Dump is not available via API tokens" }); return null; }
  const user = getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return user.id;
}

const rawSource = z.object({
  type: z.literal("raw"),
  text: z.string().max(2_000_000).optional(),
  files: z.array(z.object({ name: z.string().max(255), content: z.string().max(2_000_000) })).max(50).optional(),
});
const githubSource = z.object({
  type: z.literal("github"),
  repo: z.string().max(140),
  includeIssues: z.boolean().optional(),
  glob: z.string().max(200).optional(),
});
const notionSource = z.object({ type: z.literal("notion"), pageIds: z.array(z.string().max(100)).max(200) });
const createSchema = z.object({
  vaultId: z.string().optional(),
  source: z.discriminatedUnion("type", [rawSource, githubSource, notionSource]),
});

function sourceSlugFor(source: z.infer<typeof createSchema>["source"]): string {
  if (source.type === "github") return slugifySource(source.repo);
  if (source.type === "notion") return slugifySource("Notion Import");
  const first = source.files?.[0]?.name;
  return slugifySource(first ? first.replace(/\.[^.]+$/, "") : "Pasted Notes");
}

dumpRouter.post("/", dumpLimiter, jsonBody, (req: Request, res: Response) => {
  const uid = cookieUser(req, res); if (!uid) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid source" }); return; }
  ensureDefaultVault(uid);
  const vaults = getVaultsForUser(uid);
  const vaultId = parsed.data.vaultId && getOwnedVault(uid, parsed.data.vaultId) ? parsed.data.vaultId : vaults[0]?.id;
  if (!vaultId) { res.status(500).json({ error: "No vault" }); return; }
  const job = enqueueDump({
    userId: uid, vaultId, sourceType: parsed.data.source.type,
    sourceRef: parsed.data.source, sourceSlug: sourceSlugFor(parsed.data.source),
  });
  res.status(201).json({ jobId: job.id });
});

const GITHUB_API = "https://api.github.com";

/** List repos the installation can see. Injectable for tests (no network). */
export async function listInstallationRepos(
  installationId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<{ fullName: string; defaultBranch: string }[]> {
  const { token } = await mintInstallationToken(installationId, fetchImpl);
  const out: { fullName: string; defaultBranch: string }[] = [];
  for (let page = 1; page <= 10; page++) {
    const resp = await ghFetch(`${GITHUB_API}/installation/repositories?per_page=100&page=${page}`, { token, tokenType: "Bearer" }, fetchImpl);
    if (!resp.ok) throw new Error(`GitHub repositories → ${resp.status}`);
    const json = (await resp.json()) as { repositories?: { full_name: string; default_branch: string }[] };
    const batch = json.repositories ?? [];
    for (const r of batch) out.push({ fullName: r.full_name, defaultBranch: r.default_branch });
    if (batch.length < 100) break;
  }
  return out;
}

dumpRouter.get("/github/repos", async (req: Request, res: Response) => {
  const uid = cookieUser(req, res); if (!uid) return;
  // Config gate (503) precedes the connection gate (409) so an unconfigured
  // server never leaks whether a connector row exists.
  if (!env.githubConfigured || !keyvaultConfigured()) { res.status(503).json({ error: "GitHub connector is not configured" }); return; }
  const conn = getConnectorToken(uid, "github");
  if (!conn?.installation_id) { res.status(409).json({ error: "GitHub is not connected" }); return; }
  try {
    res.json(await listInstallationRepos(conn.installation_id));
  } catch {
    res.status(502).json({ error: "Could not reach GitHub" });
  }
});

// Notion page/database picker — searches the user's GRANTED content only.
dumpRouter.get("/notion/pages", async (req: Request, res: Response) => {
  const uid = cookieUser(req, res); if (!uid) return;
  if (!env.notionConfigured || !keyvaultConfigured()) {
    res.status(503).json({ error: "Notion connector is not configured" });
    return;
  }
  const row = getConnectorToken(uid, "notion");
  if (!row || !row.access_token_cipher) {
    res.status(409).json({ error: "Notion is not connected" });
    return;
  }

  const pages: { id: string; title: string; type: "page" | "database" }[] = [];
  try {
    const client = makeNotionClient(decryptKey(row.access_token_cipher));
    let cursor: string | undefined;
    for (let page = 0; page < 5 && pages.length < 200; page++) {
      const result = await client.search({ cursor, pageSize: 100 });
      for (const item of result.results) {
        const type = item.object === "database" ? "database" : "page";
        pages.push({ id: item.id, title: notionTitle(item), type });
      }
      if (!result.has_more || !result.next_cursor) break;
      cursor = result.next_cursor;
    }
  } catch {
    res.status(502).json({ error: "Could not reach Notion" });
    return;
  }
  res.json({ pages: pages.slice(0, 200) });
});

dumpRouter.get("/jobs/:id", (req: Request, res: Response) => {
  const uid = cookieUser(req, res); if (!uid) return;
  const job = getOwnedDumpJob(uid, req.params.id as string);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  const out: PublicDumpJob = {
    id: job.id, sourceType: job.source_type, status: job.status,
    counts: JSON.parse(job.counts) as DumpCounts, error: job.error,
  };
  if (job.status === "awaiting_review") out.manifest = buildManifest(job.id);
  res.json(out);
});

const commitSchema = z.object({
  selectedItemIds: z.array(z.string()).max(2000),
  updates: z.record(z.string(), z.enum(["overwrite", "skip"])).optional(),
});
dumpRouter.post("/jobs/:id/commit", jsonBody, (req: Request, res: Response) => {
  const uid = cookieUser(req, res); if (!uid) return;
  const job = getOwnedDumpJob(uid, req.params.id as string);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status !== "awaiting_review") { res.status(409).json({ error: "Job is not awaiting review" }); return; }
  const parsed = commitSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid commit" }); return; }
  const selected = new Set(parsed.data.selectedItemIds);
  const updates = parsed.data.updates ?? {};
  for (const item of listDumpItems(job.id)) {
    if (selected.has(item.id) && updates[item.id] !== "skip") updateDumpItem(item.id, { status: "selected" });
    else if (item.status !== "duplicate") updateDumpItem(item.id, { status: "skipped" });
  }
  setDumpJobStatus(job.id, "committing");
  res.status(202).json({ ok: true });
});

dumpRouter.post("/jobs/:id/cancel", (req: Request, res: Response) => {
  const uid = cookieUser(req, res); if (!uid) return;
  const job = getOwnedDumpJob(uid, req.params.id as string);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  requestCancel(job.id);
  if (job.status === "awaiting_review" || job.status === "queued") setDumpJobStatus(job.id, "cancelled");
  res.json({ ok: true });
});

dumpRouter.delete("/jobs/:id", (req: Request, res: Response) => {
  const uid = cookieUser(req, res); if (!uid) return;
  const job = getOwnedDumpJob(uid, req.params.id as string);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (req.query.purgeNotes === "1") {
    for (const item of listDumpItems(job.id)) if (item.file_id) deleteOwnedFile(uid, item.file_id);
  }
  // Delete the job row (cascades dump_items). dump_sources rows are removed by file deletion (FK).
  db.prepare("DELETE FROM dump_jobs WHERE id = ? AND user_id = ?").run(job.id, uid);
  res.status(204).end();
});

/** Best-effort human title for a Notion page (title property) or database (top-level title). */
function notionTitle(item: { properties?: Record<string, unknown>; title?: Array<{ plain_text?: string }> }): string {
  // Database: top-level `title` rich-text array.
  if (Array.isArray(item.title)) {
    const t = item.title.map((r) => r?.plain_text ?? "").join("").trim();
    if (t) return t;
  }
  // Page: find the property whose type is "title".
  const props = item.properties ?? {};
  for (const value of Object.values(props)) {
    const v = value as { type?: string; title?: Array<{ plain_text?: string }> };
    if (v?.type === "title" && Array.isArray(v.title)) {
      const t = v.title.map((r) => r?.plain_text ?? "").join("").trim();
      if (t) return t;
    }
  }
  return "Untitled";
}
