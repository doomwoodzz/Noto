/**
 * OpenAI client wrapper.
 *
 * The single place the API key is read and the SDK is instantiated. Everything
 * server-side; the key never reaches the browser (the CSP forbids the browser
 * calling OpenAI directly anyway). Model choices are centralized here so a swap
 * is a one-line change.
 *
 * Models (per the v1 plan):
 *   - TEXT_MODEL: cheap, capable chat/structuring model.
 *   - TRANSCRIBE_MODEL: cheap streaming-capable transcription model.
 */
import OpenAI, { toFile } from "openai";
import { env } from "../env.ts";

export const TEXT_MODEL = "gpt-4o-mini";
export const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

// Per-task output ceilings — bound cost and latency. Inputs are bounded by the
// route-level zod caps and the 25 MB audio guard.
export const MAX_TOKENS = {
  chat: 700,
  summarize: 500,
  flashcards: 700,
  findLinks: 300,
  lecture: 1200,
} as const;

let client: OpenAI | null = null;

/** Lazily build the SDK client. Returns null when no key is configured. */
export function getOpenAI(): OpenAI | null {
  if (!env.openaiConfigured) return null;
  if (!client) client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return client;
}

/** Build an SDK client for a specific key, or the global one (null if neither). */
export function clientFor(apiKey?: string): OpenAI | null {
  if (apiKey) return new OpenAI({ apiKey });
  return getOpenAI();
}

/**
 * One-shot chat completion returning the assistant's text and token counts.
 * `system` frames the task; `user` carries the (already-assembled) prompt with note context.
 */
export async function complete(opts: {
  system: string;
  user: string;
  maxTokens: number;
  apiKey?: string;
  model?: string;
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const openai = clientFor(opts.apiKey);
  if (!openai) throw new AINotConfiguredError();
  const res = await openai.chat.completions.create({
    model: opts.model || TEXT_MODEL,
    max_tokens: opts.maxTokens,
    temperature: 0.4,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });
  return {
    text: res.choices[0]?.message?.content?.trim() ?? "",
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
  };
}

/** Transcribe a recorded audio buffer to plain text. */
export async function transcribe(audio: Buffer, mime: string, opts?: { apiKey?: string }): Promise<string> {
  const openai = clientFor(opts?.apiKey);
  if (!openai) throw new AINotConfiguredError();
  const ext = mime.includes("mp4") || mime.includes("mpeg") ? "mp4" : "webm";
  const file = await toFile(audio, `lecture.${ext}`, { type: mime });
  const res = await openai.audio.transcriptions.create({
    model: TRANSCRIBE_MODEL,
    file,
  });
  return res.text.trim();
}

/** Thrown when an AI call is attempted without a configured key. */
export class AINotConfiguredError extends Error {
  constructor() {
    super("AI is not configured");
    this.name = "AINotConfiguredError";
  }
}
