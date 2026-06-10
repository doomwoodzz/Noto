// Ported from Tests/NotoCoreTests/AIRecorderModelTests.swift
import { describe, expect, it } from "vitest";
import { AIRecorder } from "./recorder";
import { emptyLectureMemory } from "./types";
import { MOCK_BASE_DATE } from "./mockVault";

describe("AIRecorder", () => {
  it("recording only starts after explicit start", () => {
    const recorder = new AIRecorder();
    expect(recorder.phase.kind).toBe("idle");
    expect(recorder.isRecording).toBe(false);

    recorder.tick();
    expect(recorder.memory.concepts).toEqual([]);

    recorder.start(MOCK_BASE_DATE);
    expect(recorder.isRecording).toBe(true);
    expect(recorder.memory.concepts).toEqual([]);
    expect(recorder.elapsedSeconds).toBe(0);
  });

  it("tick adds simulated concepts while recording", () => {
    const recorder = new AIRecorder();
    recorder.start(MOCK_BASE_DATE);

    recorder.tick();
    recorder.tick();

    expect(recorder.memory.concepts.slice(0, 2)).toEqual([
      "chlorophyll absorbs light",
      "glucose stores chemical energy",
    ]);
    expect(recorder.memory.linkedNotes).toContain("Chloroplast");
    expect(recorder.elapsedSeconds).toBe(4);
  });

  it("stop moves through processing to complete", () => {
    const recorder = new AIRecorder();
    recorder.start(MOCK_BASE_DATE);
    recorder.tick();

    recorder.stop();
    expect(recorder.phase.kind).toBe("processing");

    recorder.finishProcessing("Photosynthesis");
    expect(recorder.phase).toEqual({ kind: "complete", targetNoteTitle: "Photosynthesis" });
  });

  it("reset clears recording memory", () => {
    const recorder = new AIRecorder();
    recorder.start(MOCK_BASE_DATE);
    recorder.tick();

    recorder.reset();
    expect(recorder.phase.kind).toBe("idle");
    expect(recorder.memory).toEqual(emptyLectureMemory());
    expect(recorder.elapsedSeconds).toBe(0);
  });
});
