import Foundation
import NotoCore

enum ModelAPIChecks {
    static func run() throws {
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

        try expect(cache.metadata(for: "file-1") == metadata, "MetadataCache should return metadata by file id")
        try expect(GraphFilter.local.title == "Local Graph", "GraphFilter.local should expose Local Graph title")

        let node = GraphNode(id: "n", title: "Node", path: "Node.md", backlinksCount: 2, outgoingCount: 3)
        try expect(node.degree == 5, "GraphNode degree should sum backlinks and outgoing counts")

        let memory = LectureMemory()
        try expect(memory.concepts.isEmpty, "LectureMemory concepts should default empty")
        try expect(memory.definitions.isEmpty, "LectureMemory definitions should default empty")
        try expect(memory.importantPoints.isEmpty, "LectureMemory important points should default empty")
        try expect(memory.possibleQuestions.isEmpty, "LectureMemory possible questions should default empty")
        try expect(memory.linkedNotes.isEmpty, "LectureMemory linked notes should default empty")

        try expect(RecorderPhase.idle.isRecording == false, "RecorderPhase.idle should not be recording")
        try expect(
            RecorderPhase.recording(startedAt: Date(timeIntervalSince1970: 20)).isRecording == true,
            "RecorderPhase.recording should be recording"
        )
    }
}
