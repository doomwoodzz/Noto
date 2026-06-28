// Vendors the Smart Search embedding model + ONNX-runtime WASM into public/ so
// they are served same-origin (keeps the strict CSP `connect-src 'self'` and
// works offline). Idempotent: existing files are skipped. Non-fatal: on a
// network failure it warns and exits 0 — the app degrades to the lexical
// fallback ranker, so dev/build never break.
//
// Run via `npm run fetch-embedding-model` (also wired as predev / prebuild).

import { mkdir, writeFile, copyFile, stat, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const MODELS_DIR = join(root, "public", "models");
const ORT_DIR = join(root, "public", "ort");

const REPO = "Xenova/all-MiniLM-L6-v2";
const BASE = `https://huggingface.co/${REPO}/resolve/main`;
const MODEL_FILES = [
  { path: "config.json", required: true },
  { path: "tokenizer.json", required: true },
  { path: "tokenizer_config.json", required: true },
  { path: "special_tokens_map.json", required: false },
  { path: "onnx/model_quantized.onnx", required: true },
];

const ORT_SRC = join(root, "node_modules", "@huggingface", "transformers", "dist");

async function exists(p) {
  try {
    return (await stat(p)).size > 0;
  } catch {
    return false;
  }
}

async function fetchToFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return buf.length;
}

async function main() {
  let failures = 0;

  // 1) model files
  for (const { path, required } of MODEL_FILES) {
    const dest = join(MODELS_DIR, REPO, path);
    if (await exists(dest)) {
      console.log(`✓ ${path} (cached)`);
      continue;
    }
    try {
      const bytes = await fetchToFile(`${BASE}/${path}`, dest);
      console.log(`↓ ${path} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
    } catch (err) {
      const level = required ? "ERROR" : "skip";
      console.warn(`${level}: ${path} — ${err.message}`);
      if (required) failures += 1;
    }
  }

  // 2) ONNX-runtime WASM (copied from the installed package so versions match)
  try {
    await mkdir(ORT_DIR, { recursive: true });
    const files = (await readdir(ORT_SRC)).filter((f) => /^ort-.*\.(wasm|mjs)$/.test(f));
    for (const f of files) {
      const dest = join(ORT_DIR, f);
      if (await exists(dest)) {
        console.log(`✓ ort/${f} (cached)`);
        continue;
      }
      await copyFile(join(ORT_SRC, f), dest);
      console.log(`⊕ ort/${f}`);
    }
    if (files.length === 0) console.warn("skip: no ort wasm files found in package dist");
  } catch (err) {
    console.warn(`skip: ort wasm copy — ${err.message}`);
  }

  if (failures > 0) {
    console.warn(
      `\nSmart Search model not fully vendored (${failures} required file(s) missing). ` +
        `Search will use the lexical fallback until this script succeeds online.`,
    );
  } else {
    console.log("\nSmart Search assets ready.");
  }
  process.exit(0); // never block dev/build
}

main();
