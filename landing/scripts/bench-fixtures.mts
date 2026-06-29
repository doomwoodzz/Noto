/**
 * Shared fixtures + config for the token-savings benchmarks (input + output).
 * Pure data only — no DB / model imports — so it is safe to static-import from
 * any entry script regardless of when that script sets DATABASE_PATH.
 *
 * Plan: docs/superpowers/plans/2026-06-29-noto-token-savings-benchmark.md
 */

// MCP defaults (noto-mcp/src/notoClient.ts): search_notes limit=5, recall limit=6.
export const NOTES_K = 5;
export const RECALL_K = 6;
export const RECALL_SCOPES = ["noto-web"]; // getUserMemoryVectors always unions in "global"
export const MEMORY_SCOPE = "noto-web";

export type Scenario = "notes" | "memory" | "combined";
export interface Query { q: string; scenario: Scenario; note: string }

/** Accumulated cross-session memory, in the repo's Noto memory shape
 *  (type ∈ decision | preference | fact | glossary — the server's allowed set). */
export const MEMORY_FIXTURE: { text: string; type: string }[] = [
  { text: "Prefers studying with the Pomodoro technique — 25 minute focus blocks, 5 minute breaks.", type: "preference" },
  { text: "Exams are graded on a curve; the biology midterm average last year was 72%.", type: "fact" },
  { text: "Decided to summarize every lecture into a single Markdown note within 24 hours of class.", type: "decision" },
  { text: "Finds spaced-repetition flashcards more effective than re-reading notes.", type: "preference" },
  { text: "The Calvin cycle is the light-independent stage of photosynthesis that fixes carbon dioxide into glucose.", type: "glossary" },
  { text: "Chlorophyll absorbs red and blue light most strongly and reflects green.", type: "fact" },
  { text: "Professor Lin's office hours are Tuesdays 2–4pm in the science building.", type: "fact" },
  { text: "Prefers dark mode and a serif font for long reading sessions.", type: "preference" },
  { text: "Decided to use wiki-links between every related note to build a knowledge graph.", type: "decision" },
  { text: "An enzyme is a biological catalyst that lowers the activation energy of a reaction.", type: "glossary" },
  { text: "The Cold War lasted roughly from 1947 to 1991 between the US and the Soviet Union.", type: "fact" },
  { text: "The Industrial Revolution began in Britain in the late 18th century.", type: "fact" },
  { text: "A logarithm is the inverse operation to exponentiation: log_b(x) answers b^? = x.", type: "glossary" },
  { text: "Macbeth's central themes are ambition, guilt, and the corrupting nature of power.", type: "fact" },
  { text: "Decided to record lectures with the AI recorder and review the auto-summary the same evening.", type: "decision" },
  { text: "Prefers concise bullet-point summaries over long prose when reviewing.", type: "preference" },
  { text: "Mitochondria are the organelles responsible for cellular respiration and ATP production.", type: "glossary" },
  { text: "Stomata are pores on leaves that let carbon dioxide in and water vapor out.", type: "glossary" },
  { text: "The history final covers WWII through the end of the Cold War — heavy on causation essays.", type: "fact" },
  { text: "Decided to keep all chemistry notes in the same vault folder as biology for cross-referencing.", type: "decision" },
  { text: "Prefers reviewing flashcards on the commute rather than at the desk.", type: "preference" },
  { text: "Glucose is a six-carbon sugar (C6H12O6) that stores chemical energy.", type: "glossary" },
  { text: "The Treaty of Versailles (1919) ended WWI and imposed reparations on Germany.", type: "fact" },
  { text: "Decided to write essay outlines before drafting, with one paragraph per argument.", type: "decision" },
  { text: "Finds mind-maps helpful for connecting historical causes and effects.", type: "preference" },
  { text: "The derivative of e^x is e^x; the derivative of ln(x) is 1/x.", type: "glossary" },
  { text: "Photosynthesis overall: 6CO2 + 6H2O + light → C6H12O6 + 6O2.", type: "fact" },
  { text: "Prefers to study hardest subjects in the morning when focus is highest.", type: "preference" },
  { text: "Decided to tag every lecture note with #lecture and the subject for fast filtering.", type: "decision" },
  { text: "The mitochondrial electron transport chain produces the bulk of a cell's ATP.", type: "fact" },
];

export const QUERIES: Query[] = [
  { q: "How do plants convert light into chemical energy?", scenario: "combined", note: "paraphrase of photosynthesis (no keyword overlap)" },
  { q: "What is the role of carbon dioxide in photosynthesis?", scenario: "notes", note: "direct biology lookup" },
  { q: "Explain how chloroplasts relate to glucose production", scenario: "combined", note: "multi-note biology" },
  { q: "What were the main tensions after World War II?", scenario: "notes", note: "paraphrase of Cold War" },
  { q: "How should I structure my study sessions?", scenario: "memory", note: "study-habit preferences" },
  { q: "What did I decide about summarizing lectures?", scenario: "memory", note: "decision recall" },
  { q: "Themes of ambition and guilt in literature", scenario: "notes", note: "Macbeth" },
  { q: "How do enzymes affect chemical reactions in cells?", scenario: "combined", note: "enzymes glossary + note" },
  { q: "What is a logarithm and how does it relate to exponents?", scenario: "combined", note: "math glossary + note" },
  { q: "Remind me of the office hours and exam details", scenario: "memory", note: "logistics facts" },
];

// Synthetic-but-realistic extra corpus (clearly labeled) for the scaling sweep.
const TOPICS = [
  ["Chemistry", "covalent bonds form when atoms share electron pairs to fill their valence shells"],
  ["Physics", "Newton's second law states force equals mass times acceleration"],
  ["Geography", "plate tectonics describes the slow movement of the Earth's lithospheric plates"],
  ["Economics", "supply and demand determine the equilibrium price in a competitive market"],
  ["Psychology", "classical conditioning pairs a neutral stimulus with an unconditioned response"],
  ["Astronomy", "a light-year is the distance light travels in one year, about 9.46 trillion km"],
];
export function makeSynthetic(n: number): { notes: { path: string; title: string; content: string }[]; mems: { text: string; type: string }[] } {
  const notes: { path: string; title: string; content: string }[] = [];
  const mems: { text: string; type: string }[] = [];
  for (let i = 0; i < n; i++) {
    const [subject, fact] = TOPICS[i % TOPICS.length];
    notes.push({
      path: `${subject}/Synthetic Note ${i + 1}.md`,
      title: `${subject} Topic ${i + 1}`,
      content: `# ${subject} Topic ${i + 1}\n\n## Key idea\nLecture ${i + 1}: ${fact}. This note explores variation ${i + 1} of the concept with worked examples and review questions.\n\n## Summary\nThe key takeaway for topic ${i + 1} connects to broader ${subject.toLowerCase()} principles.`,
    });
    mems.push({ text: `Synthetic study fact ${i + 1}: ${fact} (variation ${i + 1}).`, type: "glossary" });
  }
  return { notes, mems };
}
