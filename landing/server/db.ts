/**
 * Data layer.
 *
 * Uses Node's built-in `node:sqlite` (zero native build steps, ships with
 * Node 22+). The repository functions below are the ONLY place SQL lives, so
 * swapping to Postgres later means re-implementing this one module against a
 * `DATABASE_URL` — nothing else in the app touches the database directly.
 *
 * Every query is parameterised (prepared statements) — there is no string
 * interpolation of user input anywhere, which structurally rules out SQL
 * injection.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import crypto from "node:crypto";
import { env } from "./env.ts";
import type { DumpJobRow, DumpItemRow, DumpSourceRow, ConnectorTokenRow, DumpStatus, DumpItemStatus, DumpCounts } from "./dump/types.ts";
import type { PersistedEdge } from "../src/noto-core/graphEdges.ts";

mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });

const db = new DatabaseSync(env.DATABASE_PATH);

// Pragmas: WAL for concurrency, foreign keys on for referential integrity.
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    display_name TEXT,
    avatar_url   TEXT,
    theme        TEXT NOT NULL DEFAULT 'light',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,               -- sha256(opaque token)
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    user_agent  TEXT,
    ip          TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS vaults (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    icon        TEXT,
    color       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_vaults_user ON vaults(user_id);

  CREATE TABLE IF NOT EXISTS vault_ai (
    vault_id       TEXT PRIMARY KEY REFERENCES vaults(id) ON DELETE CASCADE,
    provider       TEXT NOT NULL DEFAULT 'openai',
    model          TEXT,
    api_key_cipher BLOB,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS files (
    id          TEXT PRIMARY KEY,
    vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    path        TEXT NOT NULL,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    pinned      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_files_vault ON files(vault_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_files_vault_path ON files(vault_id, path);

  CREATE TABLE IF NOT EXISTS pat_tokens (
    id            TEXT PRIMARY KEY,            -- opaque UUID handle (safe to expose)
    token_hash    TEXT NOT NULL UNIQUE,        -- sha256(plaintext token); the verifier
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    scopes        TEXT NOT NULL,               -- comma-separated: read,write,destructive
    created_at    INTEGER NOT NULL,
    last_used_at  INTEGER,
    revoked_at    INTEGER
  );
  -- pat_tokens indexes are created after the token_hash migration below, so an
  -- older DB whose pat_tokens predates that column can be rebuilt first.

  CREATE TABLE IF NOT EXISTS audit_log (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id     TEXT,
    tool         TEXT NOT NULL,
    target       TEXT,
    before_hash  TEXT,
    after_hash   TEXT,                  -- sha256 of post-write content (note edits)
    source_client TEXT,                 -- claude-code | cursor | codex | web
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);

  CREATE TABLE IF NOT EXISTS audit_snapshots (
    audit_id TEXT PRIMARY KEY REFERENCES audit_log(id) ON DELETE CASCADE,
    content  TEXT NOT NULL              -- full pre-edit file content (append/update_section)
  );

  CREATE TABLE IF NOT EXISTS memories (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text           TEXT NOT NULL,
    type           TEXT NOT NULL DEFAULT 'fact',
    scope          TEXT NOT NULL,
    source_client  TEXT NOT NULL DEFAULT 'web',
    norm_text      TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    last_used_at   INTEGER NOT NULL,
    use_count      INTEGER NOT NULL DEFAULT 1,
    status         TEXT NOT NULL DEFAULT 'active',
    supersedes_id  TEXT,
    embedding      BLOB
  );

  CREATE TABLE IF NOT EXISTS note_passages (
    id           TEXT PRIMARY KEY,                       -- 'fileId#index'
    file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    idx          INTEGER NOT NULL,
    heading_path TEXT NOT NULL,                          -- JSON string[]
    text         TEXT NOT NULL,
    char_start   INTEGER NOT NULL,
    embedding    BLOB
  );
  CREATE INDEX IF NOT EXISTS idx_passages_file ON note_passages(file_id);

  CREATE TABLE IF NOT EXISTS note_graph_state (
    file_id       TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    vault_id      TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    content_hash  TEXT NOT NULL,
    well_linked   INTEGER NOT NULL,
    community     INTEGER,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_graph_state_vault ON note_graph_state(vault_id);

  -- source_id/target_id have no FK: target_id may be a synthetic 'tag:<name>'
  -- node that has no row in files (tagged_with edges point at tags, not notes).
  CREATE TABLE IF NOT EXISTS note_edges (
    id                TEXT PRIMARY KEY,
    vault_id          TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    source_id         TEXT NOT NULL,
    target_id         TEXT NOT NULL,
    relation          TEXT NOT NULL,
    confidence        TEXT NOT NULL,
    confidence_score  REAL NOT NULL,
    updated_at        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_note_edges_vault ON note_edges(vault_id);
  CREATE INDEX IF NOT EXISTS idx_note_edges_source ON note_edges(vault_id, source_id);
  CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(user_id, scope, status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_dedup ON memories(user_id, scope, norm_text) WHERE status = 'active';

  CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(memory_id UNINDEXED, text);

  CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(memory_id, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    DELETE FROM memories_fts WHERE memory_id = old.id;
  END;
  CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF text ON memories BEGIN
    DELETE FROM memories_fts WHERE memory_id = old.id;
    INSERT INTO memories_fts(memory_id, text) VALUES (new.id, new.text);
  END;

  CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(file_id UNINDEXED, vault_id UNINDEXED, title, content);

  CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
    INSERT INTO files_fts(file_id, vault_id, title, content) VALUES (new.id, new.vault_id, new.title, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
    DELETE FROM files_fts WHERE file_id = old.id;
  END;
  CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE OF title, content ON files BEGIN
    DELETE FROM files_fts WHERE file_id = old.id;
    INSERT INTO files_fts(file_id, vault_id, title, content) VALUES (new.id, new.vault_id, new.title, new.content);
  END;

  CREATE TABLE IF NOT EXISTS ai_response_cache (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    content_hash   TEXT    NOT NULL UNIQUE,
    note_hash      TEXT,
    question_embed BLOB,
    feature        TEXT    NOT NULL,
    response       TEXT    NOT NULL,
    input_tokens   INTEGER NOT NULL,
    output_tokens  INTEGER NOT NULL,
    hit_count      INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ai_response_cache_note
    ON ai_response_cache(note_hash);
  CREATE INDEX IF NOT EXISTS ai_response_cache_feature
    ON ai_response_cache(feature);
`);

// Additive migration: collapse multi-tenant accounts into a single local owner.
// Older DBs had password_hash/google_sub/email columns (removed — login no longer
// exists). Any existing user rows (e.g. dev guest accounts) are merged onto one
// surviving id first so their vaults/tokens/etc. are preserved, then the table is
// rebuilt without the auth-only columns.
{
  const cols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === "password_hash")) {
    // vaults/sessions/pat_tokens/audit_log/memories/dump_jobs/dump_sources/
    // connector_tokens all declare `REFERENCES users(id)`, so with FK enforcement
    // on (the boot pragma above), `DROP TABLE users` below would fail with
    // "FOREIGN KEY constraint failed" even inside a transaction — SQLite only
    // honors `PRAGMA foreign_keys` when toggled outside any transaction, so it
    // must be flipped off before BEGIN and restored after, in a `finally` so a
    // thrown error can't leave the connection permanently unenforced.
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      const existing = db
        .prepare(
          "SELECT id, display_name, avatar_url, theme, created_at, updated_at FROM users ORDER BY created_at ASC",
        )
        .all() as Array<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        theme: string;
        created_at: number;
        updated_at: number;
      }>;

      db.exec(`
        CREATE TABLE users_new (
          id           TEXT PRIMARY KEY,
          display_name TEXT,
          avatar_url   TEXT,
          theme        TEXT NOT NULL DEFAULT 'light',
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL
        )
      `);

      if (existing.length > 0) {
        const owner = existing[0];
        db.prepare(
          "INSERT INTO users_new (id, display_name, avatar_url, theme, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(owner.id, owner.display_name, owner.avatar_url, owner.theme, owner.created_at, owner.updated_at);

        // Re-point every other pre-existing user's rows onto the surviving owner id.
        for (const row of existing.slice(1)) {
          db.prepare("UPDATE vaults SET user_id = ? WHERE user_id = ?").run(owner.id, row.id);
          db.prepare("UPDATE pat_tokens SET user_id = ? WHERE user_id = ?").run(owner.id, row.id);
          db.prepare("UPDATE audit_log SET user_id = ? WHERE user_id = ?").run(owner.id, row.id);
          db.prepare("UPDATE memories SET user_id = ? WHERE user_id = ?").run(owner.id, row.id);
          db.prepare("UPDATE dump_jobs SET user_id = ? WHERE user_id = ?").run(owner.id, row.id);
          // connector_tokens has UNIQUE (user_id, provider); dump_sources has PK
          // (user_id, vault_id, source_key). If the merged-away user and the
          // surviving owner both already have a row for the same key, a plain
          // UPDATE would violate the constraint. OR IGNORE keeps the owner's
          // existing row and silently drops the update for the colliding row,
          // so the leftover (still user_id = row.id) duplicate is deleted below.
          db.prepare("UPDATE OR IGNORE dump_sources SET user_id = ? WHERE user_id = ?").run(owner.id, row.id);
          db.prepare("DELETE FROM dump_sources WHERE user_id = ?").run(row.id);
          db.prepare("UPDATE OR IGNORE connector_tokens SET user_id = ? WHERE user_id = ?").run(owner.id, row.id);
          db.prepare("DELETE FROM connector_tokens WHERE user_id = ?").run(row.id);
          db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);
        }
      }

      db.exec("DROP TABLE users");
      db.exec("ALTER TABLE users_new RENAME TO users");
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }
}

// Additive migration: older databases predate the `pinned` column. Add it once
// if missing (CREATE TABLE IF NOT EXISTS above never alters an existing table).
{
  const cols = db.prepare("PRAGMA table_info(files)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "pinned")) {
    db.exec("ALTER TABLE files ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  }
}

// Additive migration: vault icon/color (multi-vault switcher). Older DBs predate
// these columns; CREATE TABLE IF NOT EXISTS never alters an existing table.
{
  const cols = db.prepare("PRAGMA table_info(vaults)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "icon")) {
    db.exec("ALTER TABLE vaults ADD COLUMN icon TEXT");
  }
  if (!cols.some((c) => c.name === "color")) {
    db.exec("ALTER TABLE vaults ADD COLUMN color TEXT");
  }
}

// Additive migration: SP3 provenance. Older databases predate these columns.
{
  const cols = db.prepare("PRAGMA table_info(audit_log)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "after_hash")) {
    db.exec("ALTER TABLE audit_log ADD COLUMN after_hash TEXT");
  }
  if (!cols.some((c) => c.name === "source_client")) {
    db.exec("ALTER TABLE audit_log ADD COLUMN source_client TEXT");
  }
}

// Additive migration: SP5a semantic memory. Older DBs predate the embedding column.
{
  const cols = db.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "embedding")) {
    db.exec("ALTER TABLE memories ADD COLUMN embedding BLOB");
  }
}

// Additive migration: PAT token_hash. The pre-redesign dev schema stored
// sha256(token) directly in `id` and had no `token_hash` column; SQLite can't
// add a NOT NULL UNIQUE column to an existing table, so rebuild. The old `id`
// (the verifier) is carried over as `token_hash` under a fresh uuid handle so
// any already-minted tokens keep working. Runs before the indexes below.
{
  const cols = db.prepare("PRAGMA table_info(pat_tokens)").all() as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some((c) => c.name === "token_hash")) {
    db.exec("BEGIN");
    try {
      const old = db
        .prepare(
          "SELECT id, user_id, name, scopes, created_at, last_used_at, revoked_at FROM pat_tokens",
        )
        .all() as Array<{
        id: string;
        user_id: string;
        name: string;
        scopes: string;
        created_at: number;
        last_used_at: number | null;
        revoked_at: number | null;
      }>;
      db.exec("DROP TABLE pat_tokens");
      db.exec(`
        CREATE TABLE pat_tokens (
          id            TEXT PRIMARY KEY,
          token_hash    TEXT NOT NULL UNIQUE,
          user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name          TEXT NOT NULL,
          scopes        TEXT NOT NULL,
          created_at    INTEGER NOT NULL,
          last_used_at  INTEGER,
          revoked_at    INTEGER
        )
      `);
      const ins = db.prepare(
        "INSERT INTO pat_tokens (id, token_hash, user_id, name, scopes, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const r of old) {
        ins.run(crypto.randomUUID(), r.id, r.user_id, r.name, r.scopes, r.created_at, r.last_used_at, r.revoked_at);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

// pat_tokens indexes (created here so the migration above can rebuild the table
// first on older DBs). Idempotent for fresh DBs.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_pat_user ON pat_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_pat_hash ON pat_tokens(token_hash);
`);

// Dump feature tables (jobs/items/sources + connector OAuth tokens).
db.exec(`
  CREATE TABLE IF NOT EXISTS dump_jobs (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_ref  TEXT NOT NULL,
    source_slug TEXT NOT NULL,
    status      TEXT NOT NULL,
    counts      TEXT NOT NULL DEFAULT '{}',
    error       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_dump_jobs_user ON dump_jobs(user_id, created_at);

  CREATE TABLE IF NOT EXISTS dump_items (
    id              TEXT PRIMARY KEY,
    job_id          TEXT NOT NULL REFERENCES dump_jobs(id) ON DELETE CASCADE,
    source_key      TEXT NOT NULL,
    status          TEXT NOT NULL,
    redaction_count INTEGER NOT NULL DEFAULT 0,
    shaped          TEXT,
    file_id         TEXT,
    dedup_of        TEXT,
    error           TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_dump_items_job ON dump_items(job_id);

  CREATE TABLE IF NOT EXISTS dump_sources (
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vault_id     TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    source_key   TEXT NOT NULL,
    file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    job_id       TEXT,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (user_id, vault_id, source_key)
  );
  CREATE INDEX IF NOT EXISTS idx_dump_sources_file ON dump_sources(file_id);

  CREATE TABLE IF NOT EXISTS connector_tokens (
    id                   TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider             TEXT NOT NULL,
    external_account     TEXT,
    installation_id      TEXT,
    access_token_cipher  BLOB,
    refresh_token_cipher BLOB,
    expires_at           INTEGER,
    scopes               TEXT,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    UNIQUE (user_id, provider)
  );
  CREATE INDEX IF NOT EXISTS idx_connector_tokens_user ON connector_tokens(user_id);
`);

// Additive migration: vault-scope dump_sources. The original schema keyed re-dump
// idempotency on (user_id, source_key) only — vault-independent — so re-dumping the
// same source into a DIFFERENT vault matched the first vault's row and overwrote the
// wrong vault's note (or silently skipped the import). SQLite can't widen a PRIMARY
// KEY in place, so rebuild with (user_id, vault_id, source_key). vault_id is
// backfilled from each source's own file (accurate), falling back to the user's
// first vault; rows whose file and user are both gone are dropped (OR IGNORE).
{
  const cols = db.prepare("PRAGMA table_info(dump_sources)").all() as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some((c) => c.name === "vault_id")) {
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE dump_sources_new (
          user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          vault_id     TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
          source_key   TEXT NOT NULL,
          file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
          content_hash TEXT NOT NULL,
          job_id       TEXT,
          created_at   INTEGER NOT NULL,
          PRIMARY KEY (user_id, vault_id, source_key)
        )
      `);
      db.exec(`
        INSERT OR IGNORE INTO dump_sources_new (user_id, vault_id, source_key, file_id, content_hash, job_id, created_at)
        SELECT ds.user_id,
               COALESCE((SELECT f.vault_id FROM files f WHERE f.id = ds.file_id),
                        (SELECT v.id FROM vaults v WHERE v.user_id = ds.user_id ORDER BY v.created_at LIMIT 1)),
               ds.source_key, ds.file_id, ds.content_hash, ds.job_id, ds.created_at
        FROM dump_sources ds
      `);
      db.exec("DROP TABLE dump_sources");
      db.exec("ALTER TABLE dump_sources_new RENAME TO dump_sources");
      db.exec("CREATE INDEX IF NOT EXISTS idx_dump_sources_file ON dump_sources(file_id)");
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

// O(n) scan on boot; fine for the MAX_FILES_PER_VAULT * MAX_VAULTS_PER_USER ceiling.
// Backfill files_fts for any notes created before the FTS table existed.
{
  const missing = db.prepare(
    "SELECT f.id, f.vault_id, f.title, f.content FROM files f WHERE f.id NOT IN (SELECT file_id FROM files_fts)",
  ).all() as Array<{ id: string; vault_id: string; title: string; content: string }>;
  const ins = db.prepare("INSERT INTO files_fts(file_id, vault_id, title, content) VALUES (?, ?, ?, ?)");
  for (const f of missing) ins.run(f.id, f.vault_id, f.title, f.content);
}

export interface User {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  theme: string;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  user_agent: string | null;
  ip: string | null;
}

/** A user shape that is safe to send to the browser (no secrets — there are none). */
export interface PublicUser {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  theme: string;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    theme: u.theme,
  };
}

const now = () => Date.now();
const newId = () => crypto.randomUUID();

/** Turn arbitrary user text into a safe FTS5 MATCH query: quote each token, OR them, prefix-match. */
export function ftsQuery(raw: string): string {
  const tokens = raw.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"*`).join(" OR ");
}

/* ----------------------------- Users ----------------------------- */

const stmtUserById = db.prepare("SELECT * FROM users WHERE id = ?");
const stmtFirstUser = db.prepare("SELECT * FROM users LIMIT 1");
const stmtInsertOwner = db.prepare(
  "INSERT INTO users (id, display_name, avatar_url, theme, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
);

export function getUserById(id: string): User | undefined {
  return stmtUserById.get(id) as User | undefined;
}

/**
 * Return the single local-owner user, creating it on first boot if absent.
 * There is exactly one user row for the lifetime of a Noto install — see the
 * `users` migration above and `server/auth/localSession.ts`.
 */
export function ensureLocalOwner(): User {
  const existing = stmtFirstUser.get() as User | undefined;
  if (existing) return existing;
  const id = newId();
  const ts = now();
  stmtInsertOwner.run(id, "Local Owner", null, "light", ts, ts);
  return getUserById(id)!;
}

const stmtSetTheme = db.prepare("UPDATE users SET theme = ?, updated_at = ? WHERE id = ?");
export function setUserTheme(id: string, theme: string): void {
  stmtSetTheme.run(theme, now(), id);
}

/* ---------------------------- Sessions --------------------------- */

const stmtInsertSession = db.prepare(`
  INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const stmtSessionById = db.prepare("SELECT * FROM sessions WHERE id = ?");
const stmtDeleteSession = db.prepare("DELETE FROM sessions WHERE id = ?");
const stmtDeleteExpired = db.prepare("DELETE FROM sessions WHERE expires_at < ?");

export function insertSession(row: SessionRow): void {
  stmtInsertSession.run(
    row.id,
    row.user_id,
    row.created_at,
    row.expires_at,
    row.user_agent,
    row.ip,
  );
}
export function getSession(id: string): SessionRow | undefined {
  return stmtSessionById.get(id) as SessionRow | undefined;
}
export function deleteSession(id: string): void {
  stmtDeleteSession.run(id);
}
export function deleteExpiredSessions(): void {
  stmtDeleteExpired.run(now());
}

// Opportunistic cleanup of expired sessions on boot.
deleteExpiredSessions();

/* ------------------------------ Vaults & files ------------------------- */

export interface VaultRow {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  created_at: number;
  updated_at: number;
}

export interface FileRow {
  id: string;
  vault_id: string;
  path: string;
  title: string;
  content: string;
  pinned: number;
  created_at: number;
  updated_at: number;
}

/** File shape sent to the browser — camelCase, mirrors noto-core VaultFile. */
export interface PublicFile {
  id: string;
  path: string;
  title: string;
  content: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PublicVault {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

export function toPublicFile(f: FileRow): PublicFile {
  return {
    id: f.id,
    path: f.path,
    title: f.title,
    content: f.content,
    pinned: Boolean(f.pinned),
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  };
}

// Abuse caps. Returned as 4xx by the routes; tuned generously for real use.
export const MAX_VAULTS_PER_USER = 20;
export const MAX_FILES_PER_VAULT = 2000;

const stmtVaultsForUser = db.prepare(
  "SELECT id, name, icon, color FROM vaults WHERE user_id = ? ORDER BY created_at ASC",
);
const stmtVaultOwned = db.prepare("SELECT * FROM vaults WHERE id = ? AND user_id = ?");
const stmtCountVaults = db.prepare("SELECT COUNT(*) AS n FROM vaults WHERE user_id = ?");
const stmtInsertVault = db.prepare(
  "INSERT INTO vaults (id, user_id, name, icon, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
);

export function getVaultsForUser(userId: string): PublicVault[] {
  return stmtVaultsForUser.all(userId) as unknown as PublicVault[];
}

/** Ownership-checked vault lookup. Returns undefined if not owned/not found. */
export function getOwnedVault(userId: string, vaultId: string): VaultRow | undefined {
  return stmtVaultOwned.get(vaultId, userId) as VaultRow | undefined;
}

export function countVaultsForUser(userId: string): number {
  return (stmtCountVaults.get(userId) as { n: number }).n;
}

export function createVault(
  userId: string,
  input: { name: string; icon?: string | null; color?: string | null },
): PublicVault {
  const id = newId();
  const ts = now();
  db.exec("BEGIN");
  try {
    stmtInsertVault.run(id, userId, input.name, input.icon ?? null, input.color ?? null, ts, ts);
    stmtInsertFile.run(newId(), id, "Getting Started/Welcome.md", "Welcome", WELCOME_NOTE, ts, ts);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { id, name: input.name, icon: input.icon ?? null, color: input.color ?? null };
}

/* ------------------------------ Vault AI config ----------------------------- */

export interface VaultAIRow {
  vault_id: string;
  provider: string;
  model: string | null;
  api_key_cipher: Uint8Array | null;
  created_at: number;
  updated_at: number;
}
export interface VaultAIPublic {
  provider: string;
  model: string | null;
  configured: boolean; // true when an encrypted key is stored
}

const stmtVaultAIById = db.prepare("SELECT * FROM vault_ai WHERE vault_id = ?");
const stmtInsertVaultAI = db.prepare(
  "INSERT INTO vault_ai (vault_id, provider, model, api_key_cipher, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
);
const stmtUpdateVaultAIWithKey = db.prepare(
  "UPDATE vault_ai SET provider = ?, model = ?, api_key_cipher = ?, updated_at = ? WHERE vault_id = ?",
);
const stmtUpdateVaultAINoKey = db.prepare(
  "UPDATE vault_ai SET provider = ?, model = ?, updated_at = ? WHERE vault_id = ?",
);

export function getVaultAIRow(vaultId: string): VaultAIRow | undefined {
  const raw = stmtVaultAIById.get(vaultId) as (Omit<VaultAIRow, "api_key_cipher"> & { api_key_cipher: Uint8Array | Buffer | ArrayBuffer | null }) | undefined;
  if (!raw) return undefined;
  // Normalize BLOB to Uint8Array regardless of what node:sqlite returns at runtime.
  let cipher: Uint8Array | null = null;
  if (raw.api_key_cipher != null) {
    if (raw.api_key_cipher instanceof ArrayBuffer) {
      cipher = new Uint8Array(raw.api_key_cipher);
    } else {
      // Uint8Array or Buffer (Buffer is a Uint8Array subclass); both safe to use directly.
      cipher = raw.api_key_cipher;
    }
  }
  return { ...raw, api_key_cipher: cipher };
}

export function getVaultAIPublic(vaultId: string): VaultAIPublic | null {
  const row = getVaultAIRow(vaultId);
  if (!row) return null;
  return { provider: row.provider, model: row.model, configured: row.api_key_cipher != null };
}

/**
 * Upsert a vault's AI config. `apiKeyCipher` semantics:
 *   - undefined → leave the stored key untouched (provider/model still update)
 *   - null      → clear the stored key
 *   - Uint8Array→ replace the stored key
 */
export function setVaultAI(
  vaultId: string,
  input: { provider: string; model?: string | null; apiKeyCipher?: Uint8Array | null },
): void {
  const ts = now();
  const existing = getVaultAIRow(vaultId);
  if (!existing) {
    stmtInsertVaultAI.run(vaultId, input.provider, input.model ?? null, input.apiKeyCipher ?? null, ts, ts);
    return;
  }
  if (input.apiKeyCipher === undefined) {
    stmtUpdateVaultAINoKey.run(input.provider, input.model ?? null, ts, vaultId);
  } else {
    stmtUpdateVaultAIWithKey.run(input.provider, input.model ?? null, input.apiKeyCipher, ts, vaultId);
  }
}

const stmtFilesForVault = db.prepare(
  "SELECT * FROM files WHERE vault_id = ? ORDER BY path ASC",
);
const stmtCountFiles = db.prepare("SELECT COUNT(*) AS n FROM files WHERE vault_id = ?");
const stmtFilePathExists = db.prepare(
  "SELECT 1 FROM files WHERE vault_id = ? AND path = ? AND id != ? LIMIT 1",
);
const stmtInsertFile = db.prepare(
  "INSERT INTO files (id, vault_id, path, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
const stmtFileById = db.prepare("SELECT * FROM files WHERE id = ?");
// Ownership-checked: join through the vault to the owning user.
const stmtOwnedFile = db.prepare(
  "SELECT f.* FROM files f JOIN vaults v ON v.id = f.vault_id WHERE f.id = ? AND v.user_id = ?",
);
const stmtDeleteFile = db.prepare("DELETE FROM files WHERE id = ?");
const stmtTouchVault = db.prepare("UPDATE vaults SET updated_at = ? WHERE id = ?");

export function getFilesForVault(vaultId: string): PublicFile[] {
  return (stmtFilesForVault.all(vaultId) as unknown as FileRow[]).map(toPublicFile);
}

export function countFilesForVault(vaultId: string): number {
  return (stmtCountFiles.get(vaultId) as { n: number }).n;
}

/** True if another file in the vault already occupies `path`. */
export function pathTaken(vaultId: string, path: string, exceptFileId = ""): boolean {
  return stmtFilePathExists.get(vaultId, path, exceptFileId) !== undefined;
}

export function getOwnedFile(userId: string, fileId: string): FileRow | undefined {
  return stmtOwnedFile.get(fileId, userId) as FileRow | undefined;
}

export function createFile(
  vaultId: string,
  input: { path: string; title: string; content: string },
): PublicFile {
  const id = newId();
  const ts = now();
  stmtInsertFile.run(id, vaultId, input.path, input.title, input.content, ts, ts);
  stmtTouchVault.run(ts, vaultId);
  return toPublicFile(stmtFileById.get(id) as unknown as FileRow);
}

export function updateFile(
  fileId: string,
  patch: { path?: string; title?: string; content?: string; pinned?: boolean },
): PublicFile {
  const existing = stmtFileById.get(fileId) as unknown as FileRow;
  const ts = now();
  const next: FileRow = {
    ...existing,
    path: patch.path ?? existing.path,
    title: patch.title ?? existing.title,
    content: patch.content ?? existing.content,
    pinned: patch.pinned === undefined ? existing.pinned : patch.pinned ? 1 : 0,
    updated_at: ts,
  };
  db.prepare(
    "UPDATE files SET path = ?, title = ?, content = ?, pinned = ?, updated_at = ? WHERE id = ?",
  ).run(next.path, next.title, next.content, next.pinned, ts, fileId);
  stmtTouchVault.run(ts, existing.vault_id);
  return toPublicFile(next);
}

export function deleteFile(fileId: string): void {
  // note_edges has no FK cascade (target_id may be a synthetic tag node), so clear
  // edges touching this file explicitly or they dangle forever (nothing re-saves a
  // deleted note; neighbors' inbound edges outlive it). deleteFileEdges is defined
  // in the graph-edges section below; it's referenced at call time, not load time.
  deleteFileEdges(fileId);
  stmtDeleteFile.run(fileId);
}

const stmtDeleteOwnedFile = db.prepare(
  "DELETE FROM files WHERE id = ? AND vault_id IN (SELECT id FROM vaults WHERE user_id = ?)",
);
/** Delete a file the user owns. FK CASCADE removes note_passages + dump_sources;
 *  note_edges is cleared explicitly (no FK — see deleteFileEdges). Returns true if a row was deleted. */
export function deleteOwnedFile(userId: string, fileId: string): boolean {
  const info = stmtDeleteOwnedFile.run(fileId, userId);
  const deleted = Number(info.changes) > 0;
  if (deleted) deleteFileEdges(fileId);
  return deleted;
}

/**
 * Lazily ensure the user has at least one vault. New accounts get an empty
 * vault plus a single Welcome note. Runs in a transaction so a partial seed
 * can never be observed.
 */
export function ensureDefaultVault(userId: string): void {
  if (countVaultsForUser(userId) > 0) return;
  const ts = now();
  db.exec("BEGIN");
  try {
    const vaultId = newId();
    stmtInsertVault.run(vaultId, userId, "My Vault", null, null, ts, ts);
    stmtInsertFile.run(
      newId(),
      vaultId,
      "Getting Started/Welcome.md",
      "Welcome",
      WELCOME_NOTE,
      ts,
      ts,
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const WELCOME_NOTE = `# Welcome to Noto

When you listen, Noto remembers.

This is your private vault. Every note is plain Markdown and saves to your account automatically as you type.

## Quick start
- Write in Markdown right here — headings, lists, quotes and **bold** style as you type.
- Link notes with double brackets, like [[My First Lecture]] — clicking a link that doesn't exist yet creates that note for you.
- Press Cmd K to open the command palette, or search from the bar up top.
- Click Ask AI (or press Ctrl Cmd M) to chat with Noto AI and capture a lecture live.
- Open the Knowledge Web to see your notes and their links as a graph.

## Good to know
- Everything here is private to your account.
- Open notes in tabs, and use Open beside to view two notes side by side.
- Create folders by naming a note with a path prefix, e.g. a note in the Biology folder.

#welcome`;

/* ------------------------------ PAT tokens ----------------------------- */

export interface PatRow {
  id: string;
  token_hash: string;
  user_id: string;
  name: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

export interface AiCacheRow {
  id: number;
  content_hash: string;
  note_hash: string | null;
  question_embed: Uint8Array | null;
  feature: string;
  response: string;
  input_tokens: number;
  output_tokens: number;
  hit_count: number;
  created_at: number;
  expires_at: number;
}

const stmtInsertPat = db.prepare(
  "INSERT INTO pat_tokens (id, token_hash, user_id, name, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
);
const stmtPatById = db.prepare("SELECT * FROM pat_tokens WHERE id = ?");
const stmtPatByHash = db.prepare("SELECT * FROM pat_tokens WHERE token_hash = ?");
const stmtPatsForUser = db.prepare(
  "SELECT * FROM pat_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
);
const stmtTouchPat = db.prepare("UPDATE pat_tokens SET last_used_at = ? WHERE id = ?");
const stmtRevokePat = db.prepare(
  "UPDATE pat_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
);

/** Store a token by its hash. `tokenHash` = sha256(plaintext). */
export function createPat(input: {
  tokenHash: string;
  userId: string;
  name: string;
  scopes: string[];
}): PatRow {
  const id = newId();
  stmtInsertPat.run(id, input.tokenHash, input.userId, input.name, input.scopes.join(","), now());
  return stmtPatById.get(id) as unknown as PatRow;
}

/** Look up a live (non-revoked) token by hash and bump last_used_at (throttled). */
export function usePat(tokenHash: string): PatRow | undefined {
  const row = stmtPatByHash.get(tokenHash) as unknown as PatRow | undefined;
  if (!row || row.revoked_at !== null) return undefined;
  if (row.last_used_at === null || row.last_used_at < now() - 60_000) {
    stmtTouchPat.run(now(), row.id);
  }
  return row;
}

export function listPatsForUser(userId: string): PatRow[] {
  return stmtPatsForUser.all(userId) as unknown as PatRow[];
}

/** Returns true if a live token was revoked. */
export function revokePat(userId: string, tokenId: string): boolean {
  return stmtRevokePat.run(now(), tokenId, userId).changes > 0;
}

/* ------------------------------- Audit log ----------------------------- */

export interface AuditRow {
  id: string;
  user_id: string;
  token_id: string | null;
  tool: string;
  target: string | null;
  before_hash: string | null;
  after_hash: string | null;
  source_client: string | null;
  created_at: number;
}

const stmtInsertAudit = db.prepare(
  "INSERT INTO audit_log (id, user_id, token_id, tool, target, before_hash, after_hash, source_client, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
);
const stmtAuditForUser = db.prepare(
  "SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
);

/** Append an audit row. Returns the new row id (so callers can attach a snapshot). */
export function writeAudit(entry: {
  userId: string;
  tokenId?: string | null;
  tool: string;
  target?: string | null;
  beforeHash?: string | null;
  afterHash?: string | null;
  sourceClient?: string | null;
}): string {
  const id = newId();
  stmtInsertAudit.run(
    id,
    entry.userId,
    entry.tokenId ?? null,
    entry.tool,
    entry.target ?? null,
    entry.beforeHash ?? null,
    entry.afterHash ?? null,
    entry.sourceClient ?? null,
    now(),
  );
  return id;
}

export function listAuditForUser(userId: string, limit = 100): AuditRow[] {
  return stmtAuditForUser.all(userId, limit) as unknown as AuditRow[];
}

const stmtAuditByIdOwned = db.prepare("SELECT * FROM audit_log WHERE id = ? AND user_id = ?");
export function getOwnedAuditRow(userId: string, auditId: string): AuditRow | undefined {
  return stmtAuditByIdOwned.get(auditId, userId) as AuditRow | undefined;
}

/* ----------------------------- audit snapshots ----------------------------- */
const stmtInsertSnapshot = db.prepare("INSERT OR REPLACE INTO audit_snapshots (audit_id, content) VALUES (?, ?)");
const stmtSnapshot = db.prepare("SELECT content FROM audit_snapshots WHERE audit_id = ?");
export function writeSnapshot(auditId: string, content: string): void {
  stmtInsertSnapshot.run(auditId, content);
}
export function getSnapshot(auditId: string): string | null {
  const row = stmtSnapshot.get(auditId) as { content: string } | undefined;
  return row ? row.content : null;
}

/* ------------------------------- activity feed ----------------------------- */
export interface ActivityRaw {
  id: string;
  tool: string;
  created_at: number;
  source_client: string | null;
  token_id: string | null;
  target: string | null;
  after_hash: string | null;
  device: string | null;
  file_title: string | null;
  file_path: string | null;
  memory_text: string | null;
  memory_status: string | null;
  has_snapshot: number;
}

/** AI-write timeline: PAT writes plus human `revert` rows, enriched + filtered. */
export function listActivity(
  userId: string,
  filters: { tool?: string; source?: string; fileId?: string; before?: number; limit: number },
): ActivityRaw[] {
  const clauses = ["a.user_id = ?", "(a.token_id IS NOT NULL OR a.tool = 'revert')"];
  const args: (string | number)[] = [userId];
  if (filters.tool) { clauses.push("a.tool = ?"); args.push(filters.tool); }
  if (filters.source) { clauses.push("a.source_client = ?"); args.push(filters.source); }
  if (filters.fileId) { clauses.push("a.target = ?"); args.push(filters.fileId); }
  if (filters.before) { clauses.push("a.created_at < ?"); args.push(filters.before); }
  args.push(filters.limit);
  return prepareCached(
    `SELECT a.id, a.tool, a.created_at, a.source_client, a.token_id, a.target, a.after_hash,
            p.name AS device,
            f.title AS file_title, f.path AS file_path,
            m.text AS memory_text, m.status AS memory_status,
            (s.audit_id IS NOT NULL) AS has_snapshot
       FROM audit_log a
       LEFT JOIN pat_tokens p ON p.id = a.token_id
       LEFT JOIN files f ON f.id = a.target
       LEFT JOIN memories m ON m.id = a.target AND m.user_id = a.user_id
       LEFT JOIN audit_snapshots s ON s.audit_id = a.id
      WHERE ${clauses.join(" AND ")}
      ORDER BY a.created_at DESC
      LIMIT ?`,
  ).all(...args) as unknown as ActivityRaw[];
}

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/* ------------------------------ Memories ----------------------------- */

export interface MemoryRow {
  id: string; user_id: string; text: string; type: string; scope: string;
  source_client: string; norm_text: string; created_at: number; last_used_at: number;
  use_count: number; status: string; supersedes_id: string | null;
}
export interface PublicMemory {
  id: string; text: string; type: string; scope: string;
  sourceClient: string; lastUsed: number; useCount: number;
}

function normalizeMemoryText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
function toPublicMemory(r: MemoryRow): PublicMemory {
  return { id: r.id, text: r.text, type: r.type, scope: r.scope,
    sourceClient: r.source_client, lastUsed: r.last_used_at, useCount: r.use_count };
}

const stmtActiveByNorm = db.prepare(
  "SELECT * FROM memories WHERE user_id = ? AND scope = ? AND norm_text = ? AND status = 'active'",
);
const stmtBumpMemory = db.prepare(
  "UPDATE memories SET use_count = use_count + 1, last_used_at = ? WHERE id = ?",
);
const stmtInsertMemory = db.prepare(
  `INSERT INTO memories (id, user_id, text, type, scope, source_client, norm_text,
     created_at, last_used_at, use_count, status, supersedes_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?)`,
);
const stmtSupersede = db.prepare("UPDATE memories SET status = 'superseded' WHERE id = ? AND user_id = ?");
const stmtReactivate = db.prepare("UPDATE memories SET status = 'active' WHERE id = ? AND user_id = ?");
export function retireMemory(userId: string, id: string): void {
  stmtSupersede.run(id, userId); // → status='superseded'
}
export function reactivateMemory(userId: string, id: string): void {
  stmtReactivate.run(id, userId); // → status='active'
}
const stmtMemoryById = db.prepare("SELECT * FROM memories WHERE id = ?");
const stmtOwnedMemory = db.prepare("SELECT * FROM memories WHERE id = ? AND user_id = ?");
export function getOwnedMemory(userId: string, id: string): MemoryRow | undefined {
  return stmtOwnedMemory.get(id, userId) as MemoryRow | undefined;
}
export function getActiveMemoryByNorm(userId: string, scope: string, normText: string): MemoryRow | undefined {
  return stmtActiveByNorm.get(userId, scope, normText) as MemoryRow | undefined;
}

export function rememberMemory(input: {
  userId: string; text: string; type?: string; scope?: string;
  sourceClient?: string; supersedesId?: string;
}): { memory: PublicMemory; deduped: boolean } {
  // Omitted scope → "global". The "current project" default is the MCP client's
  // responsibility (it detects + sends the project scope); the server stores exactly
  // what it's given and never fans a write across scopes.
  const scope = input.scope && input.scope.trim() ? input.scope.trim() : "global";
  const type = input.type ?? "fact";
  const sourceClient = input.sourceClient ?? "web";
  const norm = normalizeMemoryText(input.text);
  const ts = now();

  // Correction: retire the superseded fact (kept for audit, hidden from recall).
  if (input.supersedesId) {
    stmtSupersede.run(input.supersedesId, input.userId);
  }
  // Exact-normalized dedup within scope → bump instead of inserting a duplicate.
  // Run unconditionally (even when superseding) so a collision with another active
  // memory on the same norm_text doesn't throw a UNIQUE constraint violation.
  const existing = stmtActiveByNorm.get(input.userId, scope, norm) as unknown as MemoryRow | undefined;
  if (existing) {
    stmtBumpMemory.run(ts, existing.id);
    return { memory: toPublicMemory({ ...existing, use_count: existing.use_count + 1, last_used_at: ts }), deduped: true };
  }
  const id = newId();
  stmtInsertMemory.run(id, input.userId, input.text, type, scope, sourceClient, norm, ts, ts, input.supersedesId ?? null);
  return { memory: toPublicMemory(stmtMemoryById.get(id) as unknown as MemoryRow), deduped: false };
}

const stmtCache = new Map<string, ReturnType<typeof db.prepare>>();
function prepareCached(sql: string) {
  let s = stmtCache.get(sql);
  if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); }
  return s;
}

/** Recall by FTS (bm25) + recency, filtered to status='active' and the given scopes. */
export function recallMemories(
  userId: string, scopes: string[], query: string, type: string | undefined, limit: number,
): (PublicMemory & { score: number })[] {
  const scopeList = [...new Set([...scopes, "global"])];
  const scopePlaceholders = scopeList.map(() => "?").join(",");
  const typeClause = type ? "AND m.type = ?" : "";
  const q = query.trim();
  let rows: (MemoryRow & { score: number })[];
  if (q) {
    const sql =
      `SELECT m.*, bm25(memories_fts) AS score
       FROM memories_fts JOIN memories m ON m.id = memories_fts.memory_id
       WHERE memories_fts MATCH ? AND m.user_id = ? AND m.status = 'active'
         AND m.scope IN (${scopePlaceholders}) ${typeClause}
       ORDER BY score ASC, m.last_used_at DESC LIMIT ?`;
    const args = [ftsQuery(q), userId, ...scopeList, ...(type ? [type] : []), limit];
    rows = prepareCached(sql).all(...args) as unknown as (MemoryRow & { score: number })[];
  } else {
    const sql =
      `SELECT m.*, 0 AS score FROM memories m
       WHERE m.user_id = ? AND m.status = 'active' AND m.scope IN (${scopePlaceholders}) ${typeClause}
       ORDER BY m.last_used_at DESC LIMIT ?`;
    const args = [userId, ...scopeList, ...(type ? [type] : []), limit];
    rows = prepareCached(sql).all(...args) as unknown as (MemoryRow & { score: number })[];
  }
  const ts = now();
  if (rows.length > 0) {
    const placeholders = rows.map(() => "?").join(",");
    prepareCached(`UPDATE memories SET last_used_at = ?, use_count = use_count + 1 WHERE id IN (${placeholders})`)
      .run(ts, ...rows.map((r) => r.id));
  }
  return rows.map((r) => ({ ...toPublicMemory(r), score: r.score }));
}

/** Recency-ordered browse for the Settings UI (no query). */
export function listMemories(
  userId: string, scope: string | undefined, type: string | undefined, limit: number,
): PublicMemory[] {
  const clauses = ["user_id = ?", "status = 'active'"];
  const args: (string | number)[] = [userId];
  if (scope) { clauses.push("scope IN (?, 'global')"); args.push(scope); }
  if (type) { clauses.push("type = ?"); args.push(type); }
  args.push(limit);
  const rows = prepareCached(
    `SELECT * FROM memories WHERE ${clauses.join(" AND ")} ORDER BY last_used_at DESC LIMIT ?`,
  ).all(...args) as unknown as MemoryRow[];
  return rows.map(toPublicMemory);
}

/* ------------------------------ File FTS search ----------------------------- */

export interface SearchHit { fileId: string; title: string; path: string; content: string; score: number }

const stmtSearch = db.prepare(
  `SELECT f.id AS fileId, f.title AS title, f.path AS path, f.content AS content, bm25(files_fts) AS score
   FROM files_fts
   JOIN files f ON f.id = files_fts.file_id
   JOIN vaults v ON v.id = f.vault_id
   WHERE files_fts MATCH ? AND v.user_id = ?
   ORDER BY score ASC LIMIT ?`,
);
export function searchFiles(userId: string, query: string, limit: number): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  return stmtSearch.all(ftsQuery(q), userId, limit) as unknown as SearchHit[];
}

export interface NoteRef { fileId: string; title: string; path: string; updatedAt: number }
const stmtRecentNotes = db.prepare(
  `SELECT f.id AS fileId, f.title AS title, f.path AS path, f.updated_at AS updatedAt
   FROM files f JOIN vaults v ON v.id = f.vault_id
   WHERE v.user_id = ? ORDER BY f.updated_at DESC LIMIT ?`,
);
export function listNoteRefs(userId: string, limit: number): NoteRef[] {
  return stmtRecentNotes.all(userId, limit) as unknown as NoteRef[];
}

/* ----------------------------- embeddings ----------------------------- */
export function floatsToBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}
export function blobToFloats(b: Uint8Array): Float32Array {
  // Copy into an aligned buffer (sqlite BLOBs may not be 4-byte aligned).
  const copy = new Uint8Array(b.byteLength);
  copy.set(b);
  return new Float32Array(copy.buffer);
}

const stmtDeletePassages = db.prepare("DELETE FROM note_passages WHERE file_id = ?");
const stmtInsertPassage = db.prepare(
  "INSERT INTO note_passages (id, file_id, idx, heading_path, text, char_start, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
export interface PassageInput { id: string; index: number; headingPath: string[]; text: string; charStart: number }
export function replaceNotePassages(fileId: string, passages: PassageInput[], vectors: (Float32Array | null)[]): void {
  db.exec("BEGIN");
  try {
    stmtDeletePassages.run(fileId);
    passages.forEach((p, i) => {
      const vec = vectors[i] ?? null;
      stmtInsertPassage.run(p.id, fileId, p.index, JSON.stringify(p.headingPath), p.text, p.charStart, vec ? floatsToBlob(vec) : null);
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const stmtSetMemoryEmbedding = db.prepare("UPDATE memories SET embedding = ? WHERE id = ?");
export function setMemoryEmbedding(memoryId: string, vec: Float32Array): void {
  stmtSetMemoryEmbedding.run(floatsToBlob(vec), memoryId);
}

export interface PassageVector { passageId: string; fileId: string; title: string; path: string; headingPath: string[]; text: string; vec: Float32Array }
const stmtUserPassages = db.prepare(
  `SELECT p.id AS passageId, p.file_id AS fileId, f.title AS title, f.path AS path,
          p.heading_path AS headingPath, p.text AS text, p.embedding AS embedding
     FROM note_passages p JOIN files f ON f.id = p.file_id JOIN vaults v ON v.id = f.vault_id
    WHERE v.user_id = ? AND p.embedding IS NOT NULL`,
);
export function getUserPassageVectors(userId: string): PassageVector[] {
  const rows = stmtUserPassages.all(userId) as unknown as Array<{ passageId: string; fileId: string; title: string; path: string; headingPath: string; text: string; embedding: Uint8Array }>;
  return rows.map((r) => ({ passageId: r.passageId, fileId: r.fileId, title: r.title, path: r.path, headingPath: JSON.parse(r.headingPath) as string[], text: r.text, vec: blobToFloats(r.embedding) }));
}

export function getUserMemoryVectors(userId: string, scopes: string[], type: string | undefined): { mem: PublicMemory; vec: Float32Array }[] {
  const scopeList = [...new Set([...scopes, "global"])];
  const ph = scopeList.map(() => "?").join(",");
  const typeClause = type ? "AND type = ?" : "";
  const sql = `SELECT * FROM memories WHERE user_id = ? AND status = 'active' AND scope IN (${ph}) ${typeClause} AND embedding IS NOT NULL`;
  const args = [userId, ...scopeList, ...(type ? [type] : [])];
  const rows = prepareCached(sql).all(...args) as unknown as (MemoryRow & { embedding: Uint8Array })[];
  return rows.map((r) => ({ mem: toPublicMemory(r), vec: blobToFloats(r.embedding) }));
}

export function bumpMemoryUsage(ids: string[]): void {
  if (!ids.length) return;
  const ph = ids.map(() => "?").join(",");
  prepareCached(`UPDATE memories SET last_used_at = ?, use_count = use_count + 1 WHERE id IN (${ph})`).run(now(), ...ids);
}

// System-wide loaders for the one-shot boot backfill (intentionally NOT user-scoped —
// the backfill embeds every user's missing content once on startup).
const stmtMissingMemEmbedding = db.prepare("SELECT id, text FROM memories WHERE embedding IS NULL AND status = 'active' LIMIT ?");
const stmtFileIdsMissingPassages = db.prepare("SELECT f.id FROM files f WHERE f.id NOT IN (SELECT DISTINCT file_id FROM note_passages) LIMIT ?");
const stmtFileContent = db.prepare("SELECT id, content FROM files WHERE id = ?");
export function getMemoriesMissingEmbedding(limit = 1000): { id: string; text: string }[] {
  return stmtMissingMemEmbedding.all(limit) as unknown as { id: string; text: string }[];
}
export function getFileIdsMissingPassages(limit = 1000): string[] {
  return (stmtFileIdsMissingPassages.all(limit) as Array<{ id: string }>).map((r) => r.id);
}
export function getFileContent(fileId: string): { id: string; content: string } | undefined {
  return stmtFileContent.get(fileId) as { id: string; content: string } | undefined;
}

/* ----------------------------- graph edges ----------------------------- */

export interface NoteGraphStateRow {
  fileId: string;
  vaultId: string;
  contentHash: string;
  wellLinked: boolean;
  community: number | null;
  updatedAt: number;
}

const stmtGetGraphState = db.prepare(
  "SELECT file_id AS fileId, vault_id AS vaultId, content_hash AS contentHash, well_linked AS wellLinked, community, updated_at AS updatedAt FROM note_graph_state WHERE file_id = ?",
);
export function getNoteGraphState(fileId: string): NoteGraphStateRow | undefined {
  const row = stmtGetGraphState.get(fileId) as (Omit<NoteGraphStateRow, "wellLinked"> & { wellLinked: number }) | undefined;
  return row ? { ...row, wellLinked: Boolean(row.wellLinked) } : undefined;
}

const stmtUpsertGraphState = db.prepare(
  `INSERT INTO note_graph_state (file_id, vault_id, content_hash, well_linked, community, updated_at)
   VALUES (?, ?, ?, ?, NULL, ?)
   ON CONFLICT(file_id) DO UPDATE SET
     content_hash = excluded.content_hash,
     well_linked  = excluded.well_linked,
     updated_at   = excluded.updated_at`,
);
export function upsertNoteGraphState(input: { fileId: string; vaultId: string; contentHash: string; wellLinked: boolean }): void {
  stmtUpsertGraphState.run(input.fileId, input.vaultId, input.contentHash, input.wellLinked ? 1 : 0, Date.now());
}

const stmtSetCommunity = db.prepare("UPDATE note_graph_state SET community = ? WHERE file_id = ?");
export function setNoteCommunities(communities: Map<string, number>): void {
  db.exec("BEGIN");
  try {
    for (const [fileId, community] of communities) stmtSetCommunity.run(community, fileId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const stmtDeleteFileEdges = db.prepare("DELETE FROM note_edges WHERE source_id = ?");
const stmtDeleteEdgesTouchingFile = db.prepare(
  "DELETE FROM note_edges WHERE source_id = ? OR target_id = ?",
);
const stmtInsertEdge = db.prepare(
  `INSERT INTO note_edges (id, vault_id, source_id, target_id, relation, confidence, confidence_score, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);

/**
 * Remove every edge that touches `fileId` — as source OR target. `note_edges`
 * has no FK on source_id/target_id (target_id may be a synthetic 'tag:<name>'
 * node), so deleting a note does NOT cascade its edges. Call this on delete so
 * neither the note's own outgoing edges nor neighbors' `links_to` edges pointing
 * at it are left dangling.
 */
export function deleteFileEdges(fileId: string): void {
  stmtDeleteEdgesTouchingFile.run(fileId, fileId);
}
/** Replace every edge sourced FROM `fileId` (its structural + semantic outgoing edges). Transactional. */
export function replaceFileEdges(vaultId: string, fileId: string, edges: PersistedEdge[]): void {
  db.exec("BEGIN");
  try {
    stmtDeleteFileEdges.run(fileId);
    const ts = Date.now();
    for (const e of edges) {
      stmtInsertEdge.run(e.id, vaultId, e.sourceId, e.targetId, e.relation, e.confidence, e.confidenceScore, ts);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const stmtVaultEdges = db.prepare(
  "SELECT id, source_id AS sourceId, target_id AS targetId, relation, confidence, confidence_score AS confidenceScore FROM note_edges WHERE vault_id = ?",
);
export function getVaultEdges(vaultId: string): PersistedEdge[] {
  return stmtVaultEdges.all(vaultId) as unknown as PersistedEdge[];
}

// Drop edges whose source note, or non-tag target note, no longer exists. Lets
// a rebuild converge after a note was deleted without bumping any surviving file's
// updated_at (so the changed-files pass alone would never clear inbound edges).
const stmtPruneDanglingVaultEdges = db.prepare(
  `DELETE FROM note_edges
   WHERE vault_id = ?
     AND (NOT EXISTS (SELECT 1 FROM files sf WHERE sf.id = note_edges.source_id)
          OR (target_id NOT LIKE 'tag:%'
              AND NOT EXISTS (SELECT 1 FROM files tf WHERE tf.id = note_edges.target_id)))`,
);
/** Remove edges in `vaultId` that reference a note with no surviving `files` row. Returns the count removed. */
export function pruneDanglingVaultEdges(vaultId: string): number {
  return Number(stmtPruneDanglingVaultEdges.run(vaultId).changes);
}

// A vault is stale if a file is missing/behind its graph state, OR an edge
// references a note (source, or a non-tag target) with no surviving `files` row.
// The second arm self-heals dangling edges left by any delete path that bypasses
// deleteFileEdges — deleting a note bumps no surviving file's updated_at, so the
// first arm alone can't catch orphaned inbound `links_to` edges.
const stmtStaleGraphVaults = db.prepare(
  `SELECT vaultId FROM (
     SELECT DISTINCT f.vault_id AS vaultId FROM files f
     LEFT JOIN note_graph_state g ON g.file_id = f.id
     WHERE g.file_id IS NULL OR g.updated_at < f.updated_at
     UNION
     SELECT DISTINCT e.vault_id AS vaultId FROM note_edges e
     WHERE NOT EXISTS (SELECT 1 FROM files sf WHERE sf.id = e.source_id)
        OR (e.target_id NOT LIKE 'tag:%'
            AND NOT EXISTS (SELECT 1 FROM files tf WHERE tf.id = e.target_id))
   )
   LIMIT ?`,
);
export function getStaleGraphVaultIds(limit = 500): string[] {
  return (stmtStaleGraphVaults.all(limit) as Array<{ vaultId: string }>).map((r) => r.vaultId);
}

const stmtVaultPassageVectors = db.prepare(
  `SELECT p.file_id AS fileId, p.embedding AS embedding
   FROM note_passages p JOIN files f ON f.id = p.file_id
   WHERE f.vault_id = ? AND p.embedding IS NOT NULL`,
);
export function getVaultPassageVectors(vaultId: string): { fileId: string; vec: Float32Array }[] {
  const rows = stmtVaultPassageVectors.all(vaultId) as Array<{ fileId: string; embedding: Uint8Array }>;
  return rows.map((r) => ({ fileId: r.fileId, vec: blobToFloats(r.embedding) }));
}

/* ----------------------------- AI response cache ----------------------------- */

const stmtAiCacheByHash = db.prepare(
  "SELECT * FROM ai_response_cache WHERE content_hash = ?",
);
const stmtAiCacheChatBucket = db.prepare(
  "SELECT * FROM ai_response_cache WHERE feature = 'chat' AND note_hash = ? AND expires_at > ?",
);
const stmtAiCacheInsert = db.prepare(
  `INSERT OR REPLACE INTO ai_response_cache
     (content_hash, note_hash, question_embed, feature, response,
      input_tokens, output_tokens, created_at, expires_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const stmtAiCacheIncrHit = db.prepare(
  "UPDATE ai_response_cache SET hit_count = hit_count + 1 WHERE id = ?",
);
const stmtAiCacheDeleteById = db.prepare(
  "DELETE FROM ai_response_cache WHERE id = ?",
);

export function getAiCacheByHash(contentHash: string): AiCacheRow | undefined {
  return stmtAiCacheByHash.get(contentHash) as AiCacheRow | undefined;
}

export function getAiCacheChatBucket(noteHash: string, nowSec: number): AiCacheRow[] {
  return stmtAiCacheChatBucket.all(noteHash, nowSec) as unknown as AiCacheRow[];
}

export function insertAiCache(row: Omit<AiCacheRow, "id" | "hit_count">): void {
  stmtAiCacheInsert.run(
    row.content_hash,
    row.note_hash,
    row.question_embed,
    row.feature,
    row.response,
    row.input_tokens,
    row.output_tokens,
    row.created_at,
    row.expires_at,
  );
}

export function incrementAiCacheHit(id: number): void {
  stmtAiCacheIncrHit.run(id);
}

export function deleteAiCacheRow(id: number): void {
  stmtAiCacheDeleteById.run(id);
}

/* ----------------------------- dump jobs ------------------------------- */
const stmtInsertDumpJob = db.prepare(
  "INSERT INTO dump_jobs (id, user_id, vault_id, source_type, source_ref, source_slug, status, counts, error, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
);
const stmtOwnedDumpJob = db.prepare("SELECT * FROM dump_jobs WHERE id = ? AND user_id = ?");
const stmtSetDumpJobStatus = db.prepare("UPDATE dump_jobs SET status = ?, updated_at = ? WHERE id = ?");
const stmtSetDumpJobStatusErr = db.prepare("UPDATE dump_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?");
const stmtSetDumpJobCounts = db.prepare("UPDATE dump_jobs SET counts = ?, updated_at = ? WHERE id = ?");
const stmtClaimableJobs = db.prepare("SELECT * FROM dump_jobs WHERE status IN ('queued','committing') ORDER BY created_at ASC LIMIT ?");

export function createDumpJob(input: { userId: string; vaultId: string; sourceType: "raw"|"github"|"notion"; sourceRef: unknown; sourceSlug: string }): DumpJobRow {
  const id = crypto.randomUUID();
  const ts = Date.now();
  stmtInsertDumpJob.run(id, input.userId, input.vaultId, input.sourceType, JSON.stringify(input.sourceRef), input.sourceSlug, "queued", "{}", null, ts, ts);
  return stmtOwnedDumpJob.get(id, input.userId) as unknown as DumpJobRow;
}
export function getOwnedDumpJob(userId: string, jobId: string): DumpJobRow | undefined {
  return stmtOwnedDumpJob.get(jobId, userId) as DumpJobRow | undefined;
}
export function setDumpJobStatus(jobId: string, status: DumpStatus, error?: string | null): void {
  if (error !== undefined) stmtSetDumpJobStatusErr.run(status, error, Date.now(), jobId);
  else stmtSetDumpJobStatus.run(status, Date.now(), jobId);
}
export function setDumpJobCounts(jobId: string, counts: DumpCounts): void {
  stmtSetDumpJobCounts.run(JSON.stringify(counts), Date.now(), jobId);
}
export function claimableDumpJobs(limit = 5): DumpJobRow[] {
  return stmtClaimableJobs.all(limit) as unknown as DumpJobRow[];
}

/* ----------------------------- dump items ------------------------------ */
const stmtInsertDumpItem = db.prepare(
  "INSERT INTO dump_items (id, job_id, source_key, status, redaction_count, shaped, file_id, dedup_of, error) VALUES (?,?,?,?,?,?,?,?,?)",
);
const stmtItemsByJob = db.prepare("SELECT * FROM dump_items WHERE job_id = ? ORDER BY rowid ASC");
const stmtItemById = db.prepare("SELECT * FROM dump_items WHERE id = ?");

export function insertDumpItem(input: { jobId: string; sourceKey: string; status: DumpItemStatus; shaped?: string|null; dedupOf?: string|null; redactionCount?: number }): DumpItemRow {
  const id = crypto.randomUUID();
  stmtInsertDumpItem.run(id, input.jobId, input.sourceKey, input.status, input.redactionCount ?? 0, input.shaped ?? null, null, input.dedupOf ?? null, null);
  return stmtItemById.get(id) as unknown as DumpItemRow;
}
export function listDumpItems(jobId: string): DumpItemRow[] {
  return stmtItemsByJob.all(jobId) as unknown as DumpItemRow[];
}
export function getDumpItem(itemId: string): DumpItemRow | undefined {
  return stmtItemById.get(itemId) as DumpItemRow | undefined;
}
export function updateDumpItem(itemId: string, patch: Partial<Pick<DumpItemRow, "status"|"shaped"|"file_id"|"dedup_of"|"error"|"redaction_count">>): void {
  const cur = stmtItemById.get(itemId) as unknown as DumpItemRow;
  db.prepare("UPDATE dump_items SET status=?, shaped=?, file_id=?, dedup_of=?, error=?, redaction_count=? WHERE id=?").run(
    patch.status ?? cur.status,
    patch.shaped !== undefined ? patch.shaped : cur.shaped,
    patch.file_id !== undefined ? patch.file_id : cur.file_id,
    patch.dedup_of !== undefined ? patch.dedup_of : cur.dedup_of,
    patch.error !== undefined ? patch.error : cur.error,
    patch.redaction_count ?? cur.redaction_count,
    itemId,
  );
}

/* ---------------------------- dump sources ----------------------------- */
// Dedup identity is (user_id, vault_id, source_key): the same source dumped into
// two different vaults is two independent notes, each with its own idempotency.
const stmtGetDumpSource = db.prepare("SELECT * FROM dump_sources WHERE user_id = ? AND vault_id = ? AND source_key = ?");
const stmtUpsertDumpSource = db.prepare(
  "INSERT INTO dump_sources (user_id, vault_id, source_key, file_id, content_hash, job_id, created_at) VALUES (?,?,?,?,?,?,?) " +
  "ON CONFLICT(user_id, vault_id, source_key) DO UPDATE SET file_id=excluded.file_id, content_hash=excluded.content_hash, job_id=excluded.job_id",
);
export function getDumpSource(userId: string, vaultId: string, sourceKey: string): DumpSourceRow | undefined {
  return stmtGetDumpSource.get(userId, vaultId, sourceKey) as DumpSourceRow | undefined;
}
export function upsertDumpSource(input: { userId: string; vaultId: string; sourceKey: string; fileId: string; contentHash: string; jobId?: string|null }): void {
  stmtUpsertDumpSource.run(input.userId, input.vaultId, input.sourceKey, input.fileId, input.contentHash, input.jobId ?? null, Date.now());
}

/* -------------------------- connector tokens --------------------------- */
const stmtGetConnector = db.prepare("SELECT * FROM connector_tokens WHERE user_id = ? AND provider = ?");
const stmtListConnectors = db.prepare("SELECT * FROM connector_tokens WHERE user_id = ? ORDER BY created_at ASC");
const stmtDeleteConnector = db.prepare("DELETE FROM connector_tokens WHERE user_id = ? AND provider = ?");
const stmtUpsertConnector = db.prepare(
  "INSERT INTO connector_tokens (id, user_id, provider, external_account, installation_id, access_token_cipher, refresh_token_cipher, expires_at, scopes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) " +
  "ON CONFLICT(user_id, provider) DO UPDATE SET external_account=excluded.external_account, installation_id=excluded.installation_id, access_token_cipher=excluded.access_token_cipher, refresh_token_cipher=excluded.refresh_token_cipher, expires_at=excluded.expires_at, scopes=excluded.scopes, updated_at=excluded.updated_at",
);
export function saveConnectorToken(input: { userId: string; provider: "github"|"notion"; externalAccount?: string|null; installationId?: string|null; accessTokenCipher?: Uint8Array|null; refreshTokenCipher?: Uint8Array|null; expiresAt?: number|null; scopes?: string|null }): void {
  const ts = Date.now();
  stmtUpsertConnector.run(crypto.randomUUID(), input.userId, input.provider, input.externalAccount ?? null, input.installationId ?? null, input.accessTokenCipher ?? null, input.refreshTokenCipher ?? null, input.expiresAt ?? null, input.scopes ?? null, ts, ts);
}
export function getConnectorToken(userId: string, provider: "github"|"notion"): ConnectorTokenRow | undefined {
  return stmtGetConnector.get(userId, provider) as ConnectorTokenRow | undefined;
}
export function listConnectors(userId: string): ConnectorTokenRow[] {
  return stmtListConnectors.all(userId) as unknown as ConnectorTokenRow[];
}
export function deleteConnector(userId: string, provider: "github"|"notion"): void {
  stmtDeleteConnector.run(userId, provider);
}

export { db };
