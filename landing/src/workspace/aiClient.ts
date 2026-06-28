// The AI surface the workspace renders against — mirrors the VaultController
// pattern. The authenticated app injects a real OpenAI-backed client (see
// src/app/aiClient.ts); the marketing demo injects `mockAIClient` so the
// preview stays free, offline, and identical-looking without touching the API.

export interface Flashcard {
  q: string;
  a: string;
}

export interface AIClient {
  /** True for the demo's simulated client: skip the real microphone/network. */
  simulated: boolean;
  chat(input: {
    noteTitle?: string;
    noteContent?: string;
    outline?: string;
    question: string;
  }): Promise<string>;
  summarize(input: { noteTitle: string; noteContent: string }): Promise<string>;
  flashcards(input: { noteTitle: string; noteContent: string }): Promise<Flashcard[]>;
  findLinks(input: { noteTitle: string; noteContent: string; titles: string[] }): Promise<string[]>;
  transcribe(audio: Blob): Promise<string>;
  lectureNotes(input: { transcript: string; titles: string[] }): Promise<string>;
}

/* ----------------------------- demo mock ------------------------------- */

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const DEMO_SUMMARY =
  "This note covers photosynthesis: two linked stages (light-dependent reactions in the " +
  "thylakoid, then the Calvin cycle in the stroma), with chlorophyll absorbing light and CO₂ " +
  "feeding glucose synthesis.";

const DEMO_TRANSCRIPT =
  "Okay everyone, today we're covering photosynthesis. Plants convert light energy into chemical " +
  "energy, stored as glucose. There are two linked stages: the light-dependent reactions and the " +
  "Calvin cycle. Chlorophyll inside the chloroplast absorbs light — mostly red and blue " +
  "wavelengths. Carbon dioxide enters through the stomata and feeds the Calvin cycle.";

const DEMO_LECTURE_MD = [
  "## AI Lecture Notes",
  "",
  "### Main explanation",
  "Photosynthesis converts light energy into chemical energy stored in glucose, across two linked stages.",
  "",
  "### Key definitions",
  "- Chlorophyll: pigment that absorbs light energy.",
  "- Chloroplast: organelle where photosynthesis occurs.",
  "- Calvin cycle: light-independent stage that fixes CO₂ into sugar.",
  "",
  "### Important relationships",
  "- [[Chloroplast]] is connected to [[Photosynthesis]]",
  "- [[Glucose]] is the product of photosynthesis",
  "- [[Carbon Dioxide]] is a reactant in the process",
  "",
  "### Possible test questions",
  "- Explain the difference between light-dependent reactions and the Calvin cycle.",
  "- Why is chlorophyll important?",
  "- What role does carbon dioxide play?",
].join("\n");

/** Scripted, zero-cost client used by the public marketing demo. */
export const mockAIClient: AIClient = {
  simulated: true,
  async chat() {
    await delay(600);
    return (
      "I can summarize the open note, find related concepts, or record your next lecture — " +
      "the transcript stays right here in this window."
    );
  },
  async summarize() {
    await delay(600);
    return DEMO_SUMMARY;
  },
  async flashcards() {
    await delay(600);
    return [
      { q: "What absorbs light in photosynthesis?", a: "Chlorophyll inside the chloroplast." },
      { q: "What are the two stages of photosynthesis?", a: "Light-dependent reactions and the Calvin cycle." },
      { q: "What role does CO₂ play?", a: "It is fixed into glucose during the Calvin cycle." },
    ];
  },
  async findLinks() {
    await delay(600);
    return ["Chloroplast", "Glucose", "Carbon Dioxide", "Cell Structure"];
  },
  async transcribe() {
    await delay(900);
    return DEMO_TRANSCRIPT;
  },
  async lectureNotes() {
    await delay(900);
    return DEMO_LECTURE_MD;
  },
};
