import Foundation
import NotoCore

enum ModelAPIChecks {
    static func run() throws {
        try checkVaultModels()
        try checkMetadataModels()
        try checkGraphModels()
        try checkLectureModels()
    }

    private static func checkVaultModels() throws {
        let createdAt = Date(timeIntervalSince1970: 10)
        let updatedAt = Date(timeIntervalSince1970: 20)
        let file = VaultFile(
            id: "file-1",
            path: "Biology/Test.md",
            title: "Test",
            content: "# Test",
            createdAt: createdAt,
            updatedAt: updatedAt
        )
        let vault = Vault(id: "vault-1", name: "Vault", files: [file])

        try expect(file.id == "file-1", "VaultFile should preserve id")
        try expect(file.path == "Biology/Test.md", "VaultFile should preserve path")
        try expect(file.title == "Test", "VaultFile should preserve title")
        try expect(file.content == "# Test", "VaultFile should preserve content")
        try expect(file.createdAt == createdAt, "VaultFile should preserve createdAt")
        try expect(file.updatedAt == updatedAt, "VaultFile should preserve updatedAt")
        try expect(vault.id == "vault-1", "Vault should preserve id")
        try expect(vault.name == "Vault", "Vault should preserve name")
        try expect(vault.files == [file], "Vault should preserve files")
    }

    private static func checkMetadataModels() throws {
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

        try expect(metadata.id == "file-1", "FileMetadata id should match file id")
        try expect(metadata.path == "Biology/Test.md", "FileMetadata should preserve path")
        try expect(metadata.title == "Test", "FileMetadata should preserve title")
        try expect(metadata.headings == ["Heading"], "FileMetadata should preserve headings")
        try expect(metadata.outgoingLinks == ["A"], "FileMetadata should preserve outgoing links")
        try expect(metadata.backlinks == ["B", "C"], "FileMetadata should preserve backlinks")
        try expect(metadata.tags == ["biology"], "FileMetadata should preserve tags")
        try expect(metadata.wordCount == 12, "FileMetadata should preserve word count")
        try expect(metadata.updatedAt == Date(timeIntervalSince1970: 10), "FileMetadata should preserve updatedAt")
        try expect(cache.fileIdByTitle["Test"] == "file-1", "MetadataCache should expose title to file id lookup")
        try expect(cache.metadata(for: "file-1") == metadata, "MetadataCache should return metadata by file id")
    }

    private static func checkGraphModels() throws {
        let node = GraphNode(id: "n", title: "Node", path: "Node.md", backlinksCount: 2, outgoingCount: 3)
        let edge = GraphEdge(id: "e", source: "source", target: "target", weight: 0.75)
        let graph = KnowledgeGraph(nodes: [node], edges: [edge])

        try expect(GraphFilter.allCases == [.all, .local, .lectureOnly, .orphans], "GraphFilter cases should remain stable")
        try expect(
            GraphFilter.allCases.map(\.id) == GraphFilter.allCases.map(\.rawValue),
            "GraphFilter ids should match raw values"
        )
        try expect(GraphFilter.all.title == "All Notes", "GraphFilter.all should expose All Notes title")
        try expect(GraphFilter.local.title == "Local Graph", "GraphFilter.local should expose Local Graph title")
        try expect(GraphFilter.lectureOnly.title == "Lecture Notes", "GraphFilter.lectureOnly should expose Lecture Notes title")
        try expect(GraphFilter.orphans.title == "Orphans", "GraphFilter.orphans should expose Orphans title")
        try expect(node.degree == 5, "GraphNode degree should sum backlinks and outgoing counts")
        try expect(edge.id == "e", "GraphEdge should preserve id")
        try expect(edge.source == "source", "GraphEdge should preserve source")
        try expect(edge.target == "target", "GraphEdge should preserve target")
        try expect(edge.weight == 0.75, "GraphEdge should preserve weight")
        try expect(graph.nodes == [node], "KnowledgeGraph should preserve nodes")
        try expect(graph.edges == [edge], "KnowledgeGraph should preserve edges")
    }

    private static func checkLectureModels() throws {
        let definition = LectureDefinition(id: "definition-1", term: "Chloroplast", definition: "Organelle")
        let memory = LectureMemory()

        try expect(definition.id == "definition-1", "LectureDefinition should preserve id")
        try expect(definition.term == "Chloroplast", "LectureDefinition should preserve term")
        try expect(definition.definition == "Organelle", "LectureDefinition should preserve definition")
        try expect(memory.concepts.isEmpty, "LectureMemory concepts should default empty")
        try expect(memory.definitions.isEmpty, "LectureMemory definitions should default empty")
        try expect(memory.importantPoints.isEmpty, "LectureMemory important points should default empty")
        try expect(memory.possibleQuestions.isEmpty, "LectureMemory possible questions should default empty")
        try expect(memory.linkedNotes.isEmpty, "LectureMemory linked notes should default empty")

        try expect(RecorderPhase.idle.isRecording == false, "RecorderPhase.idle should not be recording")
        try expect(RecorderPhase.processing.isRecording == false, "RecorderPhase.processing should not be recording")
        try expect(
            RecorderPhase.complete(targetNoteTitle: "Photosynthesis").isRecording == false,
            "RecorderPhase.complete should not be recording"
        )
        try expect(
            RecorderPhase.recording(startedAt: Date(timeIntervalSince1970: 20)).isRecording == true,
            "RecorderPhase.recording should be recording"
        )
    }
}
