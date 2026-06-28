// TS mirror of Sources/NotoCore/Data/MockVault.swift — used by the parity
// tests (and as the canonical seed reference). Not shipped to users; new
// accounts get an empty vault + a Welcome note instead.
import type { VaultFile } from "./types";

/** Swift uses Date(timeIntervalSince1970: 1_715_587_200); here as epoch ms. */
export const MOCK_BASE_DATE = 1_715_587_200 * 1000;

function note(id: string, path: string, title: string, content: string): VaultFile {
  return { id, path, title, content, pinned: false, createdAt: MOCK_BASE_DATE, updatedAt: MOCK_BASE_DATE };
}

export const SCHOOL_VAULT_FILES: VaultFile[] = [
  note(
    "biology-photosynthesis",
    "Biology/Photosynthesis.md",
    "Photosynthesis",
    `# Biology Lecture - Photosynthesis

## Key idea
Photosynthesis is the process where plants convert light energy into chemical energy.

## Important terms
- [[Chloroplast]]
- [[Glucose]]
- [[Carbon Dioxide]]
- [[Cell Structure]]

## Summary
The lecture explained how light-dependent reactions and the Calvin cycle work together.

## Questions to review
- [ ] How does chlorophyll absorb light?
- [ ] Why is glucose important for plant cells?
- [ ] What is the role of carbon dioxide?`,
  ),
  note(
    "biology-cell-structure",
    "Biology/Cell Structure.md",
    "Cell Structure",
    `# Cell Structure

Organelles work together in plant and animal cells.

## Links
- [[Photosynthesis]]
- [[Chloroplast]]`,
  ),
  note(
    "biology-enzymes",
    "Biology/Enzymes.md",
    "Enzymes",
    `# Enzymes

Enzymes speed up reactions in cells and help metabolic pathways.

## Related
- [[Photosynthesis]]
- [[Glucose]]`,
  ),
  note(
    "biology-chloroplast",
    "Biology/Chloroplast.md",
    "Chloroplast",
    `# Chloroplast

Chloroplasts are organelles where [[Photosynthesis]] occurs.
#biology`,
  ),
  note(
    "biology-glucose",
    "Biology/Glucose.md",
    "Glucose",
    `# Glucose

Glucose stores chemical energy produced by [[Photosynthesis]].`,
  ),
  note(
    "biology-carbon-dioxide",
    "Biology/Carbon Dioxide.md",
    "Carbon Dioxide",
    `# Carbon Dioxide

Carbon dioxide enters leaves through stomata and is used in [[Photosynthesis]].`,
  ),
  note(
    "history-cold-war",
    "History/Cold War.md",
    "Cold War",
    `# Cold War

A period of geopolitical tension after World War II.
#history`,
  ),
  note(
    "history-industrial-revolution",
    "History/Industrial Revolution.md",
    "Industrial Revolution",
    `# Industrial Revolution

A major shift from hand production to machine production.`,
  ),
  note(
    "math-logarithms",
    "Mathematics/Logarithms.md",
    "Logarithms",
    `# Logarithms

Logarithms answer exponent questions.`,
  ),
  note(
    "literature-macbeth",
    "Literature/Macbeth.md",
    "Macbeth",
    `# Macbeth

A tragedy about ambition, guilt, and prophecy.`,
  ),
  note(
    "ai-biology-lecture-may-13",
    "AI Lecture Notes/Biology Lecture - May 13.md",
    "Biology Lecture - May 13",
    `# Biology Lecture - May 13

## Today
The teacher connected [[Photosynthesis]], [[Chloroplast]], [[Glucose]], and [[Cell Structure]].

> Important: compare light-dependent reactions with the Calvin cycle.

#lecture #biology`,
  ),
];
