#!/usr/bin/env node
/**
 * Builds the vendored app bundle consumed by the `noto-app` PyPI package.
 *
 * Produces packaging/pypi/noto_app/_vendor/{dist,server,src,public,package.json,package-lock.json}:
 *  - dist/    prebuilt static frontend (app.html + get-started.html only — no
 *             marketing pages), with app.html also copied to index.html so the
 *             packaged server's "/" serves the workspace directly.
 *  - server/  the server's TypeScript source, run via tsx at runtime (same as
 *             `npm start` today) — no separate server build step. The gitignored
 *             server/data/ (the maintainer's own local SQLite database) is
 *             deliberately excluded so it's never vendored into the package.
 *  - src/noto-core/  shared parser/graph/provenance modules the server imports
 *             via relative "../src/noto-core/..." paths (db.ts, graph/*, dump/*,
 *             ai/untrusted.ts, search/embedNote.ts). Copied to the same relative
 *             layout (_vendor/src/noto-core next to _vendor/server) so those
 *             imports resolve unchanged at runtime.
 *  - public/models, public/ort/  the vendored MiniLM embedding model + onnxruntime
 *             wasm binaries. server/search/embedder.ts resolves these *file-relative*
 *             to itself (`../../public/models` from server/search/), independent of
 *             the dist/ webroot — so they must be copied to _vendor/public, not
 *             just picked up incidentally via the frontend build's publicDir copy.
 *  - package.json / package-lock.json   production-only dependencies, with a
 *             fresh lockfile generated to match (via --package-lock-only) since
 *             the pruned package.json no longer matches the original lockfile.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LANDING_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const VENDOR_DIR = join(LANDING_DIR, "..", "packaging", "pypi", "noto_app", "_vendor");

const PROD_DEPENDENCIES = [
  "@huggingface/transformers",
  "@modelcontextprotocol/sdk",
  "cookie",
  "dotenv",
  "express",
  "express-rate-limit",
  "graphology",
  "graphology-communities-louvain",
  "helmet",
  "openai",
  "tsx",
  "zod",
];

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

function main() {
  rmSync(VENDOR_DIR, { recursive: true, force: true });
  mkdirSync(VENDOR_DIR, { recursive: true });

  // 1. Frontend: build only the app + get-started entry points.
  const distAppDir = join(LANDING_DIR, "dist-app");
  rmSync(distAppDir, { recursive: true, force: true });
  run("npx", ["vite", "build", "--config", "vite.config.app.ts"], LANDING_DIR);
  cpSync(distAppDir, join(VENDOR_DIR, "dist"), { recursive: true });
  copyFileSync(join(VENDOR_DIR, "dist", "app.html"), join(VENDOR_DIR, "dist", "index.html"));
  rmSync(distAppDir, { recursive: true, force: true });

  // 2. Server source, run via tsx at runtime — same as `npm start` today.
  // Excludes tests and the gitignored local database directory.
  cpSync(join(LANDING_DIR, "server"), join(VENDOR_DIR, "server"), {
    recursive: true,
    filter: (src) => !src.endsWith(".test.ts") && !src.includes(join("server", "data")),
  });

  // 2b. src/noto-core: the server imports this shared module tree via relative
  // "../src/noto-core/..." paths (e.g. server/db.ts, server/graph/*.ts,
  // server/dump/{assemble,commit}.ts, server/ai/untrusted.ts,
  // server/search/embedNote.ts). Copy the whole directory (minus tests) rather
  // than chasing individual files, preserving the "src/noto-core" relative
  // layout next to "server" so those "../src/noto-core/..." imports resolve
  // unchanged. noto-core's own internal imports stay within itself (./types,
  // ./parser, etc.) except provenance.ts, which imports back into
  // "../../server/dump/types.ts" — already covered since the whole server/
  // tree is vendored alongside it.
  cpSync(join(LANDING_DIR, "src", "noto-core"), join(VENDOR_DIR, "src", "noto-core"), {
    recursive: true,
    filter: (src) => !src.endsWith(".test.ts"),
  });

  // 2c. Vendored MiniLM embedding model + onnxruntime-web wasm binaries.
  // server/search/embedder.ts sets env.localModelPath = resolve(<embedder.ts's
  // own dir>, "../../public/models") — i.e. it looks for "public/models" two
  // directories above wherever server/search/ lands, NOT inside dist/. That
  // resolves to _vendor/public/models here, which is a *different* directory
  // than _vendor/dist (the vite build's webroot) even though vite separately
  // copies public/ into dist-app/ for the browser-side Smart Search worker.
  // Both copies are required: dist/models for the client, public/models for
  // the server's embedder.ts. These directories are populated by
  // `npm run fetch-embedding-model` (gitignored; not committed) — fail loudly
  // if they're missing rather than silently shipping a package with no
  // semantic search.
  for (const assetDir of ["models", "ort"]) {
    const srcDir = join(LANDING_DIR, "public", assetDir);
    if (!existsSync(srcDir)) {
      throw new Error(
        `Expected landing/public/${assetDir} to exist (run "npm run fetch-embedding-model" in landing/ first).`,
      );
    }
    cpSync(srcDir, join(VENDOR_DIR, "public", assetDir), { recursive: true });
  }

  // 3. Production-only package.json, versions pinned from the real one.
  const fullPkg = JSON.parse(readFileSync(join(LANDING_DIR, "package.json"), "utf8"));
  const prodDeps = {};
  for (const dep of PROD_DEPENDENCIES) {
    const version = fullPkg.dependencies?.[dep] ?? fullPkg.devDependencies?.[dep];
    if (!version) {
      throw new Error(`Expected dependency "${dep}" not found in landing/package.json`);
    }
    prodDeps[dep] = version;
  }
  const vendorPkg = {
    name: "noto-server",
    private: true,
    version: fullPkg.version,
    type: "module",
    dependencies: prodDeps,
  };
  writeFileSync(join(VENDOR_DIR, "package.json"), JSON.stringify(vendorPkg, null, 2) + "\n");

  // 4. Fresh lockfile matching the pruned package.json (npm ci requires one in sync).
  run("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"], VENDOR_DIR);

  console.log(`Vendored bundle written to ${VENDOR_DIR}`);
}

main();
