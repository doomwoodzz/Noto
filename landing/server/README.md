# Noto auth server

A small, self-contained Express + SQLite backend powering the **Get Started**
sign-up / sign-in flow (`/get-started.html`). It is designed to drop onto a
single server and run: build the frontend, set a couple of env vars, start the
process, and authentication works.

## Running

```bash
# Dev — Vite (5173) + API (8787) together, with /api proxied to the API.
npm run dev

# Production — build the static frontend, then run the server which serves
# BOTH the built site and the API from one origin (no CORS surface).
npm run build
NODE_ENV=production SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") npm start
```

Copy `.env.example` → `.env` for local config. In production, inject the env
vars through your host. `SESSION_SECRET` is **recommended** in production: when
unset, the server auto-generates a strong secret and persists it in the database
on first boot, so it always starts. Set it explicitly for full control, and
**required** when running more than one instance (each instance would otherwise
mint its own secret). The secret only signs the transient OAuth state cookie;
real login sessions are opaque server-side tokens that don't depend on it.

## Architecture

| File | Responsibility |
|------|----------------|
| `index.ts` | App wiring: security headers (helmet), rate limits, body/cookie parsing, CSRF, static hosting of `dist/`, error handling. |
| `env.ts` | Loads & validates configuration; fails fast on weak/missing secrets. |
| `db.ts` | The only module with SQL. `node:sqlite`, fully parameterised. Swap to Postgres here. |
| `auth/password.ts` | scrypt hashing (built-in crypto), constant-time verify. |
| `auth/session.ts` | Server-side sessions behind an httpOnly cookie. |
| `auth/csrf.ts` | Double-submit CSRF token + Origin pinning. |
| `auth/routes.ts` | `/api/auth/*` endpoints with zod validation. |
| `auth/google.ts` | Google OAuth 2.0 (Authorization Code + PKCE). |

## API

| Method | Path | Notes |
|--------|------|-------|
| `GET`  | `/api/health` | `{ ok, googleConfigured }` |
| `GET`  | `/api/auth/me` | Current user or `401`; also seeds the CSRF cookie |
| `POST` | `/api/auth/signup` | `{ email, password }` → creates account + session |
| `POST` | `/api/auth/login` | `{ email, password }` → session (generic errors) |
| `POST` | `/api/auth/logout` | Destroys the session |
| `PATCH`| `/api/auth/preferences` | `{ theme }` (auth required) |
| `GET`  | `/api/auth/google` | Begins OAuth (redirect) |
| `GET`  | `/api/auth/google/callback` | OAuth return |

State-changing requests require the `X-CSRF-Token` header (the frontend client
handles this automatically).

## Security measures

- **Passwords**: scrypt (memory-hard, N=2¹⁶), per-hash random salt, constant-time
  verification. Login does equal work for unknown users (no timing enumeration).
- **Sessions**: 256-bit opaque random token in an **httpOnly, Secure (prod),
  SameSite=Lax** cookie. Only `sha256(token)` is stored, so a DB leak yields no
  usable tokens. A fresh session is minted on every login (fixation defence) and
  is server-side revocable.
- **CSRF**: double-submit token (readable cookie ↔ `X-CSRF-Token` header) plus
  Origin/Referer pinning to `APP_ORIGIN`. Tokens compared in constant time.
- **OAuth**: Authorization Code + PKCE, `state` (CSRF) and `nonce` validated,
  `id_token` claims (iss/aud/exp/nonce) checked. Transient state kept in a
  short-lived, HMAC-signed httpOnly cookie. Redirect targets are fixed (no open
  redirect).
- **Headers** (helmet): strict CSP (`script-src 'self'`), HSTS, `X-Content-Type-
  Options: nosniff`, `X-Frame-Options: SAMEORIGIN` / `frame-ancestors 'none'`,
  `Referrer-Policy`, `X-Powered-By` removed.
- **Rate limiting**: 10 / 15 min per IP on credential endpoints; 120 / min global
  on `/api`. `trust proxy` is set for correct client IPs behind one proxy.
- **Input validation**: zod on every payload; email normalised; password length
  bounded (anti-DoS on the KDF). JSON body capped at 16 kB.
- **SQL injection**: structurally impossible — every query is a prepared,
  parameterised statement.
- **Secrets**: never in code; `.env` is git-ignored. A strong `SESSION_SECRET`
  is used when injected, otherwise one is generated and persisted in the database
  on first boot (env-provided value always takes precedence). Errors never leak
  stack traces to clients.

## Swapping SQLite → Postgres

Re-implement `db.ts` against a `DATABASE_URL` (e.g. with `pg`). The rest of the
app depends only on the exported repository functions, not on SQLite.
