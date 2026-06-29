// Lexical (keyword + light fuzzy) fallback ranker.
//
// Used when the embedding model isn't available — unsupported browser, load
// failure, or the brief first-use download window — and as instant results
// while the model warms up. Pure (no DOM / model), so it's unit-tested.
//
// Ranking favours how many DISTINCT query terms a note matches (coverage),
// across its best passage + title + headings, then raw hit count. Title and
// heading matches get a modest boost.

import {
  chunkNote,
  plainText,
  splitSentences,
  type MetadataCache,
  type Passage,
  type VaultFile,
} from "../../noto-core";
import type { SmartResult } from "./types";

const STOP = new Set(
  ("the a an of to in and or is are was were be been being for on as at by it its this that these those " +
    "with from how do does did what why which who when where into about over under than then so such")
    .split(" "),
);

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length >= 2 && !STOP.has(t));
}

interface Match {
  matched: Set<string>;
  raw: number;
}

/** Which query terms appear in `text`, with a raw weighted hit count. */
function termMatches(terms: string[], text: string): Match {
  const counts = new Map<string, number>();
  for (const tk of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    counts.set(tk, (counts.get(tk) ?? 0) + 1);
  }
  const matched = new Set<string>();
  let raw = 0;
  for (const term of terms) {
    const exact = counts.get(term) ?? 0;
    if (exact > 0) {
      matched.add(term);
      raw += exact;
      continue;
    }
    // light fuzzy: shared prefix between reasonably long tokens
    for (const [tk, c] of counts) {
      if (tk.length >= 4 && term.length >= 4 && (tk.startsWith(term) || term.startsWith(tk))) {
        matched.add(term);
        raw += 0.5 * c;
        break;
      }
    }
  }
  return { matched, raw };
}

export function lexicalSearch(
  query: string,
  files: VaultFile[],
  cache: MetadataCache,
  limit = 20,
): SmartResult[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return [];

  const scored: { file: VaultFile; passage: Passage | null; score: number; hit: boolean }[] = [];

  for (const file of files) {
    const meta = cache.filesById[file.id];
    const passages = chunkNote(file);

    let best: { passage: Passage; match: Match } | null = null;
    for (const passage of passages) {
      const match = termMatches(terms, plainText(passage.text));
      if (
        match.matched.size > 0 &&
        (!best ||
          match.matched.size > best.match.matched.size ||
          (match.matched.size === best.match.matched.size && match.raw > best.match.raw))
      ) {
        best = { passage, match };
      }
    }

    const titleM = termMatches(terms, file.title).matched;
    const headM = termMatches(terms, (meta?.headings ?? []).join(" ")).matched;
    const union = new Set([...(best?.match.matched ?? []), ...titleM, ...headM]);
    if (union.size === 0) continue;

    const score = union.size * 10 + titleM.size * 2 + headM.size + Math.min(best?.match.raw ?? 0, 6);
    scored.push({ file, passage: best?.passage ?? passages[0] ?? null, score, hit: !!best });
  }

  scored.sort((a, b) => b.score - a.score);
  const max = scored.length ? scored[0].score : 1;
  return scored.slice(0, limit).map(({ file, passage, score, hit }) => ({
    fileId: file.id,
    title: file.title,
    path: file.path,
    passageText: passage?.text ?? "",
    headingPath: passage?.headingPath ?? [],
    highlightSentence: hit && passage ? pickHighlight(terms, passage) : null,
    score: max ? score / max : 0,
    source: "lexical" as const,
  }));
}

/** The sentence in a passage matching the most query terms (plain text). */
export function pickHighlight(terms: string[], passage: Passage): string | null {
  let bestSentence: string | null = null;
  let bestCount = 0;
  for (const sentence of splitSentences(plainText(passage.text))) {
    const n = termMatches(terms, sentence).matched.size;
    if (n > bestCount) {
      bestCount = n;
      bestSentence = sentence;
    }
  }
  return bestCount > 0 ? bestSentence : null;
}
