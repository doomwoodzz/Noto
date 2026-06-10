// Scripted "AI at work" content for the landing-page preview.
// Nothing here is a real model — it is hand-authored copy plus a small
// recombination algorithm so answers vary slightly on every ask.
import type { GraphEdge, GraphNode } from "./types";

/** Made-up reasoning lines streamed in the recorder while Noto "thinks". */
export const AI_THINKING_LINES = [
  "Listening for key concepts…",
  "Transcribing the lecture audio…",
  "Spotting \"light-dependent reactions\"…",
  "Linking this to your Chloroplast note…",
  "Cross-referencing the Calvin cycle…",
  "Checking for existing backlinks…",
  "Drafting a summary in your voice…",
  "Tidying the outline and headings…",
];

/** The summary Noto "writes" into the active note, character by character. */
export const AI_SUMMARY_TEXT =
  "## AI Summary — Lecture, May 13\n" +
  "Noto listened to the full lecture and pulled out the core thread: " +
  "light-dependent reactions capture energy, then the [[Calvin Cycle]] " +
  "uses it to build [[Glucose]]. [[Enzymes]] keep every step moving at the " +
  "right pace.\n" +
  "Key takeaway: the light reactions and the Calvin cycle are two halves of " +
  "one system — one captures energy, the other stores it.";

/** New graph elements the AI "discovers" and draws into the Knowledge Web. */
export const AI_NEW_NODES: GraphNode[] = [
  { id: "ai-calvin-cycle", title: "Calvin Cycle", degree: 2 },
];

export const AI_NEW_EDGES: GraphEdge[] = [
  { source: "biology-photosynthesis", target: "ai-calvin-cycle" },
  { source: "biology-glucose", target: "ai-calvin-cycle" },
  { source: "biology-photosynthesis", target: "biology-enzymes" },
];

export function edgeKey(e: GraphEdge): string {
  return `${e.source}::${e.target}`;
}

/** The three questions a viewer can ask the AI box. */
export const AI_QUESTIONS = [
  "How does chlorophyll absorb light?",
  "Why is glucose important for plant cells?",
  "What is the role of carbon dioxide?",
];

// ----- Answer generator -------------------------------------------------
// Each answer is assembled from an opener + a shuffled set of core clauses
// + a closer, so the wording shifts a little every time it is asked while
// the meaning stays correct.

interface AnswerRecipe {
  openers: string[];
  clauses: string[];
  closers: string[];
}

const RECIPES: Record<string, AnswerRecipe> = {
  "How does chlorophyll absorb light?": {
    openers: [
      "From the lecture,",
      "Here's the short version —",
      "Based on what I just heard,",
    ],
    clauses: [
      "chlorophyll mainly absorbs red and blue wavelengths",
      "the pigment sits inside the [[Chloroplast]]",
      "the captured energy kicks off the light-dependent reactions",
    ],
    closers: [
      "Green light is reflected, which is why leaves look green.",
      "That reflected green is exactly what your eyes pick up.",
      "The rest cascades into the [[Calvin Cycle]].",
    ],
  },
  "Why is glucose important for plant cells?": {
    openers: [
      "Good question —",
      "In short,",
      "From your notes,",
    ],
    clauses: [
      "[[Glucose]] is the sugar the plant builds during photosynthesis",
      "it stores the chemical energy captured from light",
      "the [[Calvin Cycle]] is what assembles it",
    ],
    closers: [
      "The cell later breaks it down for fuel and growth.",
      "It's both an energy store and a building block.",
      "[[Enzymes]] manage how quickly it's used.",
    ],
  },
  "What is the role of carbon dioxide?": {
    openers: [
      "From the recording,",
      "Quick answer —",
      "As covered in class,",
    ],
    clauses: [
      "[[Carbon Dioxide]] enters the leaf through tiny stomata",
      "it's the raw carbon source for new sugars",
      "the [[Calvin Cycle]] fixes it into [[Glucose]]",
    ],
    closers: [
      "Without it, the light reactions would have nothing to feed.",
      "So it's the input that the stored light energy acts on.",
      "That fixation step is the bridge between air and sugar.",
    ],
  },
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Builds a slightly different—but always sensible—answer each call by
 * picking an opener/closer and using two of the (shuffled) core clauses.
 */
export function answerFor(question: string): string {
  const recipe = RECIPES[question];
  if (!recipe) return "I don't have that in the lecture yet.";
  const opener = pick(recipe.openers);
  const closer = pick(recipe.closers);
  const [first, second] = shuffle(recipe.clauses);
  return `${opener} ${first}, and ${second}. ${closer}`;
}
