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
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_files_vault ON files(vault_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_files_vault_path ON files(vault_id, path);
`);

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
  created_at: number;
  updated_at: number;
}

/** File shape sent to the browser — camelCase, mirrors noto-core VaultFile. */
export interface PublicFile {
  id: string;
  path: string;
  title: string;
  content: string;
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
  patch: { path?: string; title?: string; content?: string },
): PublicFile {
  const existing = stmtFileById.get(fileId) as unknown as FileRow;
  const ts = now();
  const next: FileRow = {
    ...existing,
    path: patch.path ?? existing.path,
    title: patch.title ?? existing.title,
    content: patch.content ?? existing.content,
    updated_at: ts,
  };
  db.prepare("UPDATE files SET path = ?, title = ?, content = ?, updated_at = ? WHERE id = ?").run(
    next.path,
    next.title,
    next.content,
    ts,
    fileId,
  );
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
- Link notes with double brackets, like [[My First Lecture]] — clicking a link that doesn't exist yet will offer to create that note.
- Press the Edit / Preview toggle above the note to switch between writing and reading.
- Press Cmd K to open the command menu.
- Press Ctrl Cmd M to open the Lecture AI recorder. Press Record, then Stop, and Noto writes structured notes into the current note.
- Open the Knowledge Web tab to see your notes and their links as a live graph.

## Good to know
- Everything here is private to your account.
- Create folders by naming a note with a path prefix, e.g. a note in the Biology folder.

#welcome`;

export { db };
