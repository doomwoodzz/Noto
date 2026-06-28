import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { getCurrentUser } from "../auth/session.ts";
import { listActivity } from "../db.ts";
import { toActivityEntry } from "./activity.ts";

export const activityRouter = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests." },
});

/** The activity/trust surface is human-only: a PAT must never browse or revert. */
function requireCookieUser(req: Request, res: Response): string | null {
  if (req.apiUser) {
    res.status(403).json({ error: "Use the Noto app to view AI activity" });
    return null;
  }
  const user = getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return user.id;
}

activityRouter.get("/", limiter, (req: Request, res: Response) => {
  const uid = requireCookieUser(req, res);
  if (!uid) return;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const beforeNum = Number(req.query.before);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const rows = listActivity(uid, {
    tool: str(req.query.tool),
    source: str(req.query.source),
    fileId: str(req.query.fileId),
    before: Number.isFinite(beforeNum) && beforeNum > 0 ? beforeNum : undefined,
    limit,
  });
  res.json({ activity: rows.map(toActivityEntry) });
});
