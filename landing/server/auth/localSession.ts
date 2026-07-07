/**
 * Local-first session provisioning.
 *
 * Noto has no accounts: every browser request is transparently attached to a
 * single local-owner user. This mirrors what the old `/api/auth/guest` route
 * did on demand, except it now happens automatically for any request that
 * doesn't already carry a valid session cookie, so there is no visible
 * sign-in step. PAT-authenticated requests (MCP/CLI clients) are unaffected —
 * they carry no cookies and never go through session/CSRF at all.
 */
import type { Request, Response, NextFunction } from "express";
import { ensureLocalOwner } from "../db.ts";
import { createSession, getCurrentUser } from "./session.ts";

export function ensureLocalSession(req: Request, res: Response, next: NextFunction): void {
  if (!req.apiUser && !getCurrentUser(req)) {
    const owner = ensureLocalOwner();
    createSession(req, res, owner.id);
  }
  next();
}
