import express, { type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { getCurrentUser } from "../auth/session.ts";
import {
  db, ensureDefaultVault, getVaultsForUser, getOwnedVault, getOwnedDumpJob,
  listDumpItems, updateDumpItem, setDumpJobStatus, deleteOwnedFile, getConnectorToken,
} from "../db.ts";
import { enqueueDump, requestCancel } from "./jobs.ts";
import { buildManifest } from "./shape.ts";
import { slugifySource } from "./slug.ts";
import type { PublicDumpJob, DumpCounts } from "./types.ts";
import { env } from "../env.ts";
import { keyvaultConfigured } from "../ai/keyvault.ts";
import { mintInstallationToken, ghFetch, type FetchImpl } from "../connectors/githubApp.ts";

export const dumpRouter = express.Router();
const jsonBody = express.json({ limit: "2mb" });
const dumpLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many dumps. Please slow down." } });

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
const githubSource = z.object({ type: z.literal("github"), repo: z.string().max(140), includeIssues: z.boolean().optional(), glob: z.string().max(200).optional() });
const notionSource = z.object({ type: z.literal("notion"), pageIds: z.array(z.string().max(100)).max(200) });
const createSchema = z.object({ vaultId: z.string().optional(), source: z.discriminatedUnion("type", [rawSource, githubSource, notionSource]) });

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
  const job = enqueueDump({ userId: uid, vaultId, sourceType: parsed.data.source.type, sourceRef: parsed.data.source, sourceSlug: sourceSlugFor(parsed.data.source) });
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
  if (!env.githubConfigured || !keyvaultConfigured()) { res.status(503).json({ error: "GitHub connector is not configured" }); return; }
  const conn = getConnectorToken(uid, "github");
  if (!conn?.installation_id) { res.status(409).json({ error: "GitHub is not connected" }); return; }
  try {
    res.json(await listInstallationRepos(conn.installation_id));
  } catch {
    res.status(502).json({ error: "Could not reach GitHub" });
  }
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
  if (job.status === "awaiting_review" || job.status === "queued") {
    // Resolved synchronously here — the worker never processes it, so do NOT set a
    // cancel flag (that would leak into the in-memory Set forever).
    setDumpJobStatus(job.id, "cancelled");
  } else {
    // In-flight (fetching/shaping/committing): the worker must observe + reap the flag.
    requestCancel(job.id);
  }
  res.json({ ok: true });
});

dumpRouter.delete("/jobs/:id", (req: Request, res: Response) => {
  const uid = cookieUser(req, res); if (!uid) return;
  const job = getOwnedDumpJob(uid, req.params.id as string);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (req.query.purgeNotes === "1") for (const item of listDumpItems(job.id)) if (item.file_id) deleteOwnedFile(uid, item.file_id);
  db.prepare("DELETE FROM dump_jobs WHERE id = ? AND user_id = ?").run(job.id, uid);
  res.status(204).end();
});
