// Passage vector index for Smart Search.
//
// Builds (and incrementally maintains) one embedding per note passage, caches
// them in IndexedDB keyed by note id + content hash, and ranks passages against
// a query vector by dot product (vectors are stored L2-normalized). Re-embeds
// only notes whose content changed since the last run; prunes deleted notes.

import { chunkNote, plainText, type Passage, type VaultFile } from "../../noto-core";
import type { Embedder } from "./embedderClient";
import { dot } from "./vectorMath";

export interface PassageHit {
  fileId: string;
  passage: Passage;
  score: number;
}

export interface PassageIndex {
  /** Build/update the index to match `files`. Throws if embedding fails. */
  sync(files: VaultFile[], onProgress?: (done: number, total: number) => void): Promise<void>;
  /** Best passage per note, ranked by similarity to `queryVec`. */
  search(queryVec: Float32Array, k?: number): PassageHit[];
  size(): number;
}

interface Entry {
  passage: Passage;
  vec: Float32Array;
}

interface Record {
  key: string;
  vaultKey: string;
  fileId: string;
  hash: string;
  passage: Passage;
  vec: ArrayBuffer;
}

const EMBED_BATCH = 64;

export function createPassageIndex(vaultKey: string, embedder: Embedder): PassageIndex {
  let entries: Entry[] = [];
  const hashByFile = new Map<string, string>();
  let hydrated = false;

  async function hydrate() {
    if (hydrated) return;
    hydrated = true;
    try {
      const records = await idbGetByVault(vaultKey);
      entries = records.map((r) => ({ passage: r.passage, vec: new Float32Array(r.vec) }));
      for (const r of records) hashByFile.set(r.fileId, r.hash);
    } catch {
      /* IndexedDB unavailable (e.g. private mode) — run in-memory only */
    }
  }

  async function sync(files: VaultFile[], onProgress?: (done: number, total: number) => void) {
    await hydrate();

    const present = new Set(files.map((f) => f.id));
    const changed = files.filter((f) => hashByFile.get(f.id) !== hashOf(f.content));
    const removed = [...hashByFile.keys()].filter((id) => !present.has(id));

    // Drop stale/removed entries from memory.
    const dirty = new Set([...changed.map((f) => f.id), ...removed]);
    if (dirty.size) entries = entries.filter((e) => !dirty.has(e.passage.fileId));
    for (const id of removed) hashByFile.delete(id);

    // Re-embed changed notes.
    const work = changed.flatMap((file) =>
      chunkNote(file).map((passage) => ({ file, passage })),
    );
    const total = work.length;
    let done = 0;
    const fresh: Record[] = [];

    for (let i = 0; i < work.length; i += EMBED_BATCH) {
      const batch = work.slice(i, i + EMBED_BATCH);
      const vectors = await embedder.embed(batch.map(({ file, passage }) => embedText(file, passage)));
      batch.forEach(({ file, passage }, j) => {
        const vec = vectors[j];
        if (!vec) return;
        entries.push({ passage, vec });
        fresh.push({
          key: `${vaultKey}#${passage.id}`,
          vaultKey,
          fileId: file.id,
          hash: hashOf(file.content),
          passage,
          vec: vec.slice().buffer, // own buffer for storage
        });
      });
      done += batch.length;
      onProgress?.(done, total);
    }
    for (const file of changed) hashByFile.set(file.id, hashOf(file.content));

    // Persist (best-effort).
    try {
      if (removed.length || changed.length) {
        await idbReplaceFiles(
          vaultKey,
          [...changed.map((f) => f.id), ...removed],
          fresh,
        );
      }
    } catch {
      /* ignore persistence failures */
    }
  }

  function search(queryVec: Float32Array, k = 20): PassageHit[] {
    const bestByFile = new Map<string, PassageHit>();
    for (const { passage, vec } of entries) {
      const score = dot(queryVec, vec);
      const cur = bestByFile.get(passage.fileId);
      if (!cur || score > cur.score) {
        bestByFile.set(passage.fileId, { fileId: passage.fileId, passage, score });
      }
    }
    return [...bestByFile.values()].sort((a, b) => b.score - a.score).slice(0, k);
  }

  return { sync, search, size: () => entries.length };
}

/** Text actually fed to the model: note title + heading trail + passage prose. */
export function embedText(file: { title: string }, passage: Passage): string {
  return [file.title, passage.headingPath.join(" › "), plainText(passage.text)]
    .filter((s) => s && s.trim().length > 0)
    .join("\n");
}

/** Stable 32-bit FNV-1a content hash (hex) — change detection only. */
export function hashOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/* ------------------------------- IndexedDB ------------------------------ */

const DB_NAME = "noto-smart";
const DB_VERSION = 1;
const STORE = "passages";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("vaultKey", "vaultKey", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

function idbGetByVault(vaultKey: string): Promise<Record[]> {
  return openDB().then(
    (db) =>
      new Promise<Record[]>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const index = tx.objectStore(STORE).index("vaultKey");
        const req = index.getAll(IDBKeyRange.only(vaultKey));
        req.onsuccess = () => resolve((req.result as Record[]) ?? []);
        req.onerror = () => reject(req.error ?? new Error("indexedDB read failed"));
        tx.oncomplete = () => db.close();
      }),
  );
}

/** Delete all passages of the given files, then insert the fresh records. */
function idbReplaceFiles(vaultKey: string, fileIds: string[], fresh: Record[]): Promise<void> {
  const drop = new Set(fileIds);
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const cursorReq = store.index("vaultKey").openCursor(IDBKeyRange.only(vaultKey));
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            const rec = cursor.value as Record;
            if (drop.has(rec.fileId)) cursor.delete();
            cursor.continue();
          } else {
            for (const rec of fresh) store.put(rec);
          }
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error("indexedDB write failed"));
      }),
  );
}
