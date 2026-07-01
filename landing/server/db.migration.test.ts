// Regression: booting against a pre-`token_hash` dev database must not crash.
// Early dev DBs have a `pat_tokens` table without the `token_hash` column; the
// boot-time `CREATE INDEX ... ON pat_tokens(token_hash)` used to throw and take
// the whole API server down (every /api call then 502s → "Something went wrong").
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir = "";
let dbPath = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "noto-mig-"));
  dbPath = join(dir, "old.sqlite");
  // Seed the legacy schema: pat_tokens WITHOUT token_hash, where `id` itself
  // was the sha256(token) verifier. Include a matching user so the FK holds.
  const seed = new DatabaseSync(dbPath);
  seed.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT,
      google_sub TEXT UNIQUE, display_name TEXT, avatar_url TEXT,
      theme TEXT NOT NULL DEFAULT 'light', email_verified INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    INSERT INTO users (id, email, theme, email_verified, created_at, updated_at)
      VALUES ('u1', 'a@b.c', 'light', 0, 1, 1);
    CREATE TABLE pat_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, scopes TEXT NOT NULL, created_at INTEGER NOT NULL,
      last_used_at INTEGER, revoked_at INTEGER
    );
    INSERT INTO pat_tokens (id, user_id, name, scopes, created_at)
      VALUES ('oldhash123', 'u1', 'my token', 'read,write', 1000);
  `);
  seed.close();

  vi.resetModules(); // force db.ts to re-run its boot migrations against our file
  vi.stubEnv("DATABASE_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

it("upgrades a pre-token_hash pat_tokens table without crashing, preserving tokens", async () => {
  // Importing db.ts runs the boot schema + migrations. This used to throw.
  const mod = await import("./db.ts");

  const cols = mod.db.prepare("PRAGMA table_info(pat_tokens)").all() as Array<{ name: string }>;
  expect(cols.map((c) => c.name)).toContain("token_hash");

  // The legacy `id` (the sha256 verifier) is carried over as token_hash under a
  // fresh uuid handle, so previously-minted tokens keep verifying.
  const row = mod.db.prepare("SELECT id, token_hash, name FROM pat_tokens").get() as {
    id: string;
    token_hash: string;
    name: string;
  };
  expect(row.token_hash).toBe("oldhash123");
  expect(row.name).toBe("my token");
  expect(row.id).not.toBe("oldhash123"); // new opaque uuid handle
});
