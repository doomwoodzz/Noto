# Noto Multi-Vault Switcher & Create Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user own multiple vaults — switch between them from a sidebar dropdown, and create a new one (name, emoji-on-color icon, and an optional per-vault AI hookup) from a focused modal.

**Architecture:** The `vaults` table and the 20-vault cap already exist; the frontend just hardcodes `vaults[0]`. Backend gains `icon`/`color` columns, a `POST /api/vaults` route, a `vault_ai` table (API key encrypted at rest with AES-256-GCM), and per-vault key/model resolution in the AI routes (falling back to the global key). Frontend makes `useVault` vault-aware and adds three components — `VaultBadge`, `VaultSwitcher` (popover), and `CreateVaultModal` (with an Advanced disclosure for AI). Work is phased so the app stays shippable after each phase.

**Tech Stack:** Node `node:sqlite` + Express 5 + zod (server), `node:crypto` AES-256-GCM (key encryption), React 19 (client), Vitest (Node env: pure-logic unit tests + server integration tests — no RTL; UI is verified via the preview workflow).

**Spec:** `docs/superpowers/specs/2026-06-30-noto-multi-vault-switcher-design.md`

---

## File Structure

**Server — create:**
- `landing/server/ai/keyvault.ts` — AES-256-GCM encrypt/decrypt for vault API keys (master key from `VAULT_KEY_SECRET`).
- `landing/server/ai/vaultAI.ts` — `resolveVaultAI(userId, vaultId)`: ownership-checked decrypt of a vault's key + model.
- `landing/server/db.vaults-migration.test.ts` — regression: legacy `vaults` (no `icon`/`color`) upgrades cleanly.
- `landing/server/ai/keyvault.test.ts` — encrypt→decrypt round-trip; tamper rejection.
- `landing/server/ai/vaultAI.test.ts` — resolution returns decrypted key/model; `{}` for non-owned vault.

**Server — modify:**
- `landing/server/db.ts` — `vaults` migration (`icon`, `color`); `PublicVault`/`getVaultsForUser`/`createVault` carry them; new `vault_ai` table + `getVaultAIRow`/`setVaultAI`/`getVaultAIPublic`.
- `landing/server/env.ts` — optional `VAULT_KEY_SECRET`.
- `landing/server/express.d.ts` — `req.vaultAI?: { apiKey?: string; model?: string }`.
- `landing/server/ai/openai.ts` — `clientFor(apiKey?)`; `complete`/`transcribe` accept `{ apiKey?, model? }`.
- `landing/server/ai/routes.ts` — `requireAI` resolves + stashes `req.vaultAI`, allows a vault key; handlers pass it through.
- `landing/server/notes/routes.ts` — `POST /api/vaults`; `GET`/`PUT /api/vaults/:vaultId/ai`.
- `landing/server/notes/routes.test.ts` — tests for the new routes.

**Client — create:**
- `landing/src/workspace/vaultIcons.ts` — `VAULT_EMOJI`, `VAULT_COLORS`, `tintFor(color)`, `pickInitialVault(...)`.
- `landing/src/workspace/VaultBadge.tsx` — emoji-on-tint tile (monogram fallback).
- `landing/src/workspace/VaultSwitcher.tsx` — trigger + popover.
- `landing/src/workspace/CreateVaultModal.tsx` — create form + Advanced AI disclosure.
- `landing/src/workspace/vaultIcons.test.ts` — `pickInitialVault` + `tintFor` unit tests.

**Client — modify:**
- `landing/src/app/api.ts` — `Vault` gains `icon`/`color`; `setActiveVault`; `api.createVault`; `api.vaultAI`.
- `landing/src/app/useVault.ts` — `vaults`/`activeVaultId`/`selectVault`/`createVault` + per-user persistence.
- `landing/src/app/NotoWorkspace.tsx` — pass `user.id` to `useVault`; map the new surface onto the controller.
- `landing/src/workspace/types.ts` — `VaultController` gains `vaults`/`activeVaultId`/`selectVault`/`createVault`.
- `landing/src/workspace/Sidebar.tsx` — replace the static `.nw-vault` block with `VaultSwitcher`.
- `landing/src/workspace/NotoWindow.tsx` — host `CreateVaultModal`; thread vault surface from controller.
- `landing/src/styles/workspace.css` — switcher popover, badge tints, create-modal styles.

---

## PHASE 1 — Data + API (backend only; no UI yet)

### Task 1: `vaults.icon` / `vaults.color` migration + carry through reads

**Files:**
- Modify: `landing/server/db.ts`
- Create: `landing/server/db.vaults-migration.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `landing/server/db.vaults-migration.test.ts` (mirrors the existing `db.migration.test.ts` pattern — seed a legacy DB, then import `db.ts` to run boot migrations):

```ts
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
```

- [ ] **Step 2: Run it; verify it fails**

Run: `cd landing && npx vitest run server/db.vaults-migration.test.ts`
Expected: FAIL — `getVaultsForUser` returns `{id,name}` only (no `icon`/`color`), and/or columns missing.

- [ ] **Step 3: Add the migration + carry icon/color through**

In `landing/server/db.ts`, after the existing `files.pinned` migration block (around `db.ts:168`), add an additive `vaults` migration:

```ts
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
```

Also add `icon`/`color` to the `CREATE TABLE IF NOT EXISTS vaults` block (around `db.ts:52`) so fresh DBs get them:

```sql
  CREATE TABLE IF NOT EXISTS vaults (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    icon        TEXT,
    color       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
```

Update `PublicVault` (around `db.ts:439`):

```ts
export interface PublicVault {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}
```

Update the vault statements + functions (around `db.ts:460-487`):

```ts
const stmtVaultsForUser = db.prepare(
  "SELECT id, name, icon, color FROM vaults WHERE user_id = ? ORDER BY created_at ASC",
);
// ... stmtVaultOwned / stmtCountVaults unchanged ...
const stmtInsertVault = db.prepare(
  "INSERT INTO vaults (id, user_id, name, icon, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
);

export function getVaultsForUser(userId: string): PublicVault[] {
  return stmtVaultsForUser.all(userId) as unknown as PublicVault[];
}
```

Update the existing `createVault` (around `db.ts:482`) to accept icon/color and return a `PublicVault` that seeds a Welcome note in a transaction (mirrors `ensureDefaultVault`). Replace the old body:

```ts
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
```

Update `ensureDefaultVault`'s insert (around `db.ts:577`) to pass the two new columns as null:

```ts
    stmtInsertVault.run(vaultId, userId, "My Vault", null, null, ts, ts);
```

> Note: `stmtInsertFile` is declared lower in the file (around `db.ts:501`). `createVault` is defined after it, so the reference resolves. If a hoisting error occurs, move the `createVault` definition below the file statements.
>
> The old `createVault` body used the `stmtVaultById` const + `stmtUserVaultById` helper (around `db.ts:489`). After this rewrite they're unused — delete both so `tsc` (noUnusedLocals) and the linter stay green. Grep `stmtUserVaultById` / `stmtVaultById` first to confirm nothing else references them.

- [ ] **Step 4: Run the test; verify it passes**

Run: `cd landing && npx vitest run server/db.vaults-migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full server suite to catch fallout**

Run: `cd landing && npx vitest run server/`
Expected: PASS (the existing "bootstraps a default vault" test still green; `getVaultsForUser` now returns `icon`/`color: null`).

- [ ] **Step 6: Commit**

```bash
git add landing/server/db.ts landing/server/db.vaults-migration.test.ts
git commit -m "feat(vaults): add icon/color columns + migration; carry through reads"
```

---

### Task 2: `keyvault.ts` — AES-256-GCM encrypt/decrypt + `VAULT_KEY_SECRET`

**Files:**
- Modify: `landing/server/env.ts`
- Create: `landing/server/ai/keyvault.ts`, `landing/server/ai/keyvault.test.ts`

- [ ] **Step 1: Add the env var**

In `landing/server/env.ts`, add to the zod schema (after `OPENAI_API_KEY`, around `env.ts:52`):

```ts
  /**
   * 32-byte base64 master key used to encrypt per-vault AI API keys at rest
   * (AES-256-GCM). Optional: when unset, per-vault BYO keys are disabled and
   * the AI falls back to OPENAI_API_KEY. Generate with:
   *   node -e "console.log(crypto.randomBytes(32).toString('base64'))"
   */
  VAULT_KEY_SECRET: z.string().optional(),
```

And expose a convenience flag in the exported `env` object (around `env.ts:86`):

```ts
  vaultKeyConfigured: Boolean(raw.VAULT_KEY_SECRET),
```

- [ ] **Step 2: Write the failing round-trip test**

Create `landing/server/ai/keyvault.test.ts`:

```ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import crypto from "node:crypto";

const KEY = crypto.randomBytes(32).toString("base64");

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VAULT_KEY_SECRET", KEY);
});
afterEach(() => vi.unstubAllEnvs());

it("encrypts then decrypts back to the original plaintext", async () => {
  const { encryptKey, decryptKey, keyvaultConfigured } = await import("./keyvault.ts");
  expect(keyvaultConfigured()).toBe(true);
  const blob = encryptKey("sk-secret-123");
  expect(Buffer.from(blob).toString("utf8")).not.toContain("sk-secret-123"); // ciphertext
  expect(decryptKey(blob)).toBe("sk-secret-123");
});

it("rejects a tampered ciphertext (GCM auth tag)", async () => {
  const { encryptKey, decryptKey } = await import("./keyvault.ts");
  const blob = encryptKey("sk-secret-123");
  blob[blob.length - 1] ^= 0xff; // flip a byte
  expect(() => decryptKey(blob)).toThrow();
});

it("reports not-configured when the master key is absent", async () => {
  vi.stubEnv("VAULT_KEY_SECRET", "");
  vi.resetModules();
  const { keyvaultConfigured, encryptKey } = await import("./keyvault.ts");
  expect(keyvaultConfigured()).toBe(false);
  expect(() => encryptKey("x")).toThrow();
});
```

- [ ] **Step 3: Run it; verify it fails**

Run: `cd landing && npx vitest run server/ai/keyvault.test.ts`
Expected: FAIL — `./keyvault.ts` does not exist.

- [ ] **Step 4: Implement `keyvault.ts`**

Create `landing/server/ai/keyvault.ts`:

```ts
/**
 * Encryption for per-vault AI API keys.
 *
 * Keys are stored ONLY as AES-256-GCM ciphertext (iv ‖ tag ‖ ciphertext), under
 * a 32-byte master key from VAULT_KEY_SECRET. The plaintext key never leaves the
 * server, is never logged, and is never serialized into any Public* shape.
 */
import crypto from "node:crypto";
import { env } from "../env.ts";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function masterKey(): Buffer | null {
  if (!env.VAULT_KEY_SECRET) return null;
  const key = Buffer.from(env.VAULT_KEY_SECRET, "base64");
  return key.length === 32 ? key : null;
}

export function keyvaultConfigured(): boolean {
  return masterKey() !== null;
}

export function encryptKey(plaintext: string): Uint8Array {
  const key = masterKey();
  if (!key) throw new Error("VAULT_KEY_SECRET is not configured");
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

export function decryptKey(blob: Uint8Array): string {
  const key = masterKey();
  if (!key) throw new Error("VAULT_KEY_SECRET is not configured");
  const buf = Buffer.from(blob);
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 5: Run the test; verify it passes**

Run: `cd landing && npx vitest run server/ai/keyvault.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 6: Commit**

```bash
git add landing/server/env.ts landing/server/ai/keyvault.ts landing/server/ai/keyvault.test.ts
git commit -m "feat(vaults): AES-256-GCM keyvault for per-vault AI keys"
```

---

### Task 3: `vault_ai` table + DB accessors

**Files:**
- Modify: `landing/server/db.ts`

- [ ] **Step 1: Write the failing accessor test**

Append to `landing/server/db.vaults-migration.test.ts` a second `it(...)` that exercises `vault_ai` against a fresh in-memory DB (the migration file already controls `DATABASE_PATH`; here we use a temp file too):

```ts
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
  expect(Array.from(mod.getVaultAIRow("v1")!.api_key_cipher!)).toEqual([1, 2, 3]);
  expect(mod.getVaultAIRow("v1")!.model).toBe("gpt-4o");

  // Clearing the key explicitly.
  mod.setVaultAI("v1", { provider: "openai", model: "gpt-4o", apiKeyCipher: null });
  expect(mod.getVaultAIRow("v1")!.api_key_cipher).toBeNull();
  expect(mod.getVaultAIPublic("v1")).toEqual({ provider: "openai", model: "gpt-4o", configured: false });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `cd landing && npx vitest run server/db.vaults-migration.test.ts`
Expected: FAIL — `setVaultAI`/`getVaultAIRow`/`getVaultAIPublic` are not exported.

- [ ] **Step 3: Add the table + accessors to `db.ts`**

In the `CREATE TABLE IF NOT EXISTS` block, add (after the `vaults` table):

```sql
  CREATE TABLE IF NOT EXISTS vault_ai (
    vault_id       TEXT PRIMARY KEY REFERENCES vaults(id) ON DELETE CASCADE,
    provider       TEXT NOT NULL DEFAULT 'openai',
    model          TEXT,
    api_key_cipher BLOB,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
```

After the vault functions (around `db.ts:492`), add:

```ts
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
  return stmtVaultAIById.get(vaultId) as VaultAIRow | undefined;
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
  input: { provider: string; model: string | null; apiKeyCipher?: Uint8Array | null },
): void {
  const ts = now();
  const existing = getVaultAIRow(vaultId);
  if (!existing) {
    stmtInsertVaultAI.run(vaultId, input.provider, input.model, input.apiKeyCipher ?? null, ts, ts);
    return;
  }
  if (input.apiKeyCipher === undefined) {
    stmtUpdateVaultAINoKey.run(input.provider, input.model, ts, vaultId);
  } else {
    stmtUpdateVaultAIWithKey.run(input.provider, input.model, input.apiKeyCipher, ts, vaultId);
  }
}
```

- [ ] **Step 4: Run the test; verify it passes**

Run: `cd landing && npx vitest run server/db.vaults-migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add landing/server/db.ts landing/server/db.vaults-migration.test.ts
git commit -m "feat(vaults): vault_ai table + encrypted-key accessors"
```

---

### Task 4: `POST /api/vaults` route

**Files:**
- Modify: `landing/server/notes/routes.ts`, `landing/server/notes/routes.test.ts`

- [ ] **Step 1: Write the failing route tests**

Append to `landing/server/notes/routes.test.ts` inside the `describe("notes API", ...)` block (it already defines `signup` + `makeClient`):

```ts
  it("creates a vault with icon/color and seeds a Welcome note", async () => {
    const a = await signup("mv-create@example.com");
    const res = await a.req("POST", "/api/vaults", { name: "Thesis", icon: "🎓", color: "blue" });
    expect(res.status).toBe(201);
    const { vault } = (await res.json()) as { vault: { id: string; name: string; icon: string; color: string } };
    expect(vault).toMatchObject({ name: "Thesis", icon: "🎓", color: "blue" });

    // It shows up in the list (alongside the bootstrapped default).
    const list = (await (await a.req("GET", "/api/vaults")).json()) as { vaults: { id: string }[] };
    expect(list.vaults.some((v) => v.id === vault.id)).toBe(true);

    // It has a Welcome note.
    const files = (await (await a.req("GET", `/api/vaults/${vault.id}/files`)).json()) as { files: { path: string }[] };
    expect(files.files.some((f) => f.path === "Getting Started/Welcome.md")).toBe(true);
  });

  it("rejects an empty vault name", async () => {
    const a = await signup("mv-empty@example.com");
    const res = await a.req("POST", "/api/vaults", { name: "   " });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const anon = makeClient();
    await anon.req("GET", "/api/health");
    const res = await anon.req("POST", "/api/vaults", { name: "Nope" });
    expect(res.status).toBe(401);
  });
```

- [ ] **Step 2: Run them; verify they fail**

Run: `cd landing && npx vitest run server/notes/routes.test.ts`
Expected: FAIL — `POST /api/vaults` returns 404 (no such route).

- [ ] **Step 3: Add the route**

In `landing/server/notes/routes.ts`, extend the `db.ts` import (around `db.ts:20-36`) to add `createVault`, `countVaultsForUser`, `MAX_VAULTS_PER_USER`. Add a vault-name schema near the other schemas (around `routes.ts:64`):

```ts
const vaultNameSchema = z.string().trim().min(1).max(60);
const vaultIconSchema = z.string().trim().max(8).optional();   // a single emoji (multi-codepoint)
const vaultColorSchema = z.string().trim().max(24).optional(); // a color token, validated client-side
const createVaultSchema = z.object({
  name: vaultNameSchema,
  icon: vaultIconSchema,
  color: vaultColorSchema,
});
```

Add the route right after the `GET /vaults` handler (around `routes.ts:136`):

```ts
// Create a new vault for the caller (name + optional emoji icon + color token).
notesRouter.post("/vaults", writeLimiter, jsonBody, (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const parsed = createVaultSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid vault" });
    return;
  }
  if (countVaultsForUser(userId) >= MAX_VAULTS_PER_USER) {
    res.status(409).json({ error: "You've reached the maximum number of vaults." });
    return;
  }
  const vault = createVault(userId, {
    name: parsed.data.name,
    icon: parsed.data.icon ?? null,
    color: parsed.data.color ?? null,
  });
  res.status(201).json({ vault });
});
```

- [ ] **Step 4: Run the tests; verify they pass**

Run: `cd landing && npx vitest run server/notes/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add landing/server/notes/routes.ts landing/server/notes/routes.test.ts
git commit -m "feat(vaults): POST /api/vaults (name/icon/color, cap, Welcome seed)"
```

---

### Task 5: `GET` / `PUT /api/vaults/:vaultId/ai` routes

**Files:**
- Modify: `landing/server/notes/routes.ts`, `landing/server/notes/routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `landing/server/notes/routes.test.ts` (inside the describe block):

```ts
  it("sets and reads per-vault AI config without echoing the key", async () => {
    const a = await signup("mv-ai@example.com");
    const { vault } = (await (await a.req("POST", "/api/vaults", { name: "AI Vault" })).json()) as { vault: { id: string } };

    // Before config: 200 with a default-ish payload.
    const before = (await (await a.req("GET", `/api/vaults/${vault.id}/ai`)).json()) as { configured: boolean };
    expect(before.configured).toBe(false);

    // Set provider/model/key.
    const put = await a.req("PUT", `/api/vaults/${vault.id}/ai`, {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-test-key-abc",
    });
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as Record<string, unknown>;
    expect(putBody).toMatchObject({ provider: "openai", model: "gpt-4o-mini", configured: true });
    expect(JSON.stringify(putBody)).not.toContain("sk-test-key-abc"); // never echoed

    const after = (await (await a.req("GET", `/api/vaults/${vault.id}/ai`)).json()) as { configured: boolean };
    expect(after.configured).toBe(true);
  });

  it("404s AI config for a vault the caller does not own", async () => {
    const a = await signup("mv-own-a@example.com");
    const b = await signup("mv-own-b@example.com");
    const { vault } = (await (await a.req("POST", "/api/vaults", { name: "Private" })).json()) as { vault: { id: string } };
    const res = await b.req("GET", `/api/vaults/${vault.id}/ai`);
    expect(res.status).toBe(404);
  });
```

> These tests need `keyvaultConfigured()` to be true so the PUT route actually encrypts. Because `env.ts` reads `process.env` at import time and ES-module imports are hoisted above statements, you **cannot** set `process.env.VAULT_KEY_SECRET` from inside the test file. Instead set it globally in the vitest config (done in the next step) so it's present before any module loads.

- [ ] **Step 1b: Provide `VAULT_KEY_SECRET` to the test env**

In `landing/vitest.config.ts`, add to `test.env` (a fixed 32-byte base64 value is fine for tests):

```ts
      VAULT_KEY_SECRET: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
```

(`"A"*43 + "="` decodes to 32 zero bytes — a valid AES-256 key for the test suite only.)

- [ ] **Step 2: Run them; verify they fail**

Run: `cd landing && npx vitest run server/notes/routes.test.ts`
Expected: FAIL — the AI routes don't exist.

- [ ] **Step 3: Add the routes**

In `landing/server/notes/routes.ts`, extend the `db.ts` import with `getOwnedVault` (already imported), `setVaultAI`, `getVaultAIPublic`. Import the keyvault:

```ts
import { encryptKey, keyvaultConfigured } from "../ai/keyvault.ts";
```

Add schema + routes after the `POST /vaults` handler:

```ts
const vaultAISchema = z.object({
  provider: z.enum(["openai"]).default("openai"),
  model: z.string().trim().max(60).nullable().optional(),
  // undefined → leave key; "" → clear key; non-empty → set key
  apiKey: z.string().max(400).optional(),
});

notesRouter.get("/vaults/:vaultId/ai", (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const vault = getOwnedVault(userId, req.params.vaultId as string);
  if (!vault) {
    res.status(404).json({ error: "Vault not found" });
    return;
  }
  const cfg = getVaultAIPublic(vault.id) ?? { provider: "openai", model: null, configured: false };
  res.json(cfg);
});

notesRouter.put("/vaults/:vaultId/ai", writeLimiter, jsonBody, (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const vault = getOwnedVault(userId, req.params.vaultId as string);
  if (!vault) {
    res.status(404).json({ error: "Vault not found" });
    return;
  }
  const parsed = vaultAISchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid AI config" });
    return;
  }
  const { provider, model, apiKey } = parsed.data;

  let apiKeyCipher: Uint8Array | null | undefined;
  if (apiKey === undefined) {
    apiKeyCipher = undefined; // leave as-is
  } else if (apiKey.trim() === "") {
    apiKeyCipher = null; // clear
  } else {
    if (!keyvaultConfigured()) {
      res.status(400).json({ error: "Per-vault keys aren't available on this server." });
      return;
    }
    apiKeyCipher = encryptKey(apiKey.trim());
  }

  setVaultAI(vault.id, { provider, model: model ?? null, apiKeyCipher });
  const cfg = getVaultAIPublic(vault.id) ?? { provider, model: model ?? null, configured: false };
  res.json(cfg); // never includes the key
});
```

- [ ] **Step 4: Run the tests; verify they pass**

Run: `cd landing && npx vitest run server/notes/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add landing/server/notes/routes.ts landing/server/notes/routes.test.ts
git commit -m "feat(vaults): GET/PUT per-vault AI config (encrypted, key never echoed)"
```

---

### Task 6: Per-vault key resolution in the AI routes

**Files:**
- Modify: `landing/server/ai/openai.ts`, `landing/server/ai/routes.ts`, `landing/server/express.d.ts`
- Create: `landing/server/ai/vaultAI.ts`, `landing/server/ai/vaultAI.test.ts`

- [ ] **Step 1: Write the failing resolver test**

Create `landing/server/ai/vaultAI.test.ts`:

```ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import crypto from "node:crypto";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VAULT_KEY_SECRET", crypto.randomBytes(32).toString("base64"));
});
afterEach(() => vi.unstubAllEnvs());

it("returns the decrypted key + model for an owned vault, {} otherwise", async () => {
  const db = await import("../db.ts");
  const { encryptKey } = await import("./keyvault.ts");
  const { resolveVaultAI } = await import("./vaultAI.ts");

  const user = db.createUser({ email: `vai-${crypto.randomUUID()}@x.io` });
  const vault = db.createVault(user.id, { name: "V" });
  db.setVaultAI(vault.id, { provider: "openai", model: "gpt-4o", apiKeyCipher: encryptKey("sk-live-xyz") });

  expect(resolveVaultAI(user.id, vault.id)).toEqual({ apiKey: "sk-live-xyz", model: "gpt-4o" });
  expect(resolveVaultAI(user.id, "not-a-vault")).toEqual({});
  expect(resolveVaultAI("someone-else", vault.id)).toEqual({}); // ownership enforced
  expect(resolveVaultAI(user.id, undefined)).toEqual({});
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `cd landing && npx vitest run server/ai/vaultAI.test.ts`
Expected: FAIL — `./vaultAI.ts` doesn't exist.

- [ ] **Step 3: Implement the resolver**

Create `landing/server/ai/vaultAI.ts`:

```ts
/**
 * Resolve a vault's AI key + model for a request, ownership-checked. Returns an
 * empty object when there's no owned vault, no per-vault config, or the key can't
 * be decrypted — callers then fall back to the global OPENAI_API_KEY.
 */
import { getOwnedVault, getVaultAIRow } from "../db.ts";
import { decryptKey } from "./keyvault.ts";

export interface ResolvedVaultAI {
  apiKey?: string;
  model?: string;
}

export function resolveVaultAI(userId: string | null, vaultId: string | null | undefined): ResolvedVaultAI {
  if (!userId || !vaultId) return {};
  if (!getOwnedVault(userId, vaultId)) return {};
  const row = getVaultAIRow(vaultId);
  if (!row) return {};
  const out: ResolvedVaultAI = {};
  if (row.model) out.model = row.model;
  if (row.api_key_cipher) {
    try {
      out.apiKey = decryptKey(row.api_key_cipher);
    } catch {
      /* corrupt/old cipher → fall back to global */
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test; verify it passes**

Run: `cd landing && npx vitest run server/ai/vaultAI.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `clientFor` + overrides to `openai.ts`**

In `landing/server/ai/openai.ts`, add an exported `clientFor` and thread overrides through `complete`/`transcribe`:

```ts
/** Build an SDK client for a specific key, or the global one (null if neither). */
export function clientFor(apiKey?: string): OpenAI | null {
  if (apiKey) return new OpenAI({ apiKey });
  return getOpenAI();
}
```

Change `complete` and `transcribe` signatures:

```ts
export async function complete(opts: {
  system: string;
  user: string;
  maxTokens: number;
  apiKey?: string;
  model?: string;
}): Promise<string> {
  const openai = clientFor(opts.apiKey);
  if (!openai) throw new AINotConfiguredError();
  const res = await openai.chat.completions.create({
    model: opts.model || TEXT_MODEL,
    max_tokens: opts.maxTokens,
    temperature: 0.4,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}

export async function transcribe(audio: Buffer, mime: string, opts?: { apiKey?: string }): Promise<string> {
  const openai = clientFor(opts?.apiKey);
  if (!openai) throw new AINotConfiguredError();
  const ext = mime.includes("mp4") || mime.includes("mpeg") ? "mp4" : "webm";
  const file = await toFile(audio, `lecture.${ext}`, { type: mime });
  const res = await openai.audio.transcriptions.create({ model: TRANSCRIBE_MODEL, file });
  return res.text.trim();
}
```

- [ ] **Step 6: Augment the request type**

In `landing/server/express.d.ts`, add to the `Request` augmentation (alongside `apiUser`):

```ts
    vaultAI?: { apiKey?: string; model?: string };
```

- [ ] **Step 7: Resolve + stash in `requireAI`, thread through handlers**

In `landing/server/ai/routes.ts`:

Add imports:
```ts
import { getCurrentUser } from "../auth/session.ts"; // already imported
import { resolveVaultAI } from "./vaultAI.ts";
```

Replace `requireAI` (around `routes.ts:93`):

```ts
// Resolve any per-vault key/model, then gate: available if the vault has a key
// OR the global key is configured. Stashes the resolution for handlers to use.
function requireAI(req: Request, res: Response, next: NextFunction): void {
  const userId = getCurrentUser(req)?.id ?? null;
  const resolved = resolveVaultAI(userId, req.get("x-noto-vault"));
  req.vaultAI = resolved;
  if (!env.openaiConfigured && !resolved.apiKey) {
    res.status(503).json({ error: "AI is not configured on this server." });
    return;
  }
  next();
}
```

In each handler that calls `complete(...)`, pass the overrides. For example, `/chat`:

```ts
    const reply = await complete({
      system: SYSTEM.chat,
      user: buildChatPrompt(parsed.data),
      maxTokens: MAX_TOKENS.chat,
      apiKey: req.vaultAI?.apiKey,
      model: req.vaultAI?.model,
    });
```

Apply the same `apiKey`/`model` pass-through to `/summarize`, `/flashcards`, `/find-links`, and `/lecture-notes`. For `/transcribe`, pass only the key:

```ts
    const transcript = await transcribe(audio, mime, { apiKey: req.vaultAI?.apiKey });
```

- [ ] **Step 8: Update the existing AI route tests' mock signature**

`landing/server/ai/routes.test.ts` mocks `./openai.ts`. Add `clientFor` to the mock object so the new import resolves:

```ts
  clientFor: vi.fn(() => ({})),
```

Run: `cd landing && npx vitest run server/ai/routes.test.ts`
Expected: PASS (existing happy-path + auth-gating tests still green; `complete` is still called, now with extra `apiKey: undefined, model: undefined` args).

- [ ] **Step 9: Full server suite + typecheck**

Run: `cd landing && npx vitest run server/ && npm run typecheck:server`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add landing/server/ai/openai.ts landing/server/ai/routes.ts landing/server/ai/vaultAI.ts landing/server/ai/vaultAI.test.ts landing/server/express.d.ts landing/server/ai/routes.test.ts
git commit -m "feat(vaults): resolve per-vault AI key/model in AI routes (global fallback)"
```

---

## PHASE 2 — Switcher (frontend)

### Task 7: API client — vault types, `createVault`, `vaultAI`, active-vault header

**Files:**
- Modify: `landing/src/app/api.ts`

- [ ] **Step 1: Extend the `Vault` type + add the active-vault header**

In `landing/src/app/api.ts`, update the `Vault` interface (around `api.ts:21`):

```ts
export interface Vault {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

export interface VaultAIConfig {
  provider: string;
  model: string | null;
  configured: boolean;
}
```

Add a module-level active-vault id that `request()` attaches as a header so AI calls carry the vault context (place above `request`):

```ts
let activeVaultId: string | null = null;
/** Set the vault whose context (per-vault AI key/model) AI requests should use. */
export function setActiveVault(id: string | null): void {
  activeVaultId = id;
}
```

In `request()`, after building `headers` (around `api.ts:52`), add:

```ts
  if (activeVaultId) headers["x-noto-vault"] = activeVaultId;
```

- [ ] **Step 2: Add the client methods**

In the `api` object, replace the `listVaults` line and add new methods near the notes section (around `api.ts:191`):

```ts
  /* notes */
  listVaults: () => request<{ vaults: Vault[] }>("GET", "/api/vaults"),
  createVault: (input: { name: string; icon?: string | null; color?: string | null }) =>
    request<{ vault: Vault }>("POST", "/api/vaults", input),
  vaultAI: {
    get: (vaultId: string) => request<VaultAIConfig>("GET", `/api/vaults/${vaultId}/ai`),
    set: (vaultId: string, input: { provider: string; model?: string | null; apiKey?: string }) =>
      request<VaultAIConfig>("PUT", `/api/vaults/${vaultId}/ai`, input),
  },
```

- [ ] **Step 3: Typecheck**

Run: `cd landing && npx tsc -b`
Expected: PASS (no usages broken — `Vault` consumers don't yet read icon/color).

- [ ] **Step 4: Commit**

```bash
git add landing/src/app/api.ts
git commit -m "feat(vaults): api client — vault icon/color, createVault, vaultAI, active-vault header"
```

---

### Task 8: `pickInitialVault` helper + vault-aware `useVault`

**Files:**
- Create: `landing/src/workspace/vaultIcons.ts` (helper home), `landing/src/workspace/vaultIcons.test.ts`
- Modify: `landing/src/app/useVault.ts`, `landing/src/app/NotoWorkspace.tsx`

- [ ] **Step 1: Write the failing helper test**

Create `landing/src/workspace/vaultIcons.test.ts` (first assertion only; the icon constants come in Task 9):

```ts
import { describe, expect, it } from "vitest";
import { pickInitialVault } from "./vaultIcons";

const vaults = [
  { id: "a", name: "A", icon: null, color: null },
  { id: "b", name: "B", icon: null, color: null },
];

describe("pickInitialVault", () => {
  it("prefers the persisted id when it still exists", () => {
    expect(pickInitialVault(vaults, "b")?.id).toBe("b");
  });
  it("falls back to the first vault when the persisted id is gone", () => {
    expect(pickInitialVault(vaults, "zzz")?.id).toBe("a");
  });
  it("falls back to the first vault when nothing is persisted", () => {
    expect(pickInitialVault(vaults, null)?.id).toBe("a");
  });
  it("returns null for an empty list", () => {
    expect(pickInitialVault([], "a")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `cd landing && npx vitest run src/workspace/vaultIcons.test.ts`
Expected: FAIL — `vaultIcons.ts` / `pickInitialVault` missing.

- [ ] **Step 3: Create the helper module**

Create `landing/src/workspace/vaultIcons.ts` (constants land in Task 9; for now just the helper + the shared `VaultSummary` type):

```ts
export interface VaultSummary {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

/** Choose the vault to open on load: the persisted one if present, else the first. */
export function pickInitialVault<T extends { id: string }>(vaults: T[], persistedId: string | null): T | null {
  if (vaults.length === 0) return null;
  if (persistedId) {
    const hit = vaults.find((v) => v.id === persistedId);
    if (hit) return hit;
  }
  return vaults[0];
}
```

- [ ] **Step 4: Run the test; verify it passes**

Run: `cd landing && npx vitest run src/workspace/vaultIcons.test.ts`
Expected: PASS.

- [ ] **Step 5: Make `useVault` vault-aware**

In `landing/src/app/useVault.ts`:

Add imports + a persistence key helper at the top:

```ts
import { api, ApiError, setActiveVault, type Vault } from "./api";
import { pickInitialVault } from "../workspace/vaultIcons";

const ACTIVE_VAULT_KEY = (userId: string) => `noto:active-vault:${userId}`;
```

Extend the `UseVault` interface:

```ts
  vaults: Vault[];
  activeVaultId: string;
  selectVault: (id: string) => Promise<void>;
  createVault: (input: { name: string; icon?: string | null; color?: string | null }) => Promise<Vault | null>;
```

Change the hook signature to take the user id and hold the vault list:

```ts
export function useVault(userId: string): UseVault {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [vault, setVault] = useState<Vault | null>(null);
  // ...existing files/activeFileId/saveStatus/pending/timer state unchanged...
```

Replace the initial-load effect (around `useVault.ts:67-88`) to honor the persisted vault and seed `setActiveVault`:

```ts
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { vaults: list } = await api.listVaults();
        let persisted: string | null = null;
        try { persisted = localStorage.getItem(ACTIVE_VAULT_KEY(userId)); } catch { /* ignore */ }
        const initial = pickInitialVault(list, persisted);
        if (!initial) throw new Error("No vault");
        const { files: loaded } = await api.listFiles(initial.id);
        if (cancelled) return;
        setVaults(list);
        setVault(initial);
        setActiveVault(initial.id);
        setFiles(loaded);
        setActiveFileId(loaded[0]?.id ?? "");
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Could not load your vault.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);
```

Add `selectVault` and `createVault` (place near the other callbacks):

```ts
  const selectVault = useCallback(
    async (id: string): Promise<void> => {
      if (id === vault?.id) return;
      await flush();
      try {
        const target = vaults.find((v) => v.id === id);
        if (!target) return;
        const { files: loaded } = await api.listFiles(id);
        setVault(target);
        setActiveVault(id);
        setFiles(loaded);
        setActiveFileId(loaded[0]?.id ?? "");
        setSaveStatus("idle");
        try { localStorage.setItem(ACTIVE_VAULT_KEY(userId), id); } catch { /* ignore */ }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not open that vault.");
      }
    },
    [vault, vaults, flush, userId],
  );

  const createVault = useCallback(
    async (input: { name: string; icon?: string | null; color?: string | null }): Promise<Vault | null> => {
      try {
        const { vault: created } = await api.createVault(input);
        setVaults((prev) => [...prev, created]);
        await flush();
        const { files: loaded } = await api.listFiles(created.id);
        setVault(created);
        setActiveVault(created.id);
        setFiles(loaded);
        setActiveFileId(loaded[0]?.id ?? "");
        try { localStorage.setItem(ACTIVE_VAULT_KEY(userId), created.id); } catch { /* ignore */ }
        return created;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not create the vault.");
        return null;
      }
    },
    [flush, userId],
  );
```

Add `vaults`, `vault`, `activeVaultId: vault?.id ?? ""`, `selectVault`, `createVault` to the returned object.

- [ ] **Step 6: Update the caller**

In `landing/src/app/NotoWorkspace.tsx`, pass the user id:

```ts
  const v = useVault(user.id);
```

(Controller wiring for the switcher comes in Task 10; this step only keeps the build green.)

- [ ] **Step 7: Typecheck + unit tests**

Run: `cd landing && npx tsc -b && npx vitest run src/workspace/vaultIcons.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add landing/src/workspace/vaultIcons.ts landing/src/workspace/vaultIcons.test.ts landing/src/app/useVault.ts landing/src/app/NotoWorkspace.tsx
git commit -m "feat(vaults): vault-aware useVault (list/select/create + persistence)"
```

---

### Task 9: `VaultBadge` + emoji/color constants

**Files:**
- Modify: `landing/src/workspace/vaultIcons.ts`, `landing/src/workspace/vaultIcons.test.ts`
- Create: `landing/src/workspace/VaultBadge.tsx`
- Modify: `landing/src/styles/workspace.css`

- [ ] **Step 1: Add the failing `tintFor` test**

Append to `landing/src/workspace/vaultIcons.test.ts`:

```ts
import { VAULT_EMOJI, VAULT_COLORS, tintFor } from "./vaultIcons";

describe("vault icon constants", () => {
  it("exposes non-empty curated emoji + color sets", () => {
    expect(VAULT_EMOJI.length).toBeGreaterThanOrEqual(8);
    expect(VAULT_COLORS.length).toBeGreaterThanOrEqual(6);
  });
  it("maps a known color token to a tint, and falls back for unknowns", () => {
    expect(tintFor("blue")).toMatch(/rgba|#/);
    expect(tintFor("not-a-color")).toBe(tintFor("blue")); // default = first/accent
    expect(tintFor(null)).toBe(tintFor("blue"));
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `cd landing && npx vitest run src/workspace/vaultIcons.test.ts`
Expected: FAIL — `VAULT_EMOJI`/`VAULT_COLORS`/`tintFor` missing.

- [ ] **Step 3: Add the constants + tint resolver**

Append to `landing/src/workspace/vaultIcons.ts`:

```ts
export const VAULT_EMOJI = ["📚", "🧪", "💼", "🎓", "🧠", "🔬", "📐", "☕", "📓", "🗂️", "🎨", "💡"] as const;

/** Color tokens stored on the vault; each maps to a swatch + a soft tile tint. */
export const VAULT_COLORS = [
  { token: "blue", swatch: "#578FFA", tint: "rgba(87,143,250,0.18)" },
  { token: "amber", swatch: "#EF9F27", tint: "rgba(239,159,39,0.18)" },
  { token: "teal", swatch: "#1D9E75", tint: "rgba(29,158,117,0.20)" },
  { token: "purple", swatch: "#7F77DD", tint: "rgba(127,119,221,0.22)" },
  { token: "coral", swatch: "#D85A30", tint: "rgba(216,90,48,0.20)" },
  { token: "pink", swatch: "#D4537E", tint: "rgba(212,83,126,0.20)" },
  { token: "gray", swatch: "#888780", tint: "rgba(136,135,128,0.22)" },
] as const;

export function tintFor(color: string | null | undefined): string {
  const hit = VAULT_COLORS.find((c) => c.token === color);
  return (hit ?? VAULT_COLORS[0]).tint;
}
export function swatchFor(color: string | null | undefined): string {
  const hit = VAULT_COLORS.find((c) => c.token === color);
  return (hit ?? VAULT_COLORS[0]).swatch;
}
```

- [ ] **Step 4: Run the test; verify it passes**

Run: `cd landing && npx vitest run src/workspace/vaultIcons.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `VaultBadge.tsx`**

Create `landing/src/workspace/VaultBadge.tsx`:

```tsx
import { tintFor } from "./vaultIcons";

interface Props {
  icon: string | null;
  color: string | null;
  name: string;
  size?: number;
}

/** Emoji-on-color-tile vault badge. Falls back to a monogram when icon is null. */
export function VaultBadge({ icon, color, name, size = 28 }: Props) {
  const style = { width: size, height: size, background: tintFor(color), fontSize: Math.round(size * 0.55) };
  return (
    <span className={"nw-vbadge" + (icon ? "" : " is-mono")} style={style} aria-hidden="true">
      {icon ?? (name[0] || "N").toUpperCase()}
    </span>
  );
}
```

- [ ] **Step 6: Add badge CSS**

Append to `landing/src/styles/workspace.css`:

```css
.nw-vbadge {
  display: flex; align-items: center; justify-content: center;
  border-radius: 8px; flex: none; line-height: 1;
}
.nw-vbadge.is-mono {
  color: #fff; font-weight: 700;
  background: linear-gradient(140deg, #578ffa, #3c6fd6) !important;
}
```

- [ ] **Step 7: Typecheck**

Run: `cd landing && npx tsc -b`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add landing/src/workspace/vaultIcons.ts landing/src/workspace/vaultIcons.test.ts landing/src/workspace/VaultBadge.tsx landing/src/styles/workspace.css
git commit -m "feat(vaults): VaultBadge + curated emoji/color constants"
```

---

### Task 10: `VaultSwitcher` popover + wire into the sidebar

**Files:**
- Create: `landing/src/workspace/VaultSwitcher.tsx`
- Modify: `landing/src/workspace/types.ts`, `landing/src/workspace/Sidebar.tsx`, `landing/src/workspace/NotoWindow.tsx`, `landing/src/app/NotoWorkspace.tsx`, `landing/src/styles/workspace.css`

- [ ] **Step 1: Extend `VaultController`**

In `landing/src/workspace/types.ts`, import the summary type and add the switcher surface to `VaultController`:

```ts
import type { VaultSummary } from "./vaultIcons";
```

```ts
  /** Multi-vault surface (real app only; demo provides a single entry). */
  vaults?: VaultSummary[];
  activeVaultId?: string;
  selectVault?: (id: string) => void | Promise<void>;
  createVault?: (input: { name: string; icon?: string | null; color?: string | null }) => Promise<VaultSummary | null>;
```

- [ ] **Step 2: Create `VaultSwitcher.tsx`**

Create `landing/src/workspace/VaultSwitcher.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { VaultBadge } from "./VaultBadge";
import type { VaultSummary } from "./vaultIcons";

interface Props {
  vaults: VaultSummary[];
  activeVaultId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function VaultSwitcher({ vaults, activeVaultId, onSelect, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const active = vaults.find((v) => v.id === activeVaultId) ?? vaults[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!active) return null;

  return (
    <div className="nw-vswitch">
      <button className="nw-vswitch-trigger" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <VaultBadge icon={active.icon} color={active.color} name={active.name} />
        <span className="nw-vault-text">
          <span className="nw-vault-name">{active.name}</span>
          <span className="nw-vault-sub">{vaults.length === 1 ? "Local Markdown Vault" : `${vaults.length} vaults`}</span>
        </span>
        <Icon name="chevron" size={15} stroke={2} />
      </button>

      {open && (
        <>
          <div className="nw-menu-scrim" onClick={() => setOpen(false)} />
          <div className="nw-menu nw-vault-menu" role="menu">
            <div className="nw-menu-label">Vaults</div>
            {vaults.map((v) => (
              <button
                key={v.id}
                className={"nw-menu-item nw-vault-item" + (v.id === active.id ? " is-active" : "")}
                onClick={() => { setOpen(false); if (v.id !== active.id) onSelect(v.id); }}
                role="menuitem"
              >
                <VaultBadge icon={v.icon} color={v.color} name={v.name} size={24} />
                <span className="nw-vault-item-name">{v.name}</span>
                {v.id === active.id && <span className="nw-vault-check" aria-hidden="true">✓</span>}
              </button>
            ))}
            <div className="nw-menu-sep" />
            <button className="nw-menu-item nw-vault-new" onClick={() => { setOpen(false); onCreate(); }} role="menuitem">
              <Icon name="plus" size={16} stroke={1.8} />
              <span>New vault</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Render it in the sidebar**

In `landing/src/workspace/Sidebar.tsx`, extend `Props` with the switcher inputs and replace the static `.nw-vault` block (around `Sidebar.tsx:59-65`).

Add to `Props`:
```ts
  vaults?: import("./vaultIcons").VaultSummary[];
  activeVaultId?: string;
  onSelectVault?: (id: string) => void;
  onCreateVault?: () => void;
```

Add `import { VaultSwitcher } from "./VaultSwitcher";` at the top, and replace the `<div className="nw-vault">…</div>` with:

```tsx
        {vaults && vaults.length > 0 && activeVaultId !== undefined && onSelectVault && onCreateVault ? (
          <VaultSwitcher
            vaults={vaults}
            activeVaultId={activeVaultId}
            onSelect={onSelectVault}
            onCreate={onCreateVault}
          />
        ) : (
          <div className="nw-vault">
            <div className="nw-vault-badge">{(vaultName[0] || "N").toUpperCase()}</div>
            <div className="nw-vault-text">
              <div className="nw-vault-name">{vaultName}</div>
              <div className="nw-vault-sub">Local Markdown Vault</div>
            </div>
          </div>
        )}
```

(The fallback preserves the demo's single-vault look.) Destructure the new props in the component body.

- [ ] **Step 4: Thread props from `NotoWindow` + controller**

In `landing/src/workspace/NotoWindow.tsx`, add state for the create modal and pass switcher props to `<Sidebar>` (the modal itself is wired in Task 11 — for now `onCreateVault` opens a not-yet-built modal, so add the state placeholder):

```tsx
  const [createVaultOpen, setCreateVaultOpen] = useState(false);
```

Pass to `<Sidebar ...>`:

```tsx
            vaults={controller.vaults}
            activeVaultId={controller.activeVaultId}
            onSelectVault={controller.selectVault ? (id) => void controller.selectVault!(id) : undefined}
            onCreateVault={controller.createVault ? () => setCreateVaultOpen(true) : undefined}
```

(`createVaultOpen` is referenced in Task 11; ESLint may warn it's unused until then — acceptable mid-phase, or add `void createVaultOpen;` temporarily and remove it in Task 11.)

- [ ] **Step 5: Map the controller in `NotoWorkspace`**

In `landing/src/app/NotoWorkspace.tsx`, add to the `controller` object:

```ts
    vaults: v.vaults,
    activeVaultId: v.activeVaultId,
    selectVault: v.selectVault,
    createVault: v.createVault,
```

- [ ] **Step 6: Add switcher + menu CSS**

Append to `landing/src/styles/workspace.css`:

```css
.nw-vswitch { position: relative; margin-bottom: 14px; }
.nw-vswitch-trigger {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 7px 8px; border-radius: 9px; cursor: pointer;
  background: transparent; border: 1px solid transparent; color: inherit; font-family: inherit; text-align: left;
}
.nw-vswitch-trigger:hover { background: var(--color-card); border-color: var(--color-line); }
.nw-vault-menu { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 30; }
.nw-menu-label { font-size: 11px; color: var(--nw-dim); padding: 6px 10px 4px; }
.nw-menu-sep { height: 1px; background: var(--color-line); margin: 6px 8px; }
.nw-vault-item { display: flex; align-items: center; gap: 9px; }
.nw-vault-item.is-active { background: var(--nw-accent-soft); }
.nw-vault-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nw-vault-check { color: var(--nw-accent); }
.nw-vault-new { color: var(--nw-accent); }
```

(If `--nw-accent`/`--nw-accent-soft`/`--nw-dim`/`--color-card`/`--color-line` aren't all defined in `workspace.css`'s scope, reuse whichever the existing `.nw-*` rules use — grep `--nw-accent` in `workspace.css` to confirm the exact token names.)

- [ ] **Step 7: Verify in the browser (no RTL for components)**

Run the dev server and verify the switcher renders, opens, lists vaults, and switches:

1. `preview_start` (dev server: `npm run dev` in `landing/`).
2. `preview_eval`: `window.location.reload()` if needed.
3. `preview_console_logs` → no errors.
4. `preview_snapshot` → the sidebar shows the vault trigger; clicking it (`preview_click`) shows the popover with the vault list + "New vault".
5. With a second vault present (create one via the API or DB), `preview_click` a different vault → `preview_snapshot` confirms the file list changed.
6. `preview_screenshot` → attach as proof.

- [ ] **Step 8: Lint + typecheck + tests**

Run: `cd landing && npm run lint && npx tsc -b && npx vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add landing/src/workspace/VaultSwitcher.tsx landing/src/workspace/types.ts landing/src/workspace/Sidebar.tsx landing/src/workspace/NotoWindow.tsx landing/src/app/NotoWorkspace.tsx landing/src/styles/workspace.css
git commit -m "feat(vaults): sidebar VaultSwitcher popover wired to useVault"
```

---

## PHASE 3 — Create modal (name + icon)

### Task 11: `CreateVaultModal` (name, emoji, color) wired to create

**Files:**
- Create: `landing/src/workspace/CreateVaultModal.tsx`
- Modify: `landing/src/workspace/NotoWindow.tsx`, `landing/src/styles/workspace.css`

- [ ] **Step 1: Create the modal (Advanced section is a stub here; filled in Task 12)**

Create `landing/src/workspace/CreateVaultModal.tsx`:

```tsx
import { useState } from "react";
import { VaultBadge } from "./VaultBadge";
import { VAULT_EMOJI, VAULT_COLORS, type VaultSummary } from "./vaultIcons";

interface Props {
  onClose: () => void;
  onCreate: (input: { name: string; icon: string; color: string }) => Promise<VaultSummary | null>;
}

export function CreateVaultModal({ onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string>(VAULT_EMOJI[0]);
  const [color, setColor] = useState<string>(VAULT_COLORS[0].token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const created = await onCreate({ name: name.trim(), icon, color });
    setBusy(false);
    if (created) onClose();
    else setError("Could not create the vault. Please try again.");
  }

  return (
    <>
      <div className="nw-menu-scrim" onClick={onClose} />
      <div className="nw-modal nw-createvault" role="dialog" aria-modal="true" aria-labelledby="cv-title">
        <header className="nw-modal-head">
          <h2 id="cv-title">Create a new vault</h2>
          <button className="nw-mcp-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <p className="nw-modal-sub">Name it, give it an icon, and optionally connect an AI.</p>

        <div className="nw-cv-namerow">
          <VaultBadge icon={icon} color={color} name={name || "?"} size={48} />
          <label className="nw-cv-field">
            <span className="nw-cv-label">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder="e.g. Thesis"
              maxLength={60}
            />
          </label>
        </div>

        <div className="nw-cv-label">Choose an icon</div>
        <div className="nw-cv-emoji">
          {VAULT_EMOJI.map((e) => (
            <button
              key={e}
              className={"nw-cv-emoji-btn" + (e === icon ? " is-sel" : "")}
              onClick={() => setIcon(e)}
              aria-label={`Icon ${e}`}
              aria-pressed={e === icon}
            >
              {e}
            </button>
          ))}
        </div>

        <div className="nw-cv-colors">
          {VAULT_COLORS.map((c) => (
            <button
              key={c.token}
              className={"nw-cv-color" + (c.token === color ? " is-sel" : "")}
              style={{ background: c.swatch }}
              onClick={() => setColor(c.token)}
              aria-label={`Color ${c.token}`}
              aria-pressed={c.token === color}
            />
          ))}
        </div>

        {error && <p className="nw-cv-error">{error}</p>}

        <footer className="nw-modal-foot">
          <button className="nw-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="nw-btn-primary" onClick={() => void submit()} disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create vault"}
          </button>
        </footer>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Host it in `NotoWindow`**

In `landing/src/workspace/NotoWindow.tsx`, import the modal and render it when `createVaultOpen` and the controller supports creating. Add near the other overlays (around `NotoWindow.tsx:326`):

```tsx
      {createVaultOpen && controller.createVault && (
        <CreateVaultModal
          onClose={() => setCreateVaultOpen(false)}
          onCreate={(input) => controller.createVault!(input)}
        />
      )}
```

Add the import: `import { CreateVaultModal } from "./CreateVaultModal";`. Remove any temporary `void createVaultOpen;` left from Task 10.

- [ ] **Step 3: Add modal CSS**

Append to `landing/src/styles/workspace.css` (reuse `.nw-menu-scrim`; model the surface on the existing `.nw-mcp-panel`):

```css
.nw-modal {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 440px; max-width: calc(100vw - 32px); z-index: 60;
  background: var(--color-panel); border: 1px solid var(--color-line-strong);
  border-radius: 14px; padding: 20px; box-shadow: var(--shadow-floating);
}
.nw-modal-head { display: flex; align-items: center; justify-content: space-between; }
.nw-modal-head h2 { font-size: 16px; font-weight: 600; margin: 0; }
.nw-modal-sub { font-size: 12px; color: var(--nw-dim); margin: 4px 0 16px; }
.nw-cv-namerow { display: flex; align-items: flex-end; gap: 12px; margin-bottom: 16px; }
.nw-cv-field { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.nw-cv-label { font-size: 11px; color: var(--nw-dim); }
.nw-cv-field input {
  height: 34px; border-radius: 8px; padding: 0 11px; font-size: 13px; font-family: inherit;
  background: var(--color-field); border: 1px solid var(--color-line); color: var(--nw-ink);
}
.nw-cv-emoji { display: flex; gap: 8px; flex-wrap: wrap; margin: 6px 0 12px; }
.nw-cv-emoji-btn {
  width: 34px; height: 34px; border-radius: 8px; font-size: 18px; cursor: pointer;
  background: var(--color-card); border: 1px solid transparent;
}
.nw-cv-emoji-btn.is-sel { outline: 2px solid var(--nw-accent); outline-offset: 2px; }
.nw-cv-colors { display: flex; gap: 10px; margin-bottom: 16px; }
.nw-cv-color { width: 18px; height: 18px; border-radius: 50%; cursor: pointer; border: none; }
.nw-cv-color.is-sel { outline: 2px solid var(--nw-ink); outline-offset: 2px; }
.nw-cv-error { font-size: 12px; color: var(--color-recorder-red); margin: 0 0 12px; }
.nw-modal-foot { display: flex; justify-content: flex-end; gap: 9px; }
.nw-btn-ghost { height: 36px; padding: 0 16px; border-radius: 8px; background: transparent; border: 1px solid var(--color-line-strong); color: var(--nw-soft-2); cursor: pointer; font-family: inherit; }
.nw-btn-primary { height: 36px; padding: 0 18px; border-radius: 8px; background: var(--nw-accent); border: none; color: #fff; font-weight: 600; cursor: pointer; font-family: inherit; }
.nw-btn-primary:disabled { opacity: 0.5; cursor: default; }
```

(Confirm the exact token names — `--color-panel`, `--nw-accent`, `--nw-ink`, `--nw-dim`, `--nw-soft-2` — by grepping `workspace.css`; substitute the ones already in use there.)

- [ ] **Step 4: Verify in the browser**

1. `preview_start` (or reuse the running server).
2. Open the switcher → click "New vault" → `preview_snapshot` shows the modal.
3. `preview_fill` the name; `preview_click` an emoji + a color → badge preview updates (`preview_snapshot`).
4. `preview_click` "Create vault" → modal closes, the new vault becomes active, and its Welcome note is open (`preview_snapshot`).
5. `preview_console_logs` → no errors. `preview_screenshot` → proof.

- [ ] **Step 5: Lint + typecheck + tests**

Run: `cd landing && npm run lint && npx tsc -b && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add landing/src/workspace/CreateVaultModal.tsx landing/src/workspace/NotoWindow.tsx landing/src/styles/workspace.css
git commit -m "feat(vaults): CreateVaultModal (name + emoji + color) wired to create"
```

---

## PHASE 4 — Advanced AI hookup

### Task 12: Advanced disclosure — per-vault AI key/model + Connect tools

**Files:**
- Modify: `landing/src/workspace/CreateVaultModal.tsx`, `landing/src/workspace/NotoWindow.tsx`, `landing/src/styles/workspace.css`

- [ ] **Step 1: Accept an `onConnectTools` prop + add the Advanced section**

In `landing/src/workspace/CreateVaultModal.tsx`, extend `Props`:

```ts
  /** Opens the existing "Connect AI tools" panel (reused, user-scoped in v1). */
  onConnectTools?: () => void;
```

Add Advanced state below the existing `useState`s:

```ts
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
```

After a successful create, persist the AI config when a key was entered. Replace the body of `submit()`'s success branch:

```ts
    const created = await onCreate({ name: name.trim(), icon, color });
    if (created && apiKey.trim()) {
      try {
        const { api } = await import("../app/api");
        await api.vaultAI.set(created.id, { provider, model, apiKey: apiKey.trim() });
      } catch { /* non-fatal: vault still created */ }
    }
    setBusy(false);
    if (created) onClose();
    else setError("Could not create the vault. Please try again.");
```

Add the Advanced `<details>` before the footer:

```tsx
        <details className="nw-cv-adv">
          <summary>Advanced settings <span className="nw-cv-adv-hint">Hook up an AI · optional</span></summary>

          <div className="nw-cv-adv-grid">
            <div className="nw-cv-card">
              <div className="nw-cv-card-title">AI brain</div>
              <label className="nw-cv-label">Provider</label>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="openai">OpenAI</option>
              </select>
              <label className="nw-cv-label">API key</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" autoComplete="off" />
              <label className="nw-cv-label">Model</label>
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4o">gpt-4o</option>
              </select>
            </div>

            <div className="nw-cv-card">
              <div className="nw-cv-card-title">Connect tools</div>
              <p className="nw-cv-card-note">Share memory with your AI tools.</p>
              <button className="nw-btn-ghost nw-cv-connect" onClick={onConnectTools} disabled={!onConnectTools}>
                Connect Claude Code, Cursor, Codex…
              </button>
            </div>
          </div>
        </details>
```

> The Connect button opens the existing user-scoped `McpSettings`. Copy must not imply per-vault isolation (per spec §8). The single button keeps v1 honest; per-tool rows are cosmetic and deferred.

- [ ] **Step 2: Wire `onConnectTools` from `NotoWindow`**

In `landing/src/workspace/NotoWindow.tsx`, the `McpSettings` panel is already toggled by `mcpOpen`. Pass an opener to the modal:

```tsx
      {createVaultOpen && controller.createVault && (
        <CreateVaultModal
          onClose={() => setCreateVaultOpen(false)}
          onCreate={(input) => controller.createVault!(input)}
          onConnectTools={mcpClient ? () => { setCreateVaultOpen(false); setMcpOpen(true); } : undefined}
        />
      )}
```

- [ ] **Step 3: Add Advanced CSS**

Append to `landing/src/styles/workspace.css`:

```css
.nw-cv-adv { margin: 4px 0 16px; border-top: 1px solid var(--color-line); padding-top: 14px; }
.nw-cv-adv > summary { font-size: 12.5px; font-weight: 600; cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; }
.nw-cv-adv-hint { font-size: 11px; color: var(--nw-dim); font-weight: 400; margin-left: auto; }
.nw-cv-adv-grid { display: flex; gap: 10px; margin-top: 12px; }
.nw-cv-card { flex: 1; background: var(--color-card); border: 1px solid var(--color-line); border-radius: 10px; padding: 12px; }
.nw-cv-card-title { font-size: 12px; font-weight: 600; margin-bottom: 9px; }
.nw-cv-card-note { font-size: 11px; color: var(--nw-dim); margin: 0 0 9px; }
.nw-cv-card select, .nw-cv-card input {
  width: 100%; height: 30px; border-radius: 7px; padding: 0 9px; margin-bottom: 8px; box-sizing: border-box;
  background: var(--color-field); border: 1px solid var(--color-line); color: var(--nw-ink); font-family: inherit; font-size: 12px;
}
.nw-cv-connect { width: 100%; font-size: 12px; }
```

- [ ] **Step 4: Verify in the browser**

1. Open create modal → expand "Advanced settings" → `preview_snapshot` shows the two cards.
2. Fill name + an API key + pick a model; `preview_click` "Create vault".
3. `preview_network` → confirm a `PUT /api/vaults/:id/ai` fired after `POST /api/vaults`, and the response body does **not** contain the key (it returns `{provider, model, configured:true}`).
4. Reopen the modal, click "Connect tools…" → the existing Connect panel opens (`preview_snapshot`).
5. `preview_console_logs` → clean. `preview_screenshot` → proof.

- [ ] **Step 5: Full sweep — lint, typecheck (client + server), all tests, build**

Run:
```bash
cd landing && npm run lint && npx tsc -b && npm run typecheck:server && npx vitest run && npm run build
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add landing/src/workspace/CreateVaultModal.tsx landing/src/workspace/NotoWindow.tsx landing/src/styles/workspace.css
git commit -m "feat(vaults): Advanced AI hookup — per-vault key/model + Connect tools"
```

---

## Final verification

- [ ] **All tests green:** `cd landing && npx vitest run` → PASS (including the new `db.vaults-migration`, `keyvault`, `vaultAI`, and notes-route vault tests).
- [ ] **Types + lint + build:** `npm run lint && npx tsc -b && npm run typecheck:server && npm run build` → PASS.
- [ ] **Manual smoke (preview):** create two vaults with different emoji/color, switch between them (file lists swap), reload (last-active vault persists), set a per-vault key in Advanced and confirm via `preview_network` it's never echoed, and open Connect tools from the modal.
- [ ] **Env doc:** if a project `.env.example` exists, add `VAULT_KEY_SECRET=` with the generation note; otherwise mention it in the PR description so deploys can set it (absent → BYO keys disabled, global key still works).

---

## Spec coverage check

- Switcher popover (MV-D1, MV-D2) → Tasks 9, 10.
- Emoji-on-color icon (MV-D3) → Tasks 9, 11.
- Advanced holds both AI-key+model and Connect tools (MV-D4) → Task 12.
- Encrypted BYO key, masked status, never echoed (MV-D5) → Tasks 2, 3, 5; verified Task 12 step 4.
- Per-vault resolution with global fallback (MV-D6) → Task 6.
- Reuse existing Connect (MV-D7) → Task 12.
- Last-active persistence (MV-D8) → Task 8.
- Welcome-note seed (MV-D9) → Task 1.
- 20-vault cap (MV-D10) → Task 4.
- Demo single-vault not broken → Task 10 step 3 fallback.
