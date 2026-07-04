/**
 * Connector management — list + disconnect linked source connectors (GitHub, Notion).
 *
 * Cookie-session ONLY (browser-first; never PAT/MCP-reachable). The OAuth/App
 * install + callback flows live on authRouter (auth/github.ts, auth/notion.ts);
 * this router only reads and revokes the resulting connector_tokens rows.
 */
import express, { type Request, type Response } from "express";
import { getCurrentUser } from "../auth/session.ts";
import { listConnectors, deleteConnector } from "../db.ts";

export const connectorsRouter = express.Router();

const PROVIDERS = new Set(["github", "notion"]);

// Cookie-session ONLY. Connectors are never reachable via PAT/MCP. (Mirrors dump/routes.ts.)
function cookieUser(req: Request, res: Response): string | null {
  if (req.apiUser) { res.status(403).json({ error: "Connectors are not available via API tokens" }); return null; }
  const user = getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return user.id;
}

interface PublicConnector { provider: string; externalAccount: string | null; connectedAt: number }

connectorsRouter.get("/", (req: Request, res: Response) => {
  const uid = cookieUser(req, res); if (!uid) return;
  const out: PublicConnector[] = listConnectors(uid).map((c) => ({
    provider: c.provider,
    externalAccount: c.external_account,
    connectedAt: c.created_at,
  }));
  res.json(out);
});

connectorsRouter.delete("/:provider", (req: Request, res: Response) => {
  const uid = cookieUser(req, res); if (!uid) return;
  const provider = req.params.provider as string;
  if (!PROVIDERS.has(provider)) { res.status(400).json({ error: "Unknown connector" }); return; }
  // This endpoint only revokes the stored token. Purging notes derived from the
  // source is offered separately in the UI disconnect flow (07-ui-client.md), which
  // calls DELETE /api/dump/jobs/:id?purgeNotes=1 for the user's dumps from this source.
  deleteConnector(uid, provider as "github" | "notion");
  res.status(204).end();
});
