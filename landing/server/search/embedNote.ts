import { chunkNote } from "../../src/noto-core/chunk.ts";
import { embedder } from "./embedder.ts";
import { replaceNotePassages, setMemoryEmbedding, type PassageInput } from "../db.ts";

/** Re-chunk + (best-effort) embed a note's passages and replace its note_passages rows. Never throws. */
export async function reembedNote(fileId: string, content: string): Promise<void> {
  try {
    const passages = chunkNote({ id: fileId, content });
    const inputs: PassageInput[] = passages.map((p) => ({ id: p.id, index: p.index, headingPath: p.headingPath, text: p.text, charStart: p.charStart }));
    let vectors: (Float32Array | null)[] = passages.map(() => null);
    if (passages.length > 0) {
      try { vectors = await embedder.embed(passages.map((p) => p.text)); } catch (err) { console.warn("[sp5a] passage embedding failed (note indexed lexical-only):", err); }
    }
    replaceNotePassages(fileId, inputs, vectors);
  } catch (err) { console.warn("[sp5a] reembedNote failed:", err); }
}

/** Best-effort embed of a memory's text. Never throws. */
export async function embedMemory(memoryId: string, text: string): Promise<void> {
  try { const [v] = await embedder.embed([text]); if (v) setMemoryEmbedding(memoryId, v); } catch (err) { console.warn("[sp5a] memory embedding failed (recall lexical-only):", err); }
}
