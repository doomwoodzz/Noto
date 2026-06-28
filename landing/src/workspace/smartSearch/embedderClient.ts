// Main-thread handle to the embedder worker. Spawns the worker, exposes a
// promise-based `embed`, and reports model-load progress. `ready` rejects if
// the model fails to load (unsupported browser / missing assets) so callers can
// fall back to lexical search.

import type { FromWorker, ToWorker } from "./types";

export interface ProgressInfo {
  status: string;
  loaded: number;
  total: number;
}

export interface Embedder {
  /** Resolves when the model is loaded; rejects if it can't be. */
  ready: Promise<void>;
  /** Embed texts → one L2-normalized vector each (model normalizes output). */
  embed(texts: string[]): Promise<Float32Array[]>;
  onProgress(cb: (p: ProgressInfo) => void): void;
  dispose(): void;
}

export function createEmbedder(): Embedder {
  const worker = new Worker(new URL("./embedder.worker.ts", import.meta.url), { type: "module" });

  let seq = 0;
  const pending = new Map<number, { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }>();
  let progressCb: ((p: ProgressInfo) => void) | null = null;

  let resolveReady!: () => void;
  let rejectReady!: (e: Error) => void;
  let readySettled = false;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  const settleReady = (err?: Error) => {
    if (readySettled) return;
    readySettled = true;
    if (err) rejectReady(err);
    else resolveReady();
  };

  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data;
    switch (msg.type) {
      case "ready":
        settleReady();
        break;
      case "progress":
        progressCb?.({ status: msg.status, loaded: msg.loaded, total: msg.total });
        break;
      case "result": {
        const p = pending.get(msg.id);
        if (!p) break;
        pending.delete(msg.id);
        const flat = new Float32Array(msg.data);
        const dim = msg.dim;
        const vectors: Float32Array[] = [];
        if (dim > 0) {
          for (let i = 0; i < flat.length; i += dim) vectors.push(flat.subarray(i, i + dim));
        }
        p.resolve(vectors);
        break;
      }
      case "error": {
        const err = new Error(msg.message);
        console.warn("[smart-search] embedder error:", msg.message);
        if (msg.id != null && pending.has(msg.id)) {
          pending.get(msg.id)!.reject(err);
          pending.delete(msg.id);
        } else {
          settleReady(err);
        }
        break;
      }
    }
  };

  worker.onerror = (e) => {
    console.warn("[smart-search] embedder worker error:", e.message || e);
    const err = new Error(e.message || "Embedder worker failed to start");
    settleReady(err);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };

  const send = (msg: ToWorker) => worker.postMessage(msg);
  send({ type: "init" }); // kick off the model load immediately

  return {
    ready,
    embed(texts) {
      if (texts.length === 0) return Promise.resolve([]);
      const id = (seq += 1);
      return new Promise<Float32Array[]>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ type: "embed", id, texts });
      });
    },
    onProgress(cb) {
      progressCb = cb;
    },
    dispose() {
      worker.terminate();
      pending.clear();
    },
  };
}
