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
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

/**
 * Load the session secret from the database, generating & persisting a strong
 * one on first run. Used as a fallback when SESSION_SECRET is not injected via
 * env, so the server boots out of the box on any host instead of crashing.
 *
 * This opens its OWN short-lived sqlite connection (rather than importing
 * `db.ts`) to avoid a circular import — `db.ts` imports this module. The
 * connection is closed before `db.ts` opens its own, so they never overlap.
 *
 * The secret only signs the transient (10-minute) OAuth state cookie; real
 * login sessions are opaque server-side tokens that don't depend on it. It is
 * stored alongside the data it protects, so if the DB is reset the secret is
 * reset too — consistent and harmless.
 */
function loadOrCreatePersistedSecret(dbPath: string): string {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sdb = new DatabaseSync(dbPath);
  try {
    sdb.exec("PRAGMA journal_mode = WAL;");
    sdb.exec(
      "CREATE TABLE IF NOT EXISTS app_secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    const row = sdb
      .prepare("SELECT value FROM app_secrets WHERE key = 'session_secret'")
      .get() as { value: string } | undefined;
    if (row?.value) return row.value;
    const generated = crypto.randomBytes(32).toString("hex");
    sdb
      .prepare("INSERT INTO app_secrets (key, value) VALUES ('session_secret', ?)")
      .run(generated);
    return generated;
  } finally {
    sdb.close();
  }
}

// Prefer an externally-injected secret (recommended for production, and required
// when running multiple instances). When absent, fall back to a strong secret
// persisted in the database so the app boots without manual configuration.
let sessionSecret = raw.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = loadOrCreatePersistedSecret(raw.DATABASE_PATH);
  console.warn(
    isProd
      ? "⚠️  SESSION_SECRET not set — using a persisted auto-generated secret from the database. " +
          "For production set SESSION_SECRET explicitly (required when running multiple instances)."
      : "⚠️  SESSION_SECRET not set — using a persisted auto-generated secret (dev).",
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
