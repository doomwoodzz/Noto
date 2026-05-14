import Foundation
import Testing
@testable import NotoCore

@Test func modelAPIsExposeRequiredDerivedValues() {
    let metadata = FileMetadata(
        fileId: "file-1",
        path: "Biology/Test.md",
        title: "Test",
        headings: ["Heading"],
        outgoingLinks: ["A"],
        backlinks: ["B", "C"],
        tags: ["biology"],
        wordCount: 12,
        updatedAt: Date(timeIntervalSince1970: 10)
    )
    let cache = MetadataCache(filesById: ["file-1": metadata], fileIdByTitle: ["Test": "file-1"])

    #expect(cache.metadata(for: "file-1") == metadata)
    #expect(GraphFilter.local.title == "Local Graph")
    #expect(GraphNode(id: "n", title: "Node", path: "Node.md", backlinksCount: 2, outgoingCount: 3).degree == 5)
    #expect(LectureMemory().concepts.isEmpty)
    #expect(LectureMemory().definitions.isEmpty)
    #expect(LectureMemory().importantPoints.isEmpty)
    #expect(LectureMemory().possibleQuestions.isEmpty)
    #expect(LectureMemory().linkedNotes.isEmpty)
    #expect(RecorderPhase.idle.isRecording == false)
    #expect(RecorderPhase.recording(startedAt: Date(timeIntervalSince1970: 20)).isRecording == true)
}
