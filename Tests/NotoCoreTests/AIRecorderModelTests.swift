import Testing
@testable import NotoCore

@Test func recordingOnlyStartsAfterExplicitStart() {
    var recorder = AIRecorderModel()

    #expect(recorder.phase == .idle)
    #expect(!recorder.phase.isRecording)

    recorder.tick()
    #expect(recorder.memory.concepts.isEmpty)

    recorder.start(now: MockVault.baseDate)

    #expect(recorder.phase.isRecording)
    #expect(recorder.memory.concepts == [])
    #expect(recorder.elapsedSeconds == 0)
}

@Test func tickAddsSimulatedConceptsWhileRecording() {
    var recorder = AIRecorderModel()
    recorder.start(now: MockVault.baseDate)

    recorder.tick()
    recorder.tick()

    #expect(Array(recorder.memory.concepts.prefix(2)) == [
        "chlorophyll absorbs light",
        "glucose stores chemical energy"
    ])
    #expect(recorder.memory.linkedNotes.contains("Chloroplast"))
    #expect(recorder.elapsedSeconds == 4)
}

@Test func stopMovesThroughProcessingToComplete() {
    var recorder = AIRecorderModel()
    recorder.start(now: MockVault.baseDate)
    recorder.tick()

    recorder.stop(targetNoteTitle: "Photosynthesis")

    #expect(recorder.phase == .processing)

    recorder.finishProcessing(targetNoteTitle: "Photosynthesis")

    #expect(recorder.phase == .complete(targetNoteTitle: "Photosynthesis"))
}

@Test func resetClearsRecordingMemory() {
    var recorder = AIRecorderModel()
    recorder.start(now: MockVault.baseDate)
    recorder.tick()

    recorder.reset()

    #expect(recorder.phase == .idle)
    #expect(recorder.memory == LectureMemory())
    #expect(recorder.elapsedSeconds == 0)
}
