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

  /**
   * OpenAI — optional; the authenticated AI features (chat, summarize,
   * flashcards, find-links, lecture transcription) return a clear 503 until
   * this is set. Never sent to the browser; all AI calls are server-side.
   */
  OPENAI_API_KEY: z.string().optional(),
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
} as const;

export type Env = typeof env;
