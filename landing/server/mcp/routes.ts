import express, { type Express, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { resolveApiToken, requireApiUser } from "../auth/pat.ts";
import { env } from "../env.ts";
import { makeLoopbackClient } from "./bridge.ts";
import { buildMcpServer } from "./server.ts";

const mcpLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many requests." },
});
const jsonBody = express.json({ limit: "512kb" });

/** Mount the stateless remote MCP endpoint. Each POST gets a fresh server+transport. */
export function mountMcp(app: Express): void {
  app.post("/mcp", resolveApiToken, mcpLimiter, jsonBody, async (req: Request, res: Response) => {
    if (!requireApiUser(req, res)) return; // 401 if absent/invalid PAT
    const token = req.get("authorization") ?? "";               // verbatim "Bearer noto_pat_…"
    const client = (req.get("x-noto-client") || "remote").slice(0, 40);
    const scope = (req.get("x-noto-scope") || "global").slice(0, 200);

    // Each tool call loops back over 127.0.0.1 into this app's own /api stack, so
    // every SP1–SP3 guard is reused. localPort is the port this connection is
    // served on (correct for port-0 tests and prod alike); fall back to env.PORT.
    const port = req.socket.localPort ?? env.PORT;
    const baseUrl = `http://127.0.0.1:${port}`;

    const server = buildMcpServer(makeLoopbackClient(baseUrl, { token, client }), { scope });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: "MCP error" });
    }
  });

  // Stateless: no server→client GET stream, no session DELETE.
  app.all("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({ error: "Method not allowed (stateless /mcp accepts POST only)" });
  });
}
