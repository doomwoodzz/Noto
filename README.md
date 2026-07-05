# Noto

A local-first Markdown notes workspace with an AI lecture-listening assistant.

> **When you listen, Noto remembers.**

## Two apps in one repo

Noto ships as two complementary halves that share the same idea and vault model:

- **macOS app** — a native SwiftUI desktop workspace at the repo root, built with SwiftPM (`NotoCore`, `Noto`, `NotoCoreChecks`).
- **Web app + server** — a Vite + React + TypeScript front end backed by an Express/SQLite server, under [`landing/`](landing/).

Both are local-first: your notes live on your own device.

## Quick start

### macOS app

Requires a recent Swift toolchain (Swift 6).

```bash
swift build          # build debug
swift run Noto       # run the app
swift test           # run the test suite
```

### Web app

Requires [Node.js](https://nodejs.org). Connectors and AI features are optional and gated on environment variables — see [`landing/.env.example`](landing/.env.example).

```bash
cd landing
npm install
npm run dev          # starts the Vite client + Express API together
```

## Features

- **Markdown notes** with `[[wiki-links]]` and automatically generated backlinks.
- **Knowledge Web** graph view of how your notes connect.
- **Smart Search** — semantic search running locally with MiniLM embeddings.
- **AI lecture assistant** — an OpenAI-backed layer for chat, flashcards, find-links, and lecture support (web app).
- **Dump** — a bulk-import pipeline (paste, upload, GitHub, Notion) that turns source material into atomic notes.
- **Connectors** — optional GitHub App and Notion OAuth integrations.
- **MCP bridge** — expose your workspace to MCP-compatible tools.
- **Accounts** (web app) — password and Google authentication with sessions.

## Local-first

Your data stays on your device. The web server persists everything to a local SQLite database under `landing/server/data/` (gitignored), and the macOS app works against local vault data. AI and connector features only reach out when you configure their keys in `landing/.env.example`.

## License

MIT
