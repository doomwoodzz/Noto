// Faithful port of Sources/NotoCore/Lib/AIRecorderModel.swift
import { emptyLectureMemory, type LectureDefinition, type LectureMemory, type RecorderPhase } from "./types";

interface ScriptItem {
  concept: string;
  definition: LectureDefinition | null;
  importantPoint: string;
  question: string | null;
  linkedNotes: string[];
}

const SCRIPT: ScriptItem[] = [
  {
    concept: "chlorophyll absorbs light",
    definition: { id: "chlorophyll", term: "Chlorophyll", definition: "Pigment that absorbs light energy." },
    importantPoint: "The teacher emphasized that light absorption starts the process.",
    question: "Why is chlorophyll important?",
    linkedNotes: ["Chloroplast", "Photosynthesis"],
  },
  {
    concept: "glucose stores chemical energy",
    definition: { id: "glucose", term: "Glucose", definition: "Sugar molecule that stores chemical energy." },
    importantPoint: "Glucose is the product students should connect to stored energy.",
    question: "Why is glucose important for plant cells?",
    linkedNotes: ["Glucose", "Photosynthesis"],
  },
  {
    concept: "carbon dioxide enters through stomata",
    definition: null,
    importantPoint: "Carbon dioxide is a reactant in the photosynthesis process.",
    question: "What role does carbon dioxide play?",
    linkedNotes: ["Carbon Dioxide", "Photosynthesis"],
  },
  {
    concept: "Calvin cycle produces sugar",
    definition: { id: "calvin-cycle", term: "Calvin cycle", definition: "Process that helps produce sugar from carbon dioxide." },
    importantPoint: "The Calvin cycle should be compared with light-dependent reactions.",
    question: "Compare light reactions and the Calvin cycle.",
    linkedNotes: ["Photosynthesis", "Glucose"],
  },
];

/**
 * The scripted lecture-recorder state machine. A direct port of the Swift
 * struct: identical phases, the same 2-second tick cadence, and the same
 * hand-authored photosynthesis script.
 */
export class AIRecorder {
  phase: RecorderPhase = { kind: "idle" };
  memory: LectureMemory = emptyLectureMemory();
  elapsedSeconds = 0;
  private conceptIndex = 0;

  get isRecording(): boolean {
    return this.phase.kind === "recording";
  }

  start(now: number): void {
    this.phase = { kind: "recording", startedAt: now };
    this.memory = emptyLectureMemory();
    this.elapsedSeconds = 0;
    this.conceptIndex = 0;
  }

  tick(): void {
    if (!this.isRecording) return;

    this.elapsedSeconds += 2;
    if (this.conceptIndex >= SCRIPT.length) return;

    const item = SCRIPT[this.conceptIndex];
    this.conceptIndex += 1;

    const m = this.memory;
    m.concepts.push(item.concept);
    if (item.definition) m.definitions.push(item.definition);
    m.importantPoints.push(item.importantPoint);
    if (item.question) m.possibleQuestions.push(item.question);
    for (const note of item.linkedNotes) {
      if (!m.linkedNotes.includes(note)) m.linkedNotes.push(note);
    }
  }

  stop(): void {
    if (!this.isRecording) return;
    if (this.memory.concepts.length === 0) this.tick();
    this.phase = { kind: "processing" };
  }

  finishProcessing(targetNoteTitle: string): void {
    this.phase = { kind: "complete", targetNoteTitle };
  }

  reset(): void {
    this.phase = { kind: "idle" };
    this.memory = emptyLectureMemory();
    this.elapsedSeconds = 0;
    this.conceptIndex = 0;
  }
}
