import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Embedder {
  ready(): boolean;
  embed(texts: string[]): Promise<Float32Array[]>;
}

// Load the vendored model from public/models (same files the client Smart Search uses); never hit the network.
const here = dirname(fileURLToPath(import.meta.url)); // .../landing/server/search
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = resolve(here, "../../public/models");

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
let extractorP: Promise<FeatureExtractionPipeline> | null = null;
let loaded = false;
function load(): Promise<FeatureExtractionPipeline> {
  if (!extractorP) {
    extractorP = pipeline("feature-extraction", MODEL_ID, { dtype: "q8" }).then((e) => { loaded = true; return e; });
  }
  return extractorP;
}

export const realEmbedder: Embedder = {
  ready: () => loaded,
  async embed(texts) {
    if (texts.length === 0) return [];
    const extractor = await load();
    const out = await extractor(texts, { pooling: "mean", normalize: true });
    const dim = out.dims[out.dims.length - 1];
    const flat = out.data as Float32Array;
    const vecs: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 1) vecs.push(flat.slice(i * dim, (i + 1) * dim));
    return vecs;
  },
};

/** Kick off the model load without awaiting (call on boot). */
export function warm(): void { void load().catch(() => {}); }

// Swappable singleton — tests inject deterministic vectors via setEmbedder().
let impl: Embedder = realEmbedder;
export function setEmbedder(e: Embedder): void { impl = e; }
export const embedder: Embedder = { ready: () => impl.ready(), embed: (t) => impl.embed(t) };
