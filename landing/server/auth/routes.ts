/**
 * Auth API routes.
 *
 * Noto has no accounts — every request is already attached to the single
 * local owner by the time it reaches these routes (see auth/localSession.ts).
 * What's left here is theme preference and the connector OAuth flows (GitHub
 * App / Notion), which link external services to that one local user.
 */
import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import { ensureLocalOwner, setUserTheme, toPublicUser } from "../db.ts";
import { getCurrentUser } from "./session.ts";
import { startGithubInstall, handleGithubCallback } from "./github.ts";
import { startNotionInstall, handleNotionCallback } from "./notion.ts";

export const authRouter = Router();

authRouter.use(express.json({ limit: "16kb" }));

authRouter.get("/me", (req: Request, res: Response) => {
  // Session-cookie callers were provisioned by ensureLocalSession; PAT callers
  // carry no cookie, so fall through to the owner directly — with exactly one
  // user, both resolve to the same row.
  const user = getCurrentUser(req) ?? ensureLocalOwner();
  res.json({ user: toPublicUser(user) });
});

const prefsSchema = z.object({ theme: z.enum(["light", "dark"]) });

authRouter.patch("/preferences", (req: Request, res: Response) => {
  const user = getCurrentUser(req) ?? ensureLocalOwner();
  const parsed = prefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid preferences" });
    return;
  }
  setUserTheme(user.id, parsed.data.theme);
  res.json({ ok: true });
});

/* ------------------------------ GitHub App ----------------------------- */
authRouter.get("/github/install", startGithubInstall);
authRouter.get("/github/callback", handleGithubCallback);

/* ------------------------------ Notion OAuth --------------------------- */
authRouter.get("/notion/install", startNotionInstall);
authRouter.get("/notion/callback", handleNotionCallback);
