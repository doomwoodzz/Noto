# Noto

A local-first Markdown notes workspace with an AI lecture-listening assistant.

> **When you listen, Noto remembers.**

Noto runs entirely on your own machine. There are no accounts, no sign-in, and no
hosted server to operate — your notes live in a local SQLite database and nothing
leaves your computer except the optional AI/connector calls you explicitly configure.

## Install

```bash
pip install noto-app
noto
```

This opens Noto in your browser at `http://127.0.0.1:8787`. The first run downloads a
small, checksum-verified Node.js runtime (Noto itself is a Node/TypeScript app under
the hood); later runs start instantly. No separate Node.js install is required.

## Features

- **Markdown notes** with `[[wiki-links]]` and automatically generated backlinks.
- **Knowledge Web** graph view of how your notes connect.
- **Smart Search** — semantic search running locally with MiniLM embeddings.
- **AI lecture assistant** — an OpenAI-backed layer for chat, flashcards, find-links,
  and lecture support (bring your own API key).
- **Dump** — a bulk-import pipeline (paste, upload, GitHub, Notion) that turns source
  material into atomic notes.
- **Connectors** — optional GitHub App and Notion OAuth integrations for Dump.
- **MCP bridge** — expose your workspace to MCP-compatible tools (Claude Code, Cursor,
  Codex) via `noto-mcp`.

## Developing

Requires [Node.js](https://nodejs.org) 24+.

```bash
cd landing
npm install
npm run dev          # starts the Vite client + Express API together
npm test             # runs the test suite
```

AI features and connectors are optional and gated on environment variables — see
[`landing/.env.example`](landing/.env.example).

## Local-first

Your data stays on your device: the server persists everything to a local SQLite
database (under `landing/server/data/` in development, or your OS's standard app-data
directory when installed via `pip install noto-app`). AI and connector features only
reach out when you configure their keys.

## License

MIT
