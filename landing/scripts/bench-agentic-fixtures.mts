/**
 * Session script for the agentic-coding token benchmark.
 *
 * Models a realistic multi-turn agent working IN a Noto vault (reading context,
 * recalling memory, editing notes, recording decisions) — the "deep agentic
 * coding" loop, but over a knowledge vault instead of a source tree. Pure data:
 * no DB / model imports, so it is safe to static-import before DATABASE_PATH is set.
 *
 * Each turn names:
 *   - `query`     : what the agent needs context for (drives INPUT / retrieval).
 *   - `editTitle` : the real mock-vault note it edits this turn (must exist).
 *   - `edit`      : the change it produces (drives OUTPUT / write-back).
 *       kind "append"  → adds `delta` (optionally under a heading).
 *       kind "section" → replaces the `heading` section with `delta`.
 *   - `memory?`   : a fact/decision worth persisting this turn (OUTPUT, both dirs).
 *
 * Deltas are short, realistic additions; the baseline must re-emit the *whole*
 * note to land them, the optimized path emits only the delta.
 */

export type EditKind = "append" | "section";
export interface Turn {
  query: string;
  editTitle: string;
  edit: { kind: EditKind; heading?: string; delta: string };
  memory?: { text: string; type: string };
}

/** 12-turn session over the real School Vault notes. */
export const SESSION: Turn[] = [
  {
    query: "How do plants convert light energy into stored chemical energy?",
    editTitle: "Photosynthesis",
    edit: {
      kind: "append",
      heading: "Notes",
      delta: "Reviewed the light-dependent vs light-independent split: the thylakoid reactions produce ATP and NADPH, which the Calvin cycle then spends fixing CO₂ into G3P. Worth a flashcard on where each ATP molecule is consumed.",
    },
    memory: { text: "Decided to build flashcards for each ATP/NADPH consumption step in the Calvin cycle.", type: "decision" },
  },
  {
    query: "What is the role of carbon dioxide in the Calvin cycle?",
    editTitle: "Carbon Dioxide",
    edit: {
      kind: "append",
      delta: "CO₂ enters via stomata and is fixed by RuBisCO onto RuBP — the rate-limiting carboxylation step. Linked this back to the Photosynthesis note.",
    },
  },
  {
    query: "How is chloroplast structure related to glucose production?",
    editTitle: "Chloroplast",
    edit: {
      kind: "section",
      heading: "Structure",
      delta: "Stroma hosts the Calvin cycle; thylakoid membranes hold the photosystems. The double membrane gates metabolite exchange. Cross-referenced [[Glucose]] and [[Photosynthesis]].",
    },
    memory: { text: "Cross-referencing strategy: every organelle note links to the molecule it produces.", type: "decision" },
  },
  {
    query: "What does an enzyme do to the activation energy of a reaction?",
    editTitle: "Enzymes",
    edit: {
      kind: "append",
      delta: "Confirmed: enzymes lower activation energy without being consumed. Added a worked example comparing catalysed vs uncatalysed reaction-coordinate diagrams.",
    },
    memory: { text: "An enzyme is a biological catalyst that lowers activation energy and is not consumed.", type: "glossary" },
  },
  {
    query: "Summarise the internal organisation of a typical cell.",
    editTitle: "Cell Structure",
    edit: {
      kind: "append",
      heading: "Organelles",
      delta: "Added mitochondria (ATP via respiration) and chloroplasts (ATP/glucose via photosynthesis) as the two energy organelles. Noted membrane-bound vs non-membrane-bound distinction.",
    },
  },
  {
    query: "What is glucose and how does it store energy?",
    editTitle: "Glucose",
    edit: {
      kind: "append",
      delta: "C₆H₁₂O₆ — six-carbon sugar; energy is released stepwise in glycolysis then the citric-acid cycle. Tied this to the Cell Structure respiration notes.",
    },
    memory: { text: "Glucose (C6H12O6) is the shared output of photosynthesis and input to respiration — the vault's central molecule.", type: "fact" },
  },
  {
    query: "What were the main tensions between the US and USSR after WWII?",
    editTitle: "Cold War",
    edit: {
      kind: "section",
      heading: "Causes",
      delta: "Ideological (capitalism vs communism), the security dilemma over Eastern Europe, and nuclear brinkmanship. Restructured this section into a causation chain for the essay.",
    },
    memory: { text: "History final is causation-essay heavy; structure every history note as an explicit cause→effect chain.", type: "decision" },
  },
  {
    query: "When and why did the Industrial Revolution begin?",
    editTitle: "Industrial Revolution",
    edit: {
      kind: "append",
      delta: "Late 18th-century Britain: coal, capital, and enclosure-driven labour supply. Flagged the link to later Cold-War industrial capacity for the comparison essay.",
    },
  },
  {
    query: "How does a logarithm relate to exponentiation?",
    editTitle: "Logarithms",
    edit: {
      kind: "append",
      heading: "Key identities",
      delta: "log_b(xy)=log_b x+log_b y; log_b(x/y)=log_b x−log_b y; change of base log_b x = ln x / ln b. Added derivative reminder d/dx ln x = 1/x.",
    },
    memory: { text: "Prefers worked identity tables over prose for math notes.", type: "preference" },
  },
  {
    query: "What are the central themes of Macbeth?",
    editTitle: "Macbeth",
    edit: {
      kind: "section",
      heading: "Themes",
      delta: "Ambition as a corrupting engine; guilt manifesting physically (the blood motif); the instability of power seized by violence. Pulled three supporting quotes into the section.",
    },
  },
  {
    query: "Pull the key points from the May 13 biology lecture.",
    editTitle: "Biology Lecture - May 13",
    edit: {
      kind: "append",
      heading: "Summary",
      delta: "Lecture tied photosynthesis to cellular respiration as inverse processes; emphasised the ATP economy. Added action items: make the inverse-process diagram and review RuBisCO.",
    },
    memory: { text: "Decided to summarise each lecture into its note within 24h while it is fresh.", type: "decision" },
  },
  {
    query: "Refine the photosynthesis overview now that related notes are linked.",
    editTitle: "Photosynthesis",
    edit: {
      kind: "section",
      heading: "Overview",
      delta: "Overall: 6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂. This note now anchors the biology cluster — links out to [[Chloroplast]], [[Carbon Dioxide]], [[Glucose]], and [[Enzymes]].",
    },
  },
];
