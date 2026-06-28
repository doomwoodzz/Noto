// Real OpenAI-backed AIClient for the authenticated app. Thin adapter over the
// /api/ai/* endpoints (see server/ai/routes.ts) into the workspace's AIClient
// surface. All calls are same-origin, credentialed, and CSRF-protected by the
// shared api request helpers.
import { api } from "./api";
import type { AIClient } from "../workspace/aiClient";

export const realAIClient: AIClient = {
  simulated: false,
  chat: (input) => api.ai.chat(input).then((r) => r.reply),
  summarize: (input) => api.ai.summarize(input).then((r) => r.reply),
  flashcards: (input) => api.ai.flashcards(input).then((r) => r.cards),
  findLinks: (input) => api.ai.findLinks(input).then((r) => r.related),
  transcribe: (audio) => api.ai.transcribe(audio).then((r) => r.transcript),
  lectureNotes: (input) => api.ai.lectureNotes(input).then((r) => r.markdown),
};
