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

mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });

const db = new DatabaseSync(env.DATABASE_PATH);

// Pragmas: WAL for concurrency, foreign keys on for referential integrity.
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT,                       -- null for OAuth-only accounts
    google_sub      TEXT UNIQUE,                -- Google subject id, if linked
    display_name    TEXT,
    avatar_url      TEXT,
    theme           TEXT NOT NULL DEFAULT 'light',
    email_verified  INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
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
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_vaults_user ON vaults(user_id);

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
  CREATE INDEX IF NOT EXISTS idx_pat_user ON pat_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_pat_hash ON pat_tokens(token_hash);

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
    supersedes_id  TEXT
  );
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
`);

// Additive migration: older databases predate the `pinned` column. Add it once
// if missing (CREATE TABLE IF NOT EXISTS above never alters an existing table).
{
  const cols = db.prepare("PRAGMA table_info(files)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "pinned")) {
    db.exec("ALTER TABLE files ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
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
  email: string;
  password_hash: string | null;
  google_sub: string | null;
  display_name: string | null;
  avatar_url: string | null;
  theme: string;
  email_verified: number;
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

/** A user shape that is safe to send to the browser (no secrets). */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  theme: string;
  emailVerified: boolean;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    theme: u.theme,
    emailVerified: Boolean(u.email_verified),
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

const stmtUserByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
const stmtUserById = db.prepare("SELECT * FROM users WHERE id = ?");
const stmtUserByGoogle = db.prepare("SELECT * FROM users WHERE google_sub = ?");

export function getUserByEmail(email: string): User | undefined {
  return stmtUserByEmail.get(email.toLowerCase()) as User | undefined;
}
export function getUserById(id: string): User | undefined {
  return stmtUserById.get(id) as User | undefined;
}
export function getUserByGoogleSub(sub: string): User | undefined {
  return stmtUserByGoogle.get(sub) as User | undefined;
}

const stmtInsertUser = db.prepare(`
  INSERT INTO users
    (id, email, password_hash, google_sub, display_name, avatar_url, theme, email_verified, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function createUser(input: {
  email: string;
  passwordHash?: string | null;
  googleSub?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  theme?: string;
  emailVerified?: boolean;
}): User {
  const id = newId();
  const ts = now();
  stmtInsertUser.run(
    id,
    input.email.toLowerCase(),
    input.passwordHash ?? null,
    input.googleSub ?? null,
    input.displayName ?? null,
    input.avatarUrl ?? null,
    input.theme ?? "light",
    input.emailVerified ? 1 : 0,
    ts,
    ts,
  );
  return getUserById(id)!;
}

const stmtSetTheme = db.prepare("UPDATE users SET theme = ?, updated_at = ? WHERE id = ?");
export function setUserTheme(id: string, theme: string): void {
  stmtSetTheme.run(theme, now(), id);
}

const stmtLinkGoogle = db.prepare(
  "UPDATE users SET google_sub = ?, avatar_url = COALESCE(avatar_url, ?), display_name = COALESCE(display_name, ?), email_verified = 1, updated_at = ? WHERE id = ?",
);
export function linkGoogleToUser(
  id: string,
  sub: string,
  avatarUrl: string | null,
  displayName: string | null,
): void {
  stmtLinkGoogle.run(sub, avatarUrl, displayName, now(), id);
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
  "SELECT id, name FROM vaults WHERE user_id = ? ORDER BY created_at ASC",
);
const stmtVaultOwned = db.prepare("SELECT * FROM vaults WHERE id = ? AND user_id = ?");
const stmtCountVaults = db.prepare("SELECT COUNT(*) AS n FROM vaults WHERE user_id = ?");
const stmtInsertVault = db.prepare(
  "INSERT INTO vaults (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
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

export function createVault(userId: string, name: string): VaultRow {
  const id = newId();
  const ts = now();
  stmtInsertVault.run(id, userId, name, ts, ts);
  return stmtUserVaultById(id)!;
}

const stmtVaultById = db.prepare("SELECT * FROM vaults WHERE id = ?");
function stmtUserVaultById(id: string): VaultRow | undefined {
  return stmtVaultById.get(id) as VaultRow | undefined;
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
  stmtDeleteFile.run(fileId);
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
    stmtInsertVault.run(vaultId, userId, "My Vault", ts, ts);
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

export { db };
