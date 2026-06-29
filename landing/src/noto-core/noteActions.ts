// Faithful port of Sources/NotoCore/Lib/NoteActions.swift
import type { LectureMemory, VaultFile } from "./types";

/** Append a structured "AI Lecture Notes" section derived from recorder memory. */
export function appendAINotes(file: VaultFile, memory: LectureMemory, now: number): VaultFile {
  const content = file.content.trim() + "\n\n" + aiSection(memory);
  return { ...file, content, updatedAt: now };
}

export function createLectureNote(title: string, now: number): VaultFile {
  const safeTitle = normalizedTitle(title, "Untitled Lecture");
  return {
    id: `lecture-${slug(safeTitle)}`,
    path: `AI Lecture Notes/${safeTitle}.md`,
    title: safeTitle,
    content: `# ${safeTitle}\n\n## Live notes\nNoto will add structured lecture notes here after you press Record and then Stop.`,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function insertBacklink(title: string, file: VaultFile, now: number): VaultFile {
  const safeTitle = normalizedTitle(title, "Untitled");
  return { ...file, content: `${file.content}\n- [[${safeTitle}]]`, updatedAt: now };
}

function aiSection(memory: LectureMemory): string {
  const definitions =
    memory.definitions.length === 0
      ? [
          "- Chlorophyll: pigment that absorbs light energy.",
          "- Chloroplast: organelle where photosynthesis occurs.",
          "- Calvin cycle: process that helps produce sugar.",
        ]
      : memory.definitions.map((d) => `- ${d.term}: ${d.definition}`);

  const relationships =
    memory.linkedNotes.length === 0
      ? [
          "- [[Chloroplast]] is connected to [[Photosynthesis]]",
          "- [[Glucose]] is the product of photosynthesis",
          "- [[Carbon Dioxide]] is a reactant in the process",
        ]
      : memory.linkedNotes.map((n) => `- [[${n}]] is connected to the lecture`);

  const questions =
    memory.possibleQuestions.length === 0
      ? [
          "- Explain the difference between light-dependent reactions and the Calvin cycle.",
          "- Why is chlorophyll important?",
          "- What role does carbon dioxide play?",
        ]
      : memory.possibleQuestions.map((q) => `- ${q}`);

  return [
    "## AI Lecture Notes",
    "",
    "### Main explanation",
    "The teacher explained that photosynthesis converts light energy into chemical energy stored in glucose.",
    "",
    "### Key definitions",
    definitions.join("\n"),
    "",
    "### Important relationships",
    relationships.join("\n"),
    "",
    "### Possible test questions",
    questions.join("\n"),
  ].join("\n");
}

function normalizedTitle(title: string, fallback: string): string {
  const trimmed = title.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}

export function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
