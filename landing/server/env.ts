/**
 * Environment configuration & validation.
 *
 * All runtime configuration is read from environment variables (12-factor).
 * Secrets are NEVER hard-coded. In development a `.env` file is loaded; in
 * production the host is expected to inject real env vars. Boot fails loudly
 * if a required secret is missing or weak, so a misconfigured server never
 * silently starts in an insecure state.
 */
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import crypto from "node:crypto";

loadDotenv();

const isProd = process.env.NODE_ENV === "production";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),

  /** Public origin the browser uses to reach the app, e.g. https://noto.app */
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),

  /** SQLite file path. Swap the data layer for Postgres by setting DATABASE_URL. */
  DATABASE_PATH: z.string().default("./server/data/noto.sqlite"),
  DATABASE_URL: z.string().optional(),

  /**
   * Secret used to sign session cookies (HMAC). Must be long & random.
   * Generate with: node -e "console.log(crypto.randomBytes(32).toString('hex'))"
   */
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters")
    .optional(),

  SESSION_COOKIE_NAME: z.string().default("noto_session"),
  /** Session lifetime in days. */
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /** Google OAuth — optional; the button is inert until these are provided. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),

  /** GitHub App connector — optional; the feature returns 503 until these are set. */
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),   // PEM (with literal \n or real newlines)
  GITHUB_APP_SLUG: z.string().optional(),          // for the install URL
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_REDIRECT_URI: z.string().url().optional(),
  /** Notion OAuth connector — optional (wired in P5). */
  NOTION_CLIENT_ID: z.string().optional(),
  NOTION_CLIENT_SECRET: z.string().optional(),
  NOTION_REDIRECT_URI: z.string().url().optional(),

  /**
   * OpenAI — optional; the authenticated AI features (chat, summarize,
   * flashcards, find-links, lecture transcription) return a clear 503 until
   * this is set. Never sent to the browser; all AI calls are server-side.
   */
  OPENAI_API_KEY: z.string().optional(),

  /** Cache lifetime for AI responses. Entries expire after this many days. */
  AI_CACHE_TTL_DAYS: z.coerce.number().int().positive().default(7),

  /**
   * 32-byte base64 master key used to encrypt per-vault AI API keys at rest
   * (AES-256-GCM). Optional: when unset, per-vault BYO keys are disabled and
   * the AI falls back to OPENAI_API_KEY. Generate with:
   *   node -e "console.log(crypto.randomBytes(32).toString('base64'))"
   */
  VAULT_KEY_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment configuration:");
  console.error(z.treeifyError(parsed.error));
  process.exit(1);
}

const raw = parsed.data;

// In production a real, externally-provided secret is mandatory. In dev we
// derive an ephemeral one so the app runs out of the box (sessions reset on
// restart, which is fine locally and never happens in prod).
let sessionSecret = raw.SESSION_SECRET;
if (!sessionSecret) {
  if (isProd) {
    console.error("❌ SESSION_SECRET is required in production. Refusing to start.");
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(32).toString("hex");
  console.warn(
    "⚠️  SESSION_SECRET not set — using an ephemeral dev secret (sessions reset on restart).",
  );
}

export const env = {
  ...raw,
  isProd,
  SESSION_SECRET: sessionSecret,
  googleConfigured: Boolean(
    raw.GOOGLE_CLIENT_ID && raw.GOOGLE_CLIENT_SECRET && raw.GOOGLE_REDIRECT_URI,
  ),
  openaiConfigured: Boolean(raw.OPENAI_API_KEY),
  githubConfigured: Boolean(
    raw.GITHUB_APP_ID && raw.GITHUB_APP_PRIVATE_KEY && raw.GITHUB_CLIENT_ID && raw.GITHUB_CLIENT_SECRET && raw.GITHUB_REDIRECT_URI,
  ),
  notionConfigured: Boolean(raw.NOTION_CLIENT_ID && raw.NOTION_CLIENT_SECRET && raw.NOTION_REDIRECT_URI),
  aiCacheTtlSeconds: raw.AI_CACHE_TTL_DAYS * 24 * 60 * 60,
} as const;

export type Env = typeof env;
