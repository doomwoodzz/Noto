/** Read-only discovery endpoints for the MCP layer: FTS note search + a refs-only note list. */
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { getCurrentUser } from "../auth/session.ts";
import { requireScope } from "../auth/pat.ts";
import { listNoteRefs } from "../db.ts";
import { semanticSearchNotes } from "./semantic.ts";
import { markUntrustedResults } from "../mcp/markUntrusted.ts";

export const searchRouter = Router();
const limiter = rateLimit({
  windowMs: 60 * 1000, limit: 120,
  standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many search requests. Please slow down." },
});

function resolveUserId(req: Request, res: Response): string | null {
  if (req.apiUser) return req.apiUser.userId;
  const u = getCurrentUser(req);
  if (!u) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return u.id;
}

// GET /api/search?q=&limit= — semantic (embedding) note search with lexical fallback.
searchRouter.get("/search", limiter, async (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "read")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  // SP1: notes are scoped by user_id only; scope/tag query params are reserved for a later phase (not yet filtered).
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
  res.json({ results: markUntrustedResults(await semanticSearchNotes(uid, q, limit)) });
});

// GET /api/notes?by=recent&limit= — refs only (no bodies). SP1 supports by=recent.
searchRouter.get("/notes", limiter, (req: Request, res: Response) => {
  if (req.apiUser && !requireScope(req, res, "read")) return;
  const uid = resolveUserId(req, res);
  if (!uid) return;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  res.json({ notes: listNoteRefs(uid, limit) });
});
