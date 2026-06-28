/**
 * AI API — authenticated, OpenAI-backed study features.
 *
 * Security & cost model:
 *  - Every route requires a valid session (requireUserId → 401 otherwise), so
 *    anonymous traffic can never spend the API budget. The public marketing
 *    demo uses a client-side mock instead of these routes.
 *  - A dedicated, tight rate limiter (aiLimiter) caps per-IP AI calls — these
 *    are far heavier than note writes.
 *  - When no OPENAI_API_KEY is configured, every route returns 503 (never a
 *    crash), so the app degrades cleanly.
 *  - Bodies are zod-validated with hard size caps; audio is capped at 25 MB
 *    (OpenAI's transcription limit) by express.raw before it reaches us.
 *  - All output token counts are bounded in openai.ts. System prompts keep the
 *    model on-task, bounding prompt-injection / off-task abuse.
 */
import express, { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { getCurrentUser } from "../auth/session.ts";
import { env } from "../env.ts";
import {
  complete,
  transcribe,
  MAX_TOKENS,
  AINotConfiguredError,
} from "./openai.ts";
import {
  SYSTEM,
  buildChatPrompt,
  buildSummarizePrompt,
  buildFlashcardsPrompt,
  buildFindLinksPrompt,
  buildLecturePrompt,
} from "./prompts.ts";

export const aiRouter = Router();

/* ------------------------------ validation ----------------------------- */

const noteContent = z.string().max(24_000); // ~6k tokens; bounds cost.
const noteTitle = z.string().trim().max(200);
const outline = z.string().max(12_000);

const chatSchema = z.object({
  noteTitle: noteTitle.optional(),
  noteContent: noteContent.optional(),
  outline: outline.optional(),
  question: z.string().trim().min(1).max(2_000),
});

const noteSchema = z.object({
  noteTitle: noteTitle.default("Untitled"),
  noteContent: noteContent.refine((c) => c.trim().length > 0, "Note is empty"),
});

const findLinksSchema = z.object({
  noteTitle: noteTitle.default("Untitled"),
  noteContent: noteContent,
  titles: z.array(z.string().trim().min(1).max(200)).max(1_000),
});

const lectureSchema = z.object({
  transcript: z.string().trim().min(1).max(60_000),
  titles: z.array(z.string().trim().min(1).max(200)).max(1_000).default([]),
});

const jsonBody = express.json({ limit: "256kb" });
// OpenAI transcription rejects audio > 25 MB; reject oversized uploads here.
const audioBody = express.raw({ type: () => true, limit: "25mb" });

// AI calls are expensive; keep this much tighter than the notes write limiter.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many AI requests. Please slow down." },
});

/* ------------------------------- helpers ------------------------------- */

function requireUserId(req: Request, res: Response): string | null {
  const user = getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return user.id;
}

// 503 when AI is unconfigured — checked before doing any work.
function requireAI(_req: Request, res: Response, next: NextFunction): void {
  if (!env.openaiConfigured) {
    res.status(503).json({ error: "AI is not configured on this server." });
    return;
  }
  next();
}

/** Wrap an async handler so OpenAI/runtime errors become clean JSON, not 500 HTML. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err: unknown) => {
      if (err instanceof AINotConfiguredError) {
        res.status(503).json({ error: "AI is not configured on this server." });
        return;
      }
      console.error("AI route error:", err);
      if (!res.headersSent) res.status(502).json({ error: "AI is unavailable right now." });
    });
  };
}

/** Parse a JSON array out of a model reply, tolerating ```fences``` and prose. */
function parseJsonArray(raw: string): unknown[] | null {
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

aiRouter.use(requireAI);

/* -------------------------------- routes ------------------------------- */

// Free-form chat grounded in the current note + vault outline.
aiRouter.post(
  "/chat",
  aiLimiter,
  jsonBody,
  handle(async (req, res) => {
    if (!requireUserId(req, res)) return;
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const reply = await complete({
      system: SYSTEM.chat,
      user: buildChatPrompt(parsed.data),
      maxTokens: MAX_TOKENS.chat,
    });
    res.json({ reply });
  }),
);

// Summarize the current note.
aiRouter.post(
  "/summarize",
  aiLimiter,
  jsonBody,
  handle(async (req, res) => {
    if (!requireUserId(req, res)) return;
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const reply = await complete({
      system: SYSTEM.summarize,
      user: buildSummarizePrompt(parsed.data.noteTitle, parsed.data.noteContent),
      maxTokens: MAX_TOKENS.summarize,
    });
    res.json({ reply });
  }),
);

// Generate flashcards (shown in chat; not written to the note in v1).
aiRouter.post(
  "/flashcards",
  aiLimiter,
  jsonBody,
  handle(async (req, res) => {
    if (!requireUserId(req, res)) return;
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const raw = await complete({
      system: SYSTEM.flashcards,
      user: buildFlashcardsPrompt(parsed.data.noteTitle, parsed.data.noteContent),
      maxTokens: MAX_TOKENS.flashcards,
    });
    const arr = parseJsonArray(raw) ?? [];
    const cards = arr
      .filter((x): x is { q: string; a: string } =>
        typeof x === "object" && x !== null && typeof (x as { q?: unknown }).q === "string",
      )
      .map((x) => ({ q: String(x.q), a: String((x as { a?: unknown }).a ?? "") }))
      .slice(0, 8);
    res.json({ cards });
  }),
);

// Suggest related notes from the supplied title list (LLM over titles).
aiRouter.post(
  "/find-links",
  aiLimiter,
  jsonBody,
  handle(async (req, res) => {
    if (!requireUserId(req, res)) return;
    const parsed = findLinksSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const { noteTitle: t, noteContent: c, titles } = parsed.data;
    if (titles.length === 0) {
      res.json({ related: [] });
      return;
    }
    const raw = await complete({
      system: SYSTEM.findLinks,
      user: buildFindLinksPrompt({ noteTitle: t, noteContent: c, titles }),
      maxTokens: MAX_TOKENS.findLinks,
    });
    const allowed = new Set(titles);
    const related = (parseJsonArray(raw) ?? [])
      .filter((x): x is string => typeof x === "string" && allowed.has(x))
      .slice(0, 6);
    res.json({ related });
  }),
);

// Transcribe a recorded lecture (raw audio body, ≤ 25 MB).
aiRouter.post(
  "/transcribe",
  aiLimiter,
  audioBody,
  handle(async (req, res) => {
    if (!requireUserId(req, res)) return;
    const audio = req.body as Buffer;
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      res.status(400).json({ error: "No audio received." });
      return;
    }
    const mime = req.headers["content-type"] ?? "audio/webm";
    const transcript = await transcribe(audio, mime);
    res.json({ transcript });
  }),
);

// Structure a transcript into the "AI Lecture Notes" markdown section.
aiRouter.post(
  "/lecture-notes",
  aiLimiter,
  jsonBody,
  handle(async (req, res) => {
    if (!requireUserId(req, res)) return;
    const parsed = lectureSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const markdown = await complete({
      system: SYSTEM.lecture,
      user: buildLecturePrompt(parsed.data.transcript, parsed.data.titles),
      maxTokens: MAX_TOKENS.lecture,
    });
    res.json({ markdown });
  }),
);
