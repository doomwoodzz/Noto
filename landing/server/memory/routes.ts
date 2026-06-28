/**
 * Atomic memory API — the remember/recall store behind the MCP layer.
 * Reuses PAT auth + audit_log. Reads require 'read' scope; remember requires 'memory'.
 * Ownership is enforced by user_id; 404/empty never leaks another user's data.
 */
import express, { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { getCurrentUser } from "../auth/session.ts";
import { requireScope } from "../auth/pat.ts";
import { rememberMemory, recallMemories, listMemories, writeAudit } from "../db.ts";

export const memoryRouter = Router();
const jsonBody = express.json({ limit: "16kb" });

const memoryLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 120,
  standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many memory requests. Please slow down." },
});

function resolveUserId(req: Request, res: Response): string | null {
  if (req.apiUser) return req.apiUser.userId;
  const u = getCurrentUser(req);
  if (!u) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return u.id;
}

const rememberSchema = z.object({
  text: z.string().trim().min(1).max(2048),
  type: z.enum(["decision", "preference", "fact", "glossary"]).default("fact"),
  scope: z.string().trim().max(200).optional(),
  supersedes: z.string().trim().max(64).optional(),
});

// POST /api/memory — remember (requires 'memory' scope for PATs).
memoryRouter.post("/", memoryLimiter, jsonBody, (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "memory")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const parsed = rememberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid memory" });
    return;
  }
  const sourceClient = (req.get("x-noto-client") || (req.apiUser ? "claude-code" : "web")).slice(0, 40);
  const { memory, deduped } = rememberMemory({
    userId: uid, text: parsed.data.text, type: parsed.data.type,
    scope: parsed.data.scope, sourceClient, supersedesId: parsed.data.supersedes,
  });
  // A deduped plain `remember` only bumped an existing memory's use_count — nothing
  // was created, so there is nothing to attribute or revert. (A `supersede` still
  // audits even when it dedups: it retired the predecessor.)
  if (!deduped || parsed.data.supersedes) {
    writeAudit({
      userId: uid, tokenId: req.apiUser?.tokenId ?? null,
      tool: parsed.data.supersedes ? "supersede" : "remember",
      target: memory.id, beforeHash: null,
      sourceClient,
    });
  }
  res.status(201).json({ memoryId: memory.id, deduped });
});

// GET /api/memory — recall (requires 'read' scope for PATs).
memoryRouter.get("/", memoryLimiter, (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "read")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const scope = typeof req.query.scope === "string" && req.query.scope ? req.query.scope : undefined;
  const typeRaw = typeof req.query.type === "string" && req.query.type ? req.query.type : undefined;
  if (typeRaw && !["decision", "preference", "fact", "glossary"].includes(typeRaw)) {
    res.status(400).json({ error: "Invalid type" }); return;
  }
  const type = typeRaw;
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 6));
  const scopes = scope ? (scope === "global" ? ["global"] : [scope]) : [];
  res.json({ memories: recallMemories(uid, scopes, q, type, limit) });
});

// GET /api/memory/list — recency browse for the Settings UI (cookie session).
memoryRouter.get("/list", memoryLimiter, (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "read")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const scope = typeof req.query.scope === "string" && req.query.scope ? req.query.scope : undefined;
  const typeRaw = typeof req.query.type === "string" && req.query.type ? req.query.type : undefined;
  if (typeRaw && !["decision", "preference", "fact", "glossary"].includes(typeRaw)) {
    res.status(400).json({ error: "Invalid type" }); return;
  }
  const type = typeRaw;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  res.json({ memories: listMemories(uid, scope, type, limit) });
});
