import NotoCore

enum AIRecorderModelChecks {
    static func run() throws {
        try recordingOnlyStartsAfterExplicitStart()
        try tickAddsSimulatedConceptsWhileRecording()
        try stopMovesThroughProcessingToComplete()
        try resetClearsRecordingMemory()
    }

    private static func recordingOnlyStartsAfterExplicitStart() throws {
        var recorder = AIRecorderModel()

        try expect(recorder.phase == .idle, "Recorder should start idle")
        try expect(!recorder.phase.isRecording, "Recorder should not start recording")

        recorder.tick()
        try expect(recorder.memory.concepts.isEmpty, "Recorder should not collect concepts before explicit start")

        recorder.start(now: MockVault.baseDate)

        try expect(recorder.phase.isRecording, "Recorder should start recording after explicit start")
        try expect(recorder.memory.concepts.isEmpty, "Recorder should reset memory on start")
        try expect(recorder.elapsedSeconds == 0, "Recorder should reset elapsed time on start")
    }

    private static func tickAddsSimulatedConceptsWhileRecording() throws {
        var recorder = AIRecorderModel()
        recorder.start(now: MockVault.baseDate)

        recorder.tick()
        recorder.tick()

        try expect(
            Array(recorder.memory.concepts.prefix(2)) == [
                "chlorophyll absorbs light",
                "glucose stores chemical energy"
            ],
            "Recorder ticks should add scripted concepts in order"
        )
        try expect(recorder.memory.linkedNotes.contains("Chloroplast"), "Recorder memory should collect linked notes")
        try expect(recorder.elapsedSeconds == 4, "Recorder ticks should advance elapsed time")
    }

    private static func stopMovesThroughProcessingToComplete() throws {
        var recorder = AIRecorderModel()
        recorder.start(now: MockVault.baseDate)
        recorder.tick()

        recorder.stop(targetNoteTitle: "Photosynthesis")

        try expect(recorder.phase == .processing, "Recorder stop should move to processing")

        recorder.finishProcessing(targetNoteTitle: "Photosynthesis")

        try expect(
            recorder.phase == .complete(targetNoteTitle: "Photosynthesis"),
            "Recorder finish should move to complete for target note"
        )
    }

    private static func resetClearsRecordingMemory() throws {
        var recorder = AIRecorderModel()
        recorder.start(now: MockVault.baseDate)
        recorder.tick()

        recorder.reset()

        try expect(recorder.phase == .idle, "Recorder reset should return to idle")
        try expect(recorder.memory == LectureMemory(), "Recorder reset should clear memory")
        try expect(recorder.elapsedSeconds == 0, "Recorder reset should clear elapsed time")
    }
}
