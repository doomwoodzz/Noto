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
  deleteFile,
  ensureDefaultVault,
  getFilesForVault,
  getOwnedFile,
  getOwnedVault,
  getVaultsForUser,
  MAX_FILES_PER_VAULT,
  pathTaken,
  updateFile,
} from "../db.ts";

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
  })
  .refine((b) => b.path !== undefined || b.title !== undefined || b.content !== undefined, {
    message: "Nothing to update",
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

/* -------------------------------- routes ------------------------------- */

// List the user's vaults (bootstraps an empty default vault + Welcome note
// on first access).
notesRouter.get("/vaults", (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  ensureDefaultVault(userId);
  res.json({ vaults: getVaultsForUser(userId) });
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
  (req: Request, res: Response) => {
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
    res.status(201).json({ file: createFile(vault.id, parsed.data) });
  },
);

// Update a note the caller owns.
notesRouter.patch("/files/:fileId", writeLimiter, jsonBody, (req: Request, res: Response) => {
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
  res.json({ file: updateFile(existing.id, parsed.data) });
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
