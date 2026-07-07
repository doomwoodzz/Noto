/**
 * Noto application factory.
 *
 * Builds the Express app (security headers, rate limits, CSRF, routes, static
 * frontend) without binding a port, so it can be reused by the real entrypoint
 * (server/index.ts) and by integration tests.
 *
 * In production this single app serves both the built static frontend
 * (landing/dist) and the /api/* JSON API from the same origin — so cookies are
 * first-party and there is no CORS surface. In development the Vite dev server
 * (5173) proxies /api to this process (8787); see vite.config.ts.
 */
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { parse as parseCookie } from "cookie";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { env } from "./env.ts";
import { authRouter } from "./auth/routes.ts";
import { notesRouter } from "./notes/routes.ts";
import { aiRouter } from "./ai/routes.ts";
import { dumpRouter } from "./dump/routes.ts";
import { connectorsRouter } from "./connectors/routes.ts";
import { linksRouter } from "./links/routes.ts";
import { ensureCsrfCookie, csrfProtection } from "./auth/csrf.ts";
import { resolveApiToken } from "./auth/pat.ts";
import { ensureLocalSession } from "./auth/localSession.ts";
import { tokensRouter } from "./tokens/routes.ts";
import { memoryRouter } from "./memory/routes.ts";
import { searchRouter } from "./search/routes.ts";
import { activityRouter } from "./audit/routes.ts";
import { mountMcp } from "./mcp/routes.ts";

export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy (Render/Fly/Nginx) so req.ip and Secure cookies work.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  /* ------------------------------ security headers ----------------------- */
  // Helmet sets a strict baseline: HSTS, X-Content-Type-Options, frameguard
  // (clickjacking), Referrer-Policy, and a Content-Security-Policy. The CSP
  // allows the Google Fonts the design uses and (dev only) Vite's HMR websocket.
  // 'wasm-unsafe-eval' lets the in-browser embedding model (onnxruntime-web)
  // compile its WASM. It permits WebAssembly only — not arbitrary eval/new Function.
  const scriptSrc = ["'self'", "'wasm-unsafe-eval'"];
  const connectSrc = [
    "'self'",
    "https://github.com",
    "https://api.github.com",
    "https://api.notion.com",
  ];
  if (!env.isProd) {
    connectSrc.push("ws:", "http://localhost:5173");
  }
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc,
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:"],
          connectSrc,
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          objectSrc: ["'none'"],
        },
      },
      // HSTS only meaningful over HTTPS; enabled in production.
      hsts: env.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  /* ------------------------------ global limiter ------------------------- */
  // Generous app-wide ceiling (debounced autosave is chatty). Sensitive
  // credential endpoints carry their own much stricter limiter (auth/routes).
  app.use(
    "/api",
    rateLimit({
      windowMs: 60 * 1000,
      limit: 600,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many requests." },
    }),
  );

  /* --------------------------------- cookies ----------------------------- */
  // Body parsing is per-router (auth: tiny cap; notes: larger cap) so a small
  // global cap can't truncate legitimate note payloads.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.cookies = req.headers.cookie ? parseCookie(req.headers.cookie) : {};
    next();
  });

  app.use("/api", resolveApiToken); // resolve bearer PAT → req.apiUser (before CSRF)
  app.use("/api", ensureLocalSession); // no accounts: auto-attach the local owner

  /* --------------------------------- CSRF -------------------------------- */
  // Issue a CSRF cookie for any browser hitting the API, then enforce the
  // double-submit check on every state-changing API request.
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    ensureCsrfCookie(req, res);
    next();
  });
  app.use("/api", csrfProtection);

  /* --------------------------------- routes ------------------------------ */
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, aiConfigured: env.openaiConfigured });
  });
  app.use("/api/auth", authRouter);
  app.use("/api", notesRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/dump", dumpRouter);          // P1
  app.use("/api/connectors", connectorsRouter); // P4
  app.use("/api/links", linksRouter);
  app.use("/api/tokens", tokensRouter);
  app.use("/api/memory", memoryRouter);
  app.use("/api", searchRouter);
  app.use("/api/activity", activityRouter);

  // Remote MCP: a stateless Streamable-HTTP shell that replays each tool call
  // in-process through the /api stack above (bearer PAT, no CSRF/cookies).
  mountMcp(app);

  /* ----------------------------- static frontend ------------------------- */
  // In production, serve the Vite build. In dev, Vite owns the frontend and
  // proxies here, so this block is skipped.
  const distDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
  const indexHtml = join(distDir, "index.html");
  if (env.isProd && existsSync(distDir)) {
    app.use(express.static(distDir, { index: false, maxAge: "1h" }));
    // Fallback to the matching multi-page html entry. The candidate path is
    // resolved and confirmed to stay inside distDir before serving, so a crafted
    // request can never escape the build directory (path-traversal defence).
    app.get(/^\/(?!api\/).*/, (req: Request, res: Response) => {
      const rel =
        req.path === "/" ? "index.html" : req.path.endsWith(".html") ? req.path : `${req.path}.html`;
      const candidate = resolve(distDir, "." + (rel.startsWith("/") ? rel : `/${rel}`));
      const safe = candidate === distDir || candidate.startsWith(distDir + sep);
      res.sendFile(safe && existsSync(candidate) ? candidate : indexHtml);
    });
  }

  /* ----------------------------- error handler --------------------------- */
  // Never leak stack traces or internal messages to clients. The 4-arg
  // signature is required for Express to treat this as an error handler.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
