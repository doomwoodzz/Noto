// Orchestrates Smart Search: lazily loads the embedding model on first use,
// builds/maintains the passage index, and runs debounced queries — with the
// lexical ranker serving instant results while the model warms up and as a
// fallback if it can't load. Highlight sentences for the top hits are chosen by
// sentence-level cosine so the highlighted line is the most relevant one.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  plainText,
  splitSentences,
  type MetadataCache,
  type VaultFile,
} from "../../noto-core";
import { createEmbedder, type Embedder } from "./embedderClient";
import { lexicalSearch } from "./lexical";
import type { SearchSource, SmartResult } from "./types";
import { createPassageIndex, type PassageHit, type PassageIndex } from "./vectorIndex";
import { dot } from "./vectorMath";

export type SmartStatus = "idle" | "preparing" | "ready" | "error";

export interface SmartSearchState {
  status: SmartStatus;
  /** Model-load progress 0..1 (only meaningful while `preparing`). */
  progress: number;
  query: string;
  setQuery: (q: string) => void;
  results: SmartResult[];
  searching: boolean;
  source: SearchSource | null;
  /** Clear the query + results (used when the panel closes). */
  reset: () => void;
}

const DEBOUNCE_MS = 200;
const RESYNC_MS = 500;
const RESULT_LIMIT = 20;
const HIGHLIGHT_TOP = 8; // embed sentences only for the top N hits
// Embeddings score every passage, so hide the irrelevant tail below this cosine.
// MiniLM on-topic hits run ~0.3-0.6; unrelated notes sit well under 0.2.
const EMBED_SCORE_FLOOR = 0.25;

export function useSmartSearch(opts: {
  files: VaultFile[];
  cache: MetadataCache;
  vaultKey: string;
  active: boolean;
}): SmartSearchState {
  const { files, cache, vaultKey, active } = opts;

  const [status, setStatus] = useState<SmartStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SmartResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [source, setSource] = useState<SearchSource | null>(null);

  const embedderRef = useRef<Embedder | null>(null);
  const indexRef = useRef<PassageIndex | null>(null);
  const startedRef = useRef(false);

  // Always-fresh views for use inside async callbacks. Written in an effect
  // (never during render) to satisfy the react-hooks lint.
  const filesById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);
  const filesRef = useRef(files);
  const cacheRef = useRef(cache);
  const filesByIdRef = useRef(filesById);
  useEffect(() => {
    filesRef.current = files;
    cacheRef.current = cache;
    filesByIdRef.current = filesById;
  });

  /* ---- lazy prepare: load model + build index on first activation ---- */
  useEffect(() => {
    if (!active || startedRef.current) return;
    startedRef.current = true;
    setStatus("preparing");

    const embedder = createEmbedder();
    embedderRef.current = embedder;
    let cancelled = false;
    embedder.onProgress((p) => {
      if (!cancelled) setProgress(p.total ? Math.min(1, p.loaded / p.total) : 0);
    });

    void (async () => {
      try {
        await embedder.ready;
        if (cancelled) return;
        const index = createPassageIndex(vaultKey, embedder);
        indexRef.current = index;
        await index.sync(filesRef.current);
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, vaultKey]);

  // Dispose the worker when the workspace unmounts.
  useEffect(() => () => embedderRef.current?.dispose(), []);

  /* ------------------------------ search ------------------------------ */
  const runSearch = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q) {
        setResults([]);
        setSource(null);
        setSearching(false);
        return;
      }
      const ready = status === "ready" && indexRef.current && embedderRef.current;
      if (!ready) {
        // instant results while the model warms up (or if it failed to load)
        setResults(lexicalSearch(q, filesRef.current, cacheRef.current, RESULT_LIMIT));
        setSource("lexical");
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const [queryVec] = await embedderRef.current!.embed([q]);
        const hits = indexRef
          .current!.search(queryVec, RESULT_LIMIT)
          .filter((h) => h.score >= EMBED_SCORE_FLOOR);
        const enriched = await enrichHighlights(queryVec, hits, embedderRef.current!, filesByIdRef.current);
        setResults(enriched);
        setSource("embedding");
      } catch {
        setResults(lexicalSearch(q, filesRef.current, cacheRef.current, RESULT_LIMIT));
        setSource("lexical");
      } finally {
        setSearching(false);
      }
    },
    [status],
  );

  // Debounced query → search. Re-runs when `status` flips to ready (runSearch
  // identity changes), upgrading shown results from lexical to embedding.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => void runSearch(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, active, runSearch]);

  // Keep the index current as notes are edited/added/deleted (incremental).
  useEffect(() => {
    if (status !== "ready" || !indexRef.current) return;
    const t = setTimeout(() => {
      void indexRef.current?.sync(files).then(() => {
        if (query.trim()) void runSearch(query);
      });
    }, RESYNC_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query/runSearch read fresh; trigger on files only
  }, [files, status]);

  const reset = useCallback(() => {
    setQuery("");
    setResults([]);
    setSource(null);
    setSearching(false);
  }, []);

  return { status, progress, query, setQuery, results, searching, source, reset };
}

/* ------------------------------ helpers ------------------------------ */

/** Pick each top hit's highlight sentence by sentence-level cosine to the query. */
async function enrichHighlights(
  queryVec: Float32Array,
  hits: PassageHit[],
  embedder: Embedder,
  filesById: Map<string, VaultFile>,
): Promise<SmartResult[]> {
  const top = hits.slice(0, HIGHLIGHT_TOP);
  const rest = hits.slice(HIGHLIGHT_TOP);

  const sentencesPerHit = top.map((h) => splitSentences(plainText(h.passage.text)));
  const flat = sentencesPerHit.flat();
  let sentVecs: Float32Array[] = [];
  try {
    if (flat.length) sentVecs = await embedder.embed(flat);
  } catch {
    sentVecs = [];
  }

  const out: SmartResult[] = [];
  let cursor = 0;
  top.forEach((hit, i) => {
    const sentences = sentencesPerHit[i];
    let best: string | null = sentences[0] ?? null;
    let bestScore = -Infinity;
    for (let s = 0; s < sentences.length; s += 1) {
      const v = sentVecs[cursor + s];
      if (!v) continue;
      const score = dot(queryVec, v);
      if (score > bestScore) {
        bestScore = score;
        best = sentences[s];
      }
    }
    cursor += sentences.length;
    out.push(toResult(hit, best, filesById));
  });
  for (const hit of rest) {
    out.push(toResult(hit, splitSentences(plainText(hit.passage.text))[0] ?? null, filesById));
  }
  return out;
}

function toResult(
  hit: PassageHit,
  highlight: string | null,
  filesById: Map<string, VaultFile>,
): SmartResult {
  const file = filesById.get(hit.fileId);
  return {
    fileId: hit.fileId,
    title: file?.title ?? "Untitled",
    path: file?.path ?? "",
    passageText: hit.passage.text,
    headingPath: hit.passage.headingPath,
    highlightSentence: highlight,
    score: hit.score,
    source: "embedding",
  };
}
