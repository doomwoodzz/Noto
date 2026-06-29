// server/auth/pat.ts
import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { usePat } from "../db.ts";

export const PAT_PREFIX = "noto_pat_";
export type Scope = "read" | "write" | "destructive" | "memory";

export function hashPatToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Generate a fresh plaintext PAT (256 bits of entropy). */
export function generatePatToken(): string {
  return PAT_PREFIX + crypto.randomBytes(32).toString("base64url");
}

/**
 * If a valid `Authorization: Bearer noto_pat_...` is present, resolve it to
 * `req.apiUser`. Always calls next(); authorization is enforced per-route.
 * Mounted BEFORE csrfProtection — PAT requests carry no cookie, so CSRF (a
 * browser-cookie defence) does not apply to them.
 */
export function resolveApiToken(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token.startsWith(PAT_PREFIX)) {
      // usePat is a DB accessor (look up + touch a Personal Access Token), not a
      // React hook — the `use` prefix trips the react-hooks lint rule here.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const row = usePat(hashPatToken(token));
      if (row) {
        req.apiUser = {
          userId: row.user_id,
          scopes: row.scopes.split(",").filter(Boolean),
          tokenId: row.id,
        };
      }
    }
  }
  next();
}

/** 401 unless the request is authenticated by a PAT. Returns the apiUser. */
export function requireApiUser(req: Request, res: Response): Request["apiUser"] | null {
  if (!req.apiUser) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return req.apiUser;
}

/** 403 unless the PAT carries `scope`. Call after requireApiUser. */
export function requireScope(req: Request, res: Response, scope: Scope): boolean {
  if (!req.apiUser?.scopes.includes(scope)) {
    res.status(403).json({ error: `Token missing '${scope}' scope` });
    return false;
  }
  return true;
}
