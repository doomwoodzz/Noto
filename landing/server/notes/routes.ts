/**
 * Notes API — per-user vaults & Markdown files.
 *
 * Security model:
 *  - Every route requires a valid session (getCurrentUser → 401 otherwise).
 *  - Every read/write is scoped to the owning user. Vault/file lookups use
 *    ownership-checked queries (getOwnedVault / getOwnedFile); a miss returns
 *    404 (never 403) so existence of other users' data can't be probed.
 *  - All bodies are zod-validated with strict size/shape caps; paths are
 *    constrained to forbid traversal (`..`), absolute paths, backslashes and
 *    control characters.
 *  - Per-vault file and per-user vault quotas bound storage abuse.
 *  - CSRF (double-submit + origin pin) and the global rate limiter are already
 *    applied to all of /api upstream; a stricter limiter guards mutations here.
 */
import express, { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { getCurrentUser } from "../auth/session.ts";
import {
  countFilesForVault,
  createFile,
  createVault,
  countVaultsForUser,
  deleteFile,
  ensureDefaultVault,
  getFilesForVault,
  getOwnedFile,
  getOwnedVault,
  getVaultsForUser,
  MAX_FILES_PER_VAULT,
  MAX_VAULTS_PER_USER,
  pathTaken,
  toPublicFile,
  updateFile,
  writeAudit,
  writeSnapshot,
  sha256Hex,
  setVaultAI,
  getVaultAIPublic,
} from "../db.ts";
import { encryptKey, keyvaultConfigured } from "../ai/keyvault.ts";
import { requireScope } from "../auth/pat.ts";
import { reembedNote } from "../search/embedNote.ts";
import { rebuildVaultGraph } from "../graph/build.ts";
import { getSection, replaceSection, listHeadings, appendUnderHeading } from "./sections.ts";
import { isMemoryPath } from "./confinement.ts";

export const notesRouter = Router();

/* ------------------------------ validation ----------------------------- */

// A vault-relative POSIX-style path ending in `.md`. No leading slash, no
// `..`/empty segment, no backslashes, no control characters.
// eslint-disable-next-line no-control-regex -- intentionally rejects control chars in note paths
const CONTROL_CHARS = /[\u0000-\u001f]/;
const pathSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine((p) => p.endsWith(".md"), "Note path must end in .md")
  .refine((p) => !p.startsWith("/"), "Note path must be relative")
  .refine((p) => !p.includes("\\"), "Note path must not contain backslashes")
  .refine((p) => !CONTROL_CHARS.test(p), "Note path has invalid characters")
  .refine(
    (p) => p.split("/").every((seg) => seg.length > 0 && seg !== "." && seg !== ".."),
    "Note path has an invalid segment",
  );

const titleSchema = z.string().trim().min(1).max(200);
// 256 KB of Markdown is enormous for a note; bounds memory abuse.
const contentSchema = z.string().max(256 * 1024);

const createSchema = z.object({
  path: pathSchema,
  title: titleSchema,
  content: contentSchema.default(""),
});

const patchSchema = z
  .object({
    path: pathSchema.optional(),
    title: titleSchema.optional(),
    content: contentSchema.optional(),
    pinned: z.boolean().optional(),
  })
  .refine(
    (b) =>
      b.path !== undefined ||
      b.title !== undefined ||
      b.content !== undefined ||
      b.pinned !== undefined,
    { message: "Nothing to update" },
  );

const vaultNameSchema = z.string().trim().min(1).max(60);
const vaultIconSchema = z.string().trim().max(16).optional(); // one emoji; 16 UTF-16 units covers ZWJ sequences
const vaultColorSchema = z.string().trim().max(24).optional(); // a color token, validated client-side
const createVaultSchema = z.object({
  name: vaultNameSchema,
  icon: vaultIconSchema,
  color: vaultColorSchema,
});

// Note writes can be larger than auth payloads; cap deliberately above the
// content limit so oversized bodies are rejected by validation, not the parser.
const jsonBody = express.json({ limit: "512kb" });

// Stricter limiter for mutations (autosave is debounced, so this is generous).
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many writes. Please slow down." },
});

/* ------------------------------- helpers ------------------------------- */

function requireUserId(req: Request, res: Response): string | null {
  const user = getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return user.id;
}

/** Resolve the caller from a PAT (preferred) or the session cookie.
 *  Phase 0: PAT access is intentionally scoped to single-note/section endpoints
 *  only. Full-note PATCH/DELETE remain cookie-only until Phase 2. */
function resolveUserId(req: Request, res: Response): string | null {
  if (req.apiUser) return req.apiUser.userId;
  return requireUserId(req, res); // existing cookie path (sends 401 on miss)
}

/** The AI client that authored a write (for provenance), from the header. */
function clientOf(req: Request): string {
  return (req.get("x-noto-client") || (req.apiUser ? "claude-code" : "web")).slice(0, 40);
}

/* -------------------------------- routes ------------------------------- */

// List the user's vaults (bootstraps an empty default vault + Welcome note
// on first access).
notesRouter.get("/vaults", (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  ensureDefaultVault(userId);
  res.json({ vaults: getVaultsForUser(userId) });
});

// Create a new vault for the caller (name + optional emoji icon + color token).
notesRouter.post("/vaults", writeLimiter, jsonBody, (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const parsed = createVaultSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid vault" });
    return;
  }
  if (countVaultsForUser(userId) >= MAX_VAULTS_PER_USER) {
    res.status(409).json({ error: "You've reached the maximum number of vaults." });
    return;
  }
  const vault = createVault(userId, {
    name: parsed.data.name,
    icon: parsed.data.icon ?? null,
    color: parsed.data.color ?? null,
  });
  res.status(201).json({ vault });
});

const vaultAISchema = z.object({
  provider: z.enum(["openai"]).default("openai"),
  model: z.string().trim().max(60).nullable().optional(),
  // undefined → leave key; "" → clear key; non-empty → set key
  apiKey: z.string().trim().max(400).optional(),
});

notesRouter.get("/vaults/:vaultId/ai", (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const vault = getOwnedVault(userId, req.params.vaultId as string);
  if (!vault) {
    res.status(404).json({ error: "Vault not found" });
    return;
  }
  const cfg = getVaultAIPublic(vault.id) ?? { provider: "openai", model: null, configured: false };
  res.json(cfg);
});

notesRouter.put("/vaults/:vaultId/ai", writeLimiter, jsonBody, (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const vault = getOwnedVault(userId, req.params.vaultId as string);
  if (!vault) {
    res.status(404).json({ error: "Vault not found" });
    return;
  }
  const parsed = vaultAISchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid AI config" });
    return;
  }
  const { provider, model, apiKey } = parsed.data;

  let apiKeyCipher: Uint8Array | null | undefined;
  if (apiKey === undefined) {
    apiKeyCipher = undefined; // leave as-is
  } else if (apiKey === "") {
    apiKeyCipher = null; // clear
  } else {
    if (!keyvaultConfigured()) {
      res.status(400).json({ error: "Per-vault keys aren't available on this server." });
      return;
    }
    apiKeyCipher = encryptKey(apiKey);
  }

  setVaultAI(vault.id, { provider, model: model ?? null, apiKeyCipher });
  const cfg = getVaultAIPublic(vault.id) ?? { provider, model: model ?? null, configured: false };
  res.json(cfg); // never includes the key
});

// List files in a vault the caller owns.
notesRouter.get("/vaults/:vaultId/files", (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const vault = getOwnedVault(userId, req.params.vaultId as string);
  if (!vault) {
    res.status(404).json({ error: "Vault not found" });
    return;
  }
  res.json({ files: getFilesForVault(vault.id) });
});

// Create a note in a vault the caller owns.
notesRouter.post(
  "/vaults/:vaultId/files",
  writeLimiter,
  jsonBody,
  async (req: Request, res: Response) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const vault = getOwnedVault(userId, req.params.vaultId as string);
    if (!vault) {
      res.status(404).json({ error: "Vault not found" });
      return;
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid note" });
      return;
    }
    if (countFilesForVault(vault.id) >= MAX_FILES_PER_VAULT) {
      res.status(409).json({ error: "This vault is full." });
      return;
    }
    if (pathTaken(vault.id, parsed.data.path)) {
      res.status(409).json({ error: "A note already exists at that path." });
      return;
    }
    const created = createFile(vault.id, parsed.data);
    await reembedNote(created.id, parsed.data.content);
    await rebuildVaultGraph(vault.id);
    res.status(201).json({ file: created });
  },
);

// Create a note in the caller's default vault (PAT write scope or cookie).
// PAT writes are confined to Memory/.
notesRouter.post("/notes", writeLimiter, jsonBody, async (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "write")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid note" });
    return;
  }
  if (req.apiUser && !isMemoryPath(parsed.data.path)) {
    res.status(403).json({ error: "AI writes are confined to Memory/" });
    return;
  }
  ensureDefaultVault(uid);
  const vault = getVaultsForUser(uid)[0];
  if (!vault) {
    res.status(500).json({ error: "No vault" });
    return;
  }
  if (countFilesForVault(vault.id) >= MAX_FILES_PER_VAULT) {
    res.status(409).json({ error: "This vault is full." });
    return;
  }
  if (pathTaken(vault.id, parsed.data.path)) {
    res.status(409).json({ error: "A note already exists at that path." });
    return;
  }
  const file = createFile(vault.id, parsed.data);
  await reembedNote(file.id, parsed.data.content);
  await rebuildVaultGraph(vault.id);
  writeAudit({
    userId: uid,
    tokenId: req.apiUser?.tokenId ?? null,
    tool: "create_note",
    target: file.id,
    beforeHash: null,
    afterHash: sha256Hex(file.content),
    sourceClient: clientOf(req),
  });
  res.status(201).json({ fileId: file.id, path: file.path });
});

// Update a note the caller owns.
notesRouter.patch("/files/:fileId", writeLimiter, jsonBody, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const existing = getOwnedFile(userId, req.params.fileId as string);
  if (!existing) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid update" });
    return;
  }
  if (parsed.data.path && parsed.data.path !== existing.path) {
    if (pathTaken(existing.vault_id, parsed.data.path, existing.id)) {
      res.status(409).json({ error: "A note already exists at that path." });
      return;
    }
  }
  const updated = updateFile(existing.id, parsed.data);
  if (parsed.data.content !== undefined) {
    await reembedNote(existing.id, parsed.data.content);
    await rebuildVaultGraph(existing.vault_id);
  }
  res.json({ file: updated });
});

// Fetch a single note by id (PAT read scope or cookie session).
notesRouter.get("/files/:fileId", (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "read")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const file = getOwnedFile(uid, req.params.fileId as string);
  if (!file) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  res.json({ file: toPublicFile(file) });
});

notesRouter.get("/files/:fileId/section", (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "read")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const heading = (typeof req.query.heading === "string" ? req.query.heading : "").trim();
  if (!heading) {
    res.status(400).json({ error: "Missing ?heading=" });
    return;
  }
  const file = getOwnedFile(uid, req.params.fileId as string);
  if (!file) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  const matches = listHeadings(file.content).filter((h) => h.path === heading);
  if (matches.length > 1) {
    res.status(409).json({ error: "Ambiguous heading: multiple sections share this path" });
    return;
  }
  const content = getSection(file.content, heading);
  if (content === null) {
    res.status(404).json({ error: "Section not found", headings: listHeadings(file.content).map((h) => h.path) });
    return;
  }
  res.json({ fileId: file.id, headingPath: heading.split("/"), content });
});

const sectionPatchSchema = z.object({
  heading: z.string().trim().min(1).max(400),
  content: z.string().max(256 * 1024),
  expectUpdatedAt: z.number().int().optional(),
});

notesRouter.patch("/files/:fileId/section", writeLimiter, jsonBody, async (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "write")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const file = getOwnedFile(uid, req.params.fileId as string);
  if (!file) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  if (req.apiUser && !isMemoryPath(file.path)) {
    res.status(403).json({ error: "AI writes are confined to Memory/" });
    return;
  }
  const parsed = sectionPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid section update" });
    return;
  }
  if (parsed.data.expectUpdatedAt !== undefined && parsed.data.expectUpdatedAt !== file.updated_at) {
    res.status(409).json({ error: "Note changed since expectUpdatedAt", currentUpdatedAt: file.updated_at });
    return;
  }
  const sectionMatches = listHeadings(file.content).filter((h) => h.path === parsed.data.heading);
  if (sectionMatches.length > 1) {
    res.status(409).json({ error: "Ambiguous heading: multiple sections share this path" });
    return;
  }
  const nextContent = replaceSection(file.content, parsed.data.heading, parsed.data.content);
  if (nextContent === null) {
    res.status(404).json({ error: "Section not found", headings: listHeadings(file.content).map((h) => h.path) });
    return;
  }
  const auditId = writeAudit({
    userId: uid,
    tokenId: req.apiUser?.tokenId ?? null,
    tool: "update_section",
    target: file.id,
    beforeHash: sha256Hex(file.content),
    afterHash: sha256Hex(nextContent),
    sourceClient: clientOf(req),
  });
  writeSnapshot(auditId, file.content);
  const updated = updateFile(file.id, { content: nextContent });
  await reembedNote(file.id, nextContent);
  await rebuildVaultGraph(file.vault_id);
  res.json({ fileId: updated.id, updatedAt: updated.updatedAt });
});

const appendSchema = z.object({
  text: z.string().trim().min(1).max(256 * 1024),
  underHeading: z.string().trim().min(1).max(400).optional(),
  expectUpdatedAt: z.number().int().optional(),
});

// Append text to a note (optionally under a heading). PAT writes confined to Memory/.
notesRouter.post("/files/:fileId/append", writeLimiter, jsonBody, async (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "write")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const file = getOwnedFile(uid, req.params.fileId as string);
  if (!file) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  if (req.apiUser && !isMemoryPath(file.path)) {
    res.status(403).json({ error: "AI writes are confined to Memory/" });
    return;
  }
  const parsed = appendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid append" });
    return;
  }
  if (parsed.data.expectUpdatedAt !== undefined && parsed.data.expectUpdatedAt !== file.updated_at) {
    res.status(409).json({ error: "Note changed since expectUpdatedAt", currentUpdatedAt: file.updated_at });
    return;
  }
  let nextContent: string;
  if (parsed.data.underHeading) {
    const matches = listHeadings(file.content).filter((h) => h.path === parsed.data.underHeading);
    if (matches.length > 1) {
      res.status(409).json({ error: "Ambiguous heading: multiple sections share this path" });
      return;
    }
    const appended = appendUnderHeading(file.content, parsed.data.underHeading, parsed.data.text);
    if (appended === null) {
      res.status(404).json({ error: "Section not found", headings: listHeadings(file.content).map((h) => h.path) });
      return;
    }
    nextContent = appended;
  } else {
    const base = file.content.replace(/\s+$/, "");
    nextContent = base ? `${base}\n\n${parsed.data.text}\n` : `${parsed.data.text}\n`;
  }
  const auditId = writeAudit({
    userId: uid,
    tokenId: req.apiUser?.tokenId ?? null,
    tool: "append_note",
    target: file.id,
    beforeHash: sha256Hex(file.content),
    afterHash: sha256Hex(nextContent),
    sourceClient: clientOf(req),
  });
  writeSnapshot(auditId, file.content);
  const updated = updateFile(file.id, { content: nextContent });
  await reembedNote(file.id, nextContent);
  await rebuildVaultGraph(file.vault_id);
  res.json({ fileId: updated.id, updatedAt: updated.updatedAt });
});

// Delete a note the caller owns.
notesRouter.delete("/files/:fileId", writeLimiter, (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const existing = getOwnedFile(userId, req.params.fileId as string);
  if (!existing) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  deleteFile(existing.id);
  res.status(204).end();
});
