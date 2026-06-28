/**
 * System prompts and prompt builders for the Noto AI features.
 *
 * Each builder assembles the user-message payload from note context. Inputs are
 * trimmed/capped at the route layer; these functions just shape the text. The
 * system prompts keep the model on-task (a notes assistant) and refuse
 * unrelated requests, which also bounds abuse of the endpoint.
 */

/** Shared persona + guardrail used by every text feature. */
const PERSONA =
  "You are Noto AI, a concise study assistant embedded in a Markdown notes app. " +
  "You help with the user's notes: explaining, summarizing, connecting, and quizzing. " +
  "Stay on-task; if asked something unrelated to studying or the user's notes, briefly decline. " +
  "Prefer plain language. Do not invent facts that aren't supported by the provided note(s).";

export const SYSTEM = {
  chat: PERSONA,
  summarize:
    PERSONA + " Summarize the given note in 3-5 short sentences. No preamble, just the summary.",
  flashcards:
    PERSONA +
    " Generate study flashcards from the given note. Return ONLY a JSON array of " +
    '{"q":"question","a":"answer"} objects (max 8). No prose, no code fences.',
  findLinks:
    PERSONA +
    " From a list of note titles, pick those most conceptually related to the current note. " +
    'Return ONLY a JSON array of the chosen titles (verbatim, max 6), e.g. ["Title A","Title B"]. ' +
    "Choose nothing that isn't in the provided list. No prose, no code fences.",
  lecture:
    PERSONA +
    " You are given a raw lecture transcript and a list of the user's existing note titles. " +
    "Produce a structured study section in GitHub-flavored Markdown with EXACTLY these headings:\n" +
    "## AI Lecture Notes\n### Main explanation\n### Key definitions\n### Important relationships\n" +
    "### Possible test questions\n" +
    "Under 'Important relationships', wiki-link to existing notes as [[Title]] ONLY when the title " +
    "appears in the provided list and is genuinely relevant. Be faithful to the transcript; do not invent.",
} as const;

/** Build the chat user-message: current note + a lightweight vault outline. */
export function buildChatPrompt(opts: {
  noteTitle?: string;
  noteContent?: string;
  outline?: string;
  question: string;
}): string {
  const parts: string[] = [];
  if (opts.noteContent?.trim()) {
    parts.push(`# Current note: ${opts.noteTitle ?? "Untitled"}\n${opts.noteContent.trim()}`);
  } else {
    parts.push("# Current note\n(none open)");
  }
  if (opts.outline?.trim()) {
    parts.push(`# Vault outline (titles & headings)\n${opts.outline.trim()}`);
  }
  parts.push(`# Question\n${opts.question.trim()}`);
  return parts.join("\n\n");
}

export function buildSummarizePrompt(noteTitle: string, noteContent: string): string {
  return `Note: ${noteTitle}\n\n${noteContent.trim()}`;
}

export function buildFlashcardsPrompt(noteTitle: string, noteContent: string): string {
  return `Note: ${noteTitle}\n\n${noteContent.trim()}`;
}

export function buildFindLinksPrompt(opts: {
  noteTitle: string;
  noteContent: string;
  titles: string[];
}): string {
  return [
    `Current note: ${opts.noteTitle}`,
    opts.noteContent.trim(),
    "",
    "Candidate titles:",
    opts.titles.map((t) => `- ${t}`).join("\n"),
  ].join("\n");
}

export function buildLecturePrompt(transcript: string, titles: string[]): string {
  return [
    "Existing note titles (for wiki-links):",
    titles.length ? titles.map((t) => `- ${t}`).join("\n") : "(none)",
    "",
    "Lecture transcript:",
    transcript.trim(),
  ].join("\n");
}
