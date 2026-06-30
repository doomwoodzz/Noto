// Regression: a pre-icon/color `vaults` table must upgrade cleanly on boot.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir = "";
let dbPath = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "noto-vmig-"));
  dbPath = join(dir, "old.sqlite");
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
    CREATE TABLE vaults (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    INSERT INTO vaults (id, user_id, name, created_at, updated_at)
      VALUES ('v1', 'u1', 'Legacy Vault', 1000, 1000);
  `);
  seed.close();

  vi.resetModules();
  vi.stubEnv("DATABASE_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

it("adds icon/color to a legacy vaults table and lists them as null", async () => {
  const mod = await import("./db.ts");
  const cols = mod.db.prepare("PRAGMA table_info(vaults)").all() as Array<{ name: string }>;
  expect(cols.map((c) => c.name)).toEqual(expect.arrayContaining(["icon", "color"]));

  const vaults = mod.getVaultsForUser("u1");
  expect(vaults).toEqual([{ id: "v1", name: "Legacy Vault", icon: null, color: null }]);
});

it("stores and reads back per-vault AI config (cipher round-trips by handle)", async () => {
  const mod = await import("./db.ts");
  // Reuse the seeded legacy vault v1 / user u1 from beforeEach.
  mod.setVaultAI("v1", { provider: "openai", model: "gpt-4o-mini", apiKeyCipher: new Uint8Array([1, 2, 3]) });

  const row = mod.getVaultAIRow("v1");
  expect(row?.provider).toBe("openai");
  expect(row?.model).toBe("gpt-4o-mini");
  expect(Array.from(row!.api_key_cipher!)).toEqual([1, 2, 3]);

  const pub = mod.getVaultAIPublic("v1");
  expect(pub).toEqual({ provider: "openai", model: "gpt-4o-mini", configured: true });
  expect((pub as Record<string, unknown>).apiKey).toBeUndefined();

  // Upsert: omitting apiKeyCipher leaves the stored key untouched.
  mod.setVaultAI("v1", { provider: "openai", model: "gpt-4o" });
  const updated = mod.getVaultAIRow("v1")!;
  expect(Array.from(updated.api_key_cipher!)).toEqual([1, 2, 3]);
  expect(updated.model).toBe("gpt-4o");

  // Clearing the key explicitly.
  mod.setVaultAI("v1", { provider: "openai", model: "gpt-4o", apiKeyCipher: null });
  expect(mod.getVaultAIRow("v1")!.api_key_cipher).toBeNull();
  expect(mod.getVaultAIPublic("v1")).toEqual({ provider: "openai", model: "gpt-4o", configured: false });
});
