// Shared types for Smart Search (semantic search over note passages).

import type { Passage } from "../../noto-core";

export type { Passage };

export type SearchSource = "embedding" | "lexical";

/** One ranked search hit (best passage of a note). */
export interface SmartResult {
  fileId: string;
  title: string;
  path: string;
  /** Raw Markdown of the best-matching passage ("" if the note has no body). */
  passageText: string;
  /** Heading trail the passage lives under. */
  headingPath: string[];
  /** Plain-text sentence within the passage to highlight, if any. */
  highlightSentence: string | null;
  /** Relevance in 0..1 (cosine for embeddings, normalized for lexical). */
  score: number;
  source: SearchSource;
}

/* ----------------- embedder worker <-> main-thread protocol ----------------- */

export type ToWorker = { type: "init" } | { type: "embed"; id: number; texts: string[] };

export type FromWorker =
  | { type: "ready" }
  | { type: "progress"; status: string; loaded: number; total: number }
  // `data` is a flat Float32Array buffer of texts.length * dim, transferred.
  | { type: "result"; id: number; dim: number; data: ArrayBuffer }
  | { type: "error"; id: number | null; message: string };
