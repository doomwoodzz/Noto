// server/tokens/routes.ts
import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getCurrentUser } from "../auth/session.ts";
import { createPat, listPatsForUser, revokePat } from "../db.ts";
import { generatePatToken, hashPatToken } from "../auth/pat.ts";

export const tokensRouter = Router();
const jsonBody = express.json({ limit: "8kb" });

const mintSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(["read", "write", "destructive", "memory"])).min(1).max(4),
});

function userId(req: Request, res: Response): string | null {
  const u = getCurrentUser(req);
  if (!u) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return u.id;
}

// Mint: returns the plaintext token ONCE; only the hash is stored.
tokensRouter.post("/", jsonBody, (req: Request, res: Response) => {
  const uid = userId(req, res);
  if (!uid) return;
  const parsed = mintSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid token request" });
    return;
  }
  const token = generatePatToken();
  const row = createPat({
    tokenHash: hashPatToken(token),
    userId: uid,
    name: parsed.data.name,
    scopes: parsed.data.scopes,
  });
  res.status(201).json({ id: row.id, token, name: row.name, scopes: parsed.data.scopes });
});

tokensRouter.get("/", (req: Request, res: Response) => {
  const uid = userId(req, res);
  if (!uid) return;
  const tokens = listPatsForUser(uid).map((t) => ({
    id: t.id,
    name: t.name,
    scopes: t.scopes.split(",").filter(Boolean),
    createdAt: t.created_at,
    lastUsedAt: t.last_used_at,
  }));
  res.json({ tokens });
});

tokensRouter.delete("/:id", (req: Request, res: Response) => {
  const uid = userId(req, res);
  if (!uid) return;
  if (!revokePat(uid, req.params.id as string)) {
    res.status(404).json({ error: "Token not found" });
    return;
  }
  res.status(204).end();
});
