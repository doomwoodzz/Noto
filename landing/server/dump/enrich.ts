// Per-note LLM enrichment for Dump shaping (design §7 enrichment, §8 link candidates,
// §10.3 L0 injection-safe ingestion). Output is constrained JSON metadata ONLY; the
// body is never edited here. On ANY failure (AI unconfigured, network, bad JSON) the
// note still lands with a deterministic title and empty summary/tags/links.

import { complete, MAX_TOKENS } from "../ai/openai.ts";
import { SYSTEM, buildDumpEnrichPrompt } from "../ai/prompts.ts";
import { resolveVaultAI } from "../ai/vaultAI.ts";

// Bound the body slice sent to the model (keeps cost/latency low; the full body is
// still stored + embedded). ~6k chars ≈ within gpt-4o-mini context alongside the 300
// output-token cap.
const MAX_BODY_CHARS = 6_000;

export interface EnrichInput {
  userId: string;
  vaultId: string;
  title: string;
  body: string;
  candidateTitles: string[];
}
export interface EnrichResult {
  title: string;
  summary: string;
  tags: string[];
  links: string[];
}

// Swappable completion seam — production uses the real `complete`; tests inject a fake.
let completeImpl: typeof complete = complete;
/** TEST-ONLY: override the completion function. */
export function __setEnrichComplete(fn: typeof complete): void { completeImpl = fn; }
/** TEST-ONLY: restore the real completion function. */
export function __resetEnrichComplete(): void { completeImpl = complete; }

/** Parse a JSON OBJECT out of a model reply, tolerating ```fences``` and prose. */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function fallback(input: EnrichInput): EnrichResult {
  return { title: input.title, summary: "", tags: [], links: [] };
}

/**
 * Enrich one note with title/summary/tags/links via a single bounded LLM call.
 * Deterministic, never-throwing: returns the fallback on any AI error or parse failure.
 */
export async function enrichNote(input: EnrichInput): Promise<EnrichResult> {
  const { apiKey, model } = resolveVaultAI(input.userId, input.vaultId);
  const body = input.body.length > MAX_BODY_CHARS ? input.body.slice(0, MAX_BODY_CHARS) : input.body;

  let raw: string;
  try {
    const res = await completeImpl({
      system: SYSTEM.dumpEnrich,
      user: buildDumpEnrichPrompt({ title: input.title, body, candidateTitles: input.candidateTitles }),
      maxTokens: MAX_TOKENS.dumpEnrich,
      apiKey,
      model,
    });
    raw = res.text;
  } catch {
    return fallback(input); // AINotConfiguredError, network, etc.
  }

  const obj = parseJsonObject(raw);
  if (!obj) return fallback(input);

  const rawTitle = typeof obj.title === "string" ? obj.title.trim() : "";
  const title = rawTitle || input.title;
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";

  const tags = Array.isArray(obj.tags)
    ? obj.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().replace(/^#+/, "").trim())
        .filter((t) => t.length > 0)
        .slice(0, 5)
    : [];

  const allowed = new Set(input.candidateTitles);
  const links = Array.isArray(obj.links)
    ? obj.links
        .filter((l): l is string => typeof l === "string" && allowed.has(l))
        .slice(0, 5)
    : [];

  return { title, summary, tags, links };
}
