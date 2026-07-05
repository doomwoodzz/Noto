# Noto — web app + server

The web half of [Noto](../README.md): a Vite + React + TypeScript front end backed by an Express/SQLite server.

> **When you listen, Noto remembers.**

## What's inside

- **Notes** with `[[wiki-links]]` and automatically generated backlinks.
- **Knowledge Web** — an interactive graph view of how notes connect.
- **Smart Search** — semantic search running locally with MiniLM embeddings.
- **Noto AI** — an OpenAI-backed layer for chat, flashcards, find-links, and lecture support.
- **Dump** — bulk-import pipeline (paste, upload, GitHub, Notion) that turns source material into atomic notes.
- **Connectors** — GitHub App and Notion OAuth integrations.
- **MCP bridge** — expose the workspace to MCP-compatible tools.
- **Accounts** — password and Google authentication with sessions.

Everything is local-first: notes persist to a local SQLite database on your own machine.

## Requirements

- [Node.js](https://nodejs.org)

## Setup

```bash
npm install
```

Copy the example environment file and fill in the keys you need:

```bash
cp .env.example .env
```

All external integrations are optional and gated on env vars in `.env.example` — the OpenAI key (for Noto AI), and Google / GitHub / Notion OAuth (for sign-in and connectors). Without them the core notes, graph, and search features still run.

## Scripts

Run from this `landing/` directory.

| Script | What it does |
|--------|--------------|
| `npm run dev` | Runs the Vite client and the Express API together. |
| `npm run dev:client` | Vite client only. |
| `npm run dev:server` | Express API only (port 8787), watched via `tsx`. |
| `npm run build` | Type-checks (`tsc -b`) and builds the client with Vite. |
| `npm start` | Runs the server in production mode. |
| `npm run preview` | Serves the production client build locally. |
| `npm test` | Runs the test suite once with Vitest. |
| `npm run test:watch` | Runs Vitest in watch mode. |
| `npm run typecheck:server` | Type-checks the server without emitting. |
| `npm run lint` | Lints the project with ESLint. |

> The server code is ESM TypeScript, run directly through `tsx` (imports use explicit `.ts` extensions).

## Data

The server stores its state in a local SQLite database under `server/data/`. That directory is gitignored — your notes and account data never leave your machine.

## License

MIT
