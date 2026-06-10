// Ported from Tests/NotoCoreTests/NoteActionsTests.swift
import { describe, expect, it } from "vitest";
import { appendAINotes, createLectureNote, insertBacklink } from "./noteActions";
import { MOCK_BASE_DATE, SCHOOL_VAULT_FILES } from "./mockVault";
import type { LectureMemory } from "./types";

describe("NoteActions", () => {
  it("appendAINotes adds structured markdown and wiki links", () => {
    const original = SCHOOL_VAULT_FILES.find((f) => f.title === "Photosynthesis")!;
    const memory: LectureMemory = {
      concepts: ["chlorophyll absorbs light"],
      definitions: [{ id: "chlorophyll", term: "Chlorophyll", definition: "Pigment that absorbs light energy." }],
      importantPoints: ["Photosynthesis converts light energy into chemical energy."],
      possibleQuestions: ["Why is chlorophyll important?"],
      linkedNotes: ["Chloroplast", "Glucose", "Carbon Dioxide"],
    };

    const updated = appendAINotes(original, memory, MOCK_BASE_DATE + 60_000);

    expect(updated.id).toBe(original.id);
    expect(updated.content).toContain("## AI Lecture Notes");
    expect(updated.content).toContain("### Key definitions");
    expect(updated.content).toContain("[[Chloroplast]]");
    expect(updated.content).toContain("[[Glucose]]");
    expect(updated.content).toContain("[[Carbon Dioxide]]");
    expect(updated.updatedAt).toBeGreaterThan(original.updatedAt);
  });

  it("createLectureNote builds the path and content", () => {
    const note = createLectureNote("Biology Lecture - May 13", MOCK_BASE_DATE);
    expect(note.path).toBe("AI Lecture Notes/Biology Lecture - May 13.md");
    expect(note.title).toBe("Biology Lecture - May 13");
    expect(note.content).toContain("# Biology Lecture - May 13");
    expect(note.createdAt).toBe(MOCK_BASE_DATE);
    expect(note.updatedAt).toBe(MOCK_BASE_DATE);
  });

  it("insertBacklink appends a wiki link and updates the timestamp", () => {
    const original = SCHOOL_VAULT_FILES.find((f) => f.title === "Cold War")!;
    const updated = insertBacklink("Industrial Revolution", original, MOCK_BASE_DATE + 120_000);
    expect(updated.content.endsWith("- [[Industrial Revolution]]")).toBe(true);
    expect(updated.updatedAt).toBeGreaterThan(original.updatedAt);
  });
});
