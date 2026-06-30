# Noto Multi-Vault Switcher & Create Flow — Design

**Date:** 2026-06-30
**Status:** Approved design (brainstorm complete) — ready for `superpowers:writing-plans`
**Depends on:** The web workspace (`landing/`). Reuses: the vault data layer in `landing/server/db.ts` (the `vaults` table already exists with `MAX_VAULTS_PER_USER = 20`, plus the unused `createVault`/`getVaultsForUser`/`countVaultsForUser` helpers), the notes API `landing/server/notes/routes.ts` (`GET /api/vaults`, `GET /api/vaults/:id/files`), the vault hook `landing/src/app/useVault.ts`, the sidebar `landing/src/workspace/Sidebar.tsx`, the OpenAI wrapper `landing/server/ai/openai.ts`, and the existing one-click Connect panel `landing/src/workspace/McpSettings.tsx`. Companion memory: `noto-webapp-redesign`, `noto-ai-implementation`, `noto-mcp-memory-layer`.

## 0. What this is

Noto users today have exactly one vault. The backend schema already supports many per user, but the frontend hardcodes `vaults[0]` (`useVault.ts:72`) and there is no UI to create or switch vaults — and no `POST /api/vaults` route at all.

This adds a **vault switcher dropdown** in the sidebar header (switch between vaults, or create one) and a **focused create-vault modal** where the user names the vault, gives it an **emoji icon on a color tile**, and — under an **Advanced** disclosure — optionally **hooks up an AI on the spot** (a per-vault provider key + model, and one-click connect of external AI tools).

The visual direction was chosen from two mockups during brainstorming: **Mockup B — "Focused modal"** (instant in-place switching via a sidebar popover; a centered modal for the deliberate act of creating). Mockup A (fully inline create) was rejected as too dense once AI setup is open.

## 1. Scope

**In:**
- `VaultSwitcher` — sidebar-header button + popover listing the user's vaults (emoji+color badge, name, note count), active check, and "Create new vault" + "Manage vaults" actions.
- Instant vault switching: `useVault` loads the selected vault's files; last-active vault persisted per user in `localStorage`.
- `CreateVaultModal` — name field, emoji picker (curated set), color swatch, live badge preview, and an **Advanced settings** disclosure.
- Advanced → **AI brain**: provider select + API-key field + model select, stored **per vault**, key **encrypted at rest**, never returned to the browser.
- Advanced → **Connect tools**: Claude Code / Cursor / Codex rows whose buttons **deep-link into the existing `McpSettings` Connect flow** (user-scoped; no new scoping in v1).
- Backend: additive `vaults` migration (`icon`, `color`); `POST /api/vaults`; a `vault_ai` table + set/get routes; per-vault key resolution in the AI routes with fallback to the global key.
- `api.createVault` + vault-AI client methods; `PublicVault` carries `icon`/`color`.
- Unit + component + migration tests; all existing tests stay green.

**Out (later / never):**
- **True per-vault binding of Connect tools** (PAT/memory scoped to a vault) — v1 reuses the user-scoped Connect flow. Deferred; see §8.
- Vault **rename / delete / reorder / icon-edit** beyond create — "Manage vaults" is a stub entry point in v1 (wired to a later screen). Create is the focus.
- Multiple AI **providers** beyond OpenAI — the provider select ships with OpenAI selected; the schema is provider-agnostic but only OpenAI is wired.
- Per-vault model used for **transcription** — v1 applies the per-vault model to chat/structuring only; transcription stays on the global `TRANSCRIBE_MODEL`.
- Sharing/collaboration, vault import/export, folders-as-vaults.
- Changing how `PersistedWorkspace` is keyed — it is already per-vault.

## 2. Locked decisions (brainstorm, 2026-06-30)

| # | Decision | Choice |
|---|----------|--------|
| MV-D1 | Switcher placement | **Sidebar header** — replaces the static `nw-vault` block with a button + popover. |
| MV-D2 | Create surface | **Focused modal** (Mockup B), not inline-in-popover (Mockup A). |
| MV-D3 | Vault icon | **Emoji on a color tile** — curated emoji set + a color swatch; badge = emoji over the tint. |
| MV-D4 | AI hookup contents | **Both** a per-vault provider key+model **and** connect-external-tools, inside the Advanced disclosure. |
| MV-D5 | AI key storage | **Encrypted BYO key.** New `vault_ai` table; key AES-256-GCM-encrypted at rest with a server master key; client gets masked status only (`configured: boolean`), never the key. |
| MV-D6 | AI key resolution | AI routes use the **active vault's** key/model; **fall back to the global `OPENAI_API_KEY`** when a vault has none. |
| MV-D7 | Connect tools depth | **Reuse existing `McpSettings`** (user-scoped PAT + shared memory). No per-vault token/memory scoping in v1. |
| MV-D8 | Switch persistence | **Last-active vault per user** in `localStorage`; per-vault workspace state already persists via `PersistedWorkspace`. |
| MV-D9 | New-vault seed | Seed a single **Welcome note** (reuse the `WELCOME_NOTE` body), mirroring `ensureDefaultVault`. |
| MV-D10 | Caps | Enforce the existing **`MAX_VAULTS_PER_USER = 20`** in the new `POST /api/vaults` route (HTTP 4xx when exceeded). |

## 3. Architecture

Component tree (frontend):

```
NotoWorkspace / AppRoot
├── Sidebar
│    └── VaultSwitcher              (replaces the static .nw-vault block)
│          ├── trigger: badge(emoji,color) + name + chevron
│          └── popover (on open):
│                ├── vault rows × N  → selectVault(id)
│                ├── "Create new vault" → opens CreateVaultModal
│                └── "Manage vaults"  (stub link, v1)
└── CreateVaultModal                (portal/overlay; focus-trapped)
     ├── name input + live badge preview
     ├── emoji grid + color swatch
     └── <details> Advanced settings
           ├── AI brain: provider / api key / model  → api.setVaultAI()
           └── Connect tools: Claude Code/Cursor/Codex → opens McpSettings
```

State flow:
- `useVault` becomes vault-aware: holds `vaults: Vault[]`, `activeVaultId`, `selectVault(id)`, `createVault(input)`. On `selectVault`, it `flush()`es pending edits, then `api.listFiles(id)` and resets active file. The current "load `vaults[0]`" bootstrap (`useVault.ts:67-88`) becomes "load the persisted last-active vault, else the first."
- `VaultController` (`landing/src/workspace/types.ts`) gains the vault list + switch/create surface so the surface-agnostic workspace can render the switcher. The marketing demo controller provides a static single vault (switcher shows one entry; create disabled in `demo` mode).

## 4. Data model (`landing/server/db.ts`)

**Additive migration on `vaults`** (same pattern as the `pinned` migration at `db.ts:163`):
```sql
ALTER TABLE vaults ADD COLUMN icon  TEXT;   -- emoji, e.g. "🎓"; null → monogram fallback
ALTER TABLE vaults ADD COLUMN color TEXT;   -- token/hex, e.g. "blue"; null → default accent
```
`PublicVault` and `getVaultsForUser` select `icon`, `color`. `createVault(userId, name, icon, color)` updated to persist them.

**New `vault_ai` table** (secrets isolated from the main vault row):
```sql
CREATE TABLE IF NOT EXISTS vault_ai (
  vault_id       TEXT PRIMARY KEY REFERENCES vaults(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL DEFAULT 'openai',
  model          TEXT,                 -- null → server default (gpt-4o-mini)
  api_key_cipher BLOB,                 -- AES-256-GCM(iv|tag|ciphertext); null → no per-vault key
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
```
Repository functions: `getVaultAI(vaultId)`, `setVaultAI(vaultId, {provider, model, apiKeyCipher})`, and an internal `resolveVaultKey(vaultId)` that decrypts the cipher (or returns the global key).

**Encryption** (`landing/server/ai/keyvault.ts`, new): AES-256-GCM via `node:crypto`. A new env var `VAULT_KEY_SECRET` (32-byte key, base64) is the master key; absence disables BYO keys (the API-key field still renders but saving returns a clear "not configured" error, and resolution falls back to the global key). `encrypt(plaintext) → iv|tag|ciphertext`; `decrypt(blob) → plaintext`. The plaintext key is **never** logged and **never** serialized to any `Public*` shape.

## 5. API (`landing/server/notes/routes.ts` + a small AI-config route)

| Method | Path | Body | Returns | Notes |
|--------|------|------|---------|-------|
| POST | `/api/vaults` | `{ name, icon?, color? }` | `{ vault: PublicVault }` | Enforces `MAX_VAULTS_PER_USER`; seeds Welcome note in a txn. Zod-validated, length caps. |
| GET | `/api/vaults` | — | `{ vaults: PublicVault[] }` | Existing; now includes `icon`/`color`. |
| PUT | `/api/vaults/:vaultId/ai` | `{ provider, model?, apiKey? }` | `{ provider, model, configured }` | Ownership-checked. `apiKey` encrypted; empty/omitted leaves existing key untouched; `apiKey:""` explicitly clears. **Never echoes the key.** |
| GET | `/api/vaults/:vaultId/ai` | — | `{ provider, model, configured }` | Masked status only. |

The AI routes (`landing/server/ai/routes.ts`) take the **active vault id** (from the request — the client already knows it) and resolve provider/model/key via `vault_ai`, falling back to `openai.ts` globals. `complete()`/`transcribe()` gain an optional per-call `apiKey`/`model` override (build a request-scoped client instead of the cached singleton when a vault key is present).

All new routes are session-protected like the rest of the notes API; every query stays parameterized (the `db.ts` invariant).

## 6. Frontend components

- **`VaultSwitcher.tsx`** — trigger renders `Badge(emoji,color)` + name + chevron; popover (reusing the existing `.nw-menu` / `.nw-menu-scrim` pattern from `Sidebar.tsx:164`) lists vaults with note counts (count = files in that vault; cheap to derive or returned by the list route). Keyboard: Esc closes, arrow-key navigation, focus returns to trigger.
- **`CreateVaultModal.tsx`** — controlled form; live badge preview; curated `EMOJI` + `COLORS` constants; `<details>` Advanced with the AI-brain fields and the Connect-tools rows. Submit → `vault.createVault({...})` → optimistic add + select → close. Validates non-empty name; disables submit while pending; surfaces server errors inline.
- **`VaultBadge.tsx`** — shared emoji-on-tint tile (used in trigger, popover rows, modal preview, and the create grid). Falls back to a monogram when `icon` is null (today's `.nw-vault-badge` gradient look).
- **CSS** in `landing/src/styles/workspace.css` — extend the `.nw-vault*` block; add `.nw-vaultmenu`, `.nw-createvault` (modal), emoji-grid, color-swatch, and badge-tint classes, all on existing design tokens (`tokens.css`).

## 7. Security

- **API keys are secrets.** Encrypted at rest (AES-256-GCM); the plaintext key never leaves the server, is never returned by any route, never logged, and is absent from `PublicVault`/any DTO. Mirrors the existing "key never reaches the browser" stance in `openai.ts`.
- **Ownership checks** on every vault-scoped route (`getOwnedVault` / join-through-vault), matching `getOwnedFile`.
- **Caps** prevent vault spam (`MAX_VAULTS_PER_USER`).
- **CSP unchanged** — the browser still never calls OpenAI directly; the per-vault key is used server-side only.
- Connect-tools reuse keeps the existing PAT scope model; no new token surface in v1.

## 8. Risks & deferrals

- **Connect-tools are user-scoped, not vault-scoped (v1).** A token "connected" while creating Vault X still sees all the user's memory/notes. Acceptable for v1 (matches today's model); true per-vault scoping is a follow-up that touches the memory/PAT layers. The modal copy must not imply per-vault isolation.
- **Per-vault key without `VAULT_KEY_SECRET`.** If the master key isn't configured, saving a BYO key fails clearly and resolution falls back to the global key — the feature degrades, never silently stores plaintext.
- **Note-count in the switcher.** If returning counts with the vault list is awkward, derive lazily (the active vault's count is known; others can show "—" until opened) rather than N extra queries.
- **Demo mode.** The marketing demo has one in-memory vault; the switcher renders a single entry and create is disabled — must not crash the demo controller.

## 9. Phasing (for the plan)

1. **Data + API (no UI):** vault `icon`/`color` migration, `POST /api/vaults`, `vault_ai` table + crypto + set/get routes, per-vault key resolution in AI routes. Tests: migration, route, encryption round-trip, ownership, caps.
2. **Switcher:** `useVault` multi-vault + persistence; `VaultSwitcher` + `VaultBadge`; wire into `Sidebar`/`VaultController`. Tests: switch reloads files, persistence, demo single-vault.
3. **Create modal:** `CreateVaultModal` (name/emoji/color), `api.createVault`, optimistic add+select. Tests: create → appears + selected; validation; cap error.
4. **Advanced AI hookup:** AI-brain fields → `setVaultAI`; Connect-tools rows → open `McpSettings`. Tests: save persists masked status; key never returned; resolution fallback.

Each phase keeps the app shippable and all existing tests green.
