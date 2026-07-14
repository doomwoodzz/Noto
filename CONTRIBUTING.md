# Contributing

Thanks for your interest in improving Noto. It's an early, pre-1.0 project, so the
process here is deliberately lightweight — the goal is to keep changes easy to review
and the `main` branch always working.

## Ways to help

- **Report a bug** — open an issue with what you did, what you expected, and what
  happened. Include your OS and Node.js version, and reproduction steps if you can.
- **Suggest a feature** — open an issue describing the use case first, before writing
  code, so we can agree on the shape of it.
- **Send a pull request** — see below.
- **Report a security issue** — please **don't** use a public issue; follow
  [`SECURITY.md`](SECURITY.md) instead.

## Local development setup

Prerequisites: **[Node.js](https://nodejs.org) 24+**. No database or other services to
install — Noto uses Node's built-in SQLite and downloads its own local embedding model
on first run.

```bash
git clone https://github.com/doomwoodzz/Noto.git
cd Noto/landing
npm install
npm run dev
```

`npm run dev` starts the Vite client (http://localhost:5173) and the Express API
(http://127.0.0.1:8787) together. The first run downloads the MiniLM embedding model
used by Smart Search ("Smart Search assets ready.").

AI features and the GitHub/Notion connectors are optional and gated on environment
variables — copy [`landing/.env.example`](landing/.env.example) to `landing/.env` and
fill in only what you need. Everything else works without any keys.

The `noto-mcp` bridge is a separate package:

```bash
cd noto-mcp
npm install
npm run build && npm test
```

For an architecture overview and a per-directory map of the codebase, see
[`CLAUDE.md`](CLAUDE.md).

## Before you open a PR

Run the same checks CI runs, from the `landing/` directory:

```bash
npm run lint              # ESLint
npm run typecheck:server  # server TypeScript
npm test                  # Vitest
```

A production build should also succeed:

```bash
npm run build
```

## Pull request guidelines

- Branch off the default branch (`main`) and open your PR against it.
- Keep PRs focused — one logical change per PR is much easier to review.
- Write a clear description: what changed, why, and how you verified it.
- Add or update tests for behavior changes. Noto's server tests boot a real app
  instance per test file (see `landing/server/test-helpers.ts`), so integration-style
  tests are the norm.
- Make sure `lint`, `typecheck:server`, and `test` all pass.

## Code style

- TypeScript throughout; keep the existing style of the files you touch.
- Linting is enforced by ESLint (`landing/eslint.config.js`). Run `npm run lint` — CI
  will reject a red lint.

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
