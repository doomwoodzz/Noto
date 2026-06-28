// Web Worker: loads the self-hosted MiniLM model and embeds text batches off
// the main thread so indexing never janks the UI. Configured for fully-offline,
// single-threaded WASM — no remote model fetch, no SharedArrayBuffer (COEP is
// off), assets served same-origin from /models and /ort.

import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
  type ProgressInfo,
} from "@huggingface/transformers";
import type { FromWorker, ToWorker } from "./types";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
const wasm = env.backends?.onnx?.wasm;
if (wasm) {
  // ORT dynamically imports its WASM glue (.mjs). In production it loads from the
  // self-hosted, same-origin /ort/ (served statically — keeps CSP 'self' + offline).
  // In Vite dev a public-dir .mjs hits Vite's `?import` transform (500), so we load
  // ORT's assets from the node_modules dist Vite serves as proper modules instead.
  wasm.wasmPaths = import.meta.env.DEV ? "/node_modules/onnxruntime-web/dist/" : "/ort/";
  wasm.numThreads = 1;
}

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

// Worker globals, typed without the `webworker` lib (which clashes with the DOM
// lib the app's tsconfig already pulls in).
const ctx = globalThis as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (e: MessageEvent<ToWorker>) => void): void;
};

let extractorP: Promise<FeatureExtractionPipeline> | null = null;

function loadExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorP) {
    extractorP = pipeline("feature-extraction", MODEL_ID, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (info: ProgressInfo) => {
        const loaded = "loaded" in info ? (info.loaded ?? 0) : 0;
        const total = "total" in info ? (info.total ?? 0) : 0;
        ctx.postMessage({ type: "progress", status: info.status, loaded, total });
      },
    }).then((extractor) => {
      ctx.postMessage({ type: "ready" });
      return extractor;
    });
  }
  return extractorP;
}

ctx.addEventListener("message", (e) => {
  const msg = e.data;
  void (async () => {
    try {
      if (msg.type === "init") {
        await loadExtractor();
        return;
      }
      const extractor = await loadExtractor();
      const output = await extractor(msg.texts, { pooling: "mean", normalize: true });
      const dim = output.dims[output.dims.length - 1] ?? 0;
      const flat = Float32Array.from(output.data as Float32Array);
      ctx.postMessage({ type: "result", id: msg.id, dim, data: flat.buffer }, [flat.buffer]);
    } catch (err) {
      ctx.postMessage({
        type: "error",
        id: msg.type === "embed" ? msg.id : null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  })();
});
