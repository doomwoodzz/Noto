import Foundation
import Testing
@testable import NotoCore

@Test func vaultInitializersPreserveValues() {
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

    #expect(file.id == "file-1")
    #expect(file.path == "Biology/Test.md")
    #expect(file.title == "Test")
    #expect(file.content == "# Test")
    #expect(file.createdAt == createdAt)
    #expect(file.updatedAt == updatedAt)
    #expect(vault.id == "vault-1")
    #expect(vault.name == "Vault")
    #expect(vault.files == [file])
}

@Test func metadataCacheExposesLookupTables() {
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

    #expect(metadata.id == "file-1")
    #expect(metadata.path == "Biology/Test.md")
    #expect(metadata.title == "Test")
    #expect(metadata.headings == ["Heading"])
    #expect(metadata.outgoingLinks == ["A"])
    #expect(metadata.backlinks == ["B", "C"])
    #expect(metadata.tags == ["biology"])
    #expect(metadata.wordCount == 12)
    #expect(metadata.updatedAt == Date(timeIntervalSince1970: 10))
    #expect(cache.fileIdByTitle["Test"] == "file-1")
    #expect(cache.metadata(for: "file-1") == metadata)
}

@Test func graphModelsExposeRequiredValues() {
    let node = GraphNode(id: "n", title: "Node", path: "Node.md", backlinksCount: 2, outgoingCount: 3)
    let edge = GraphEdge(id: "e", source: "source", target: "target", weight: 0.75)
    let graph = KnowledgeGraph(nodes: [node], edges: [edge])

    #expect(GraphFilter.allCases == [.all, .local, .lectureOnly, .orphans])
    #expect(GraphFilter.allCases.map(\.id) == GraphFilter.allCases.map(\.rawValue))
    #expect(GraphFilter.all.title == "All Notes")
    #expect(GraphFilter.local.title == "Local Graph")
    #expect(GraphFilter.lectureOnly.title == "Lecture Notes")
    #expect(GraphFilter.orphans.title == "Orphans")
    #expect(node.degree == 5)
    #expect(edge.id == "e")
    #expect(edge.source == "source")
    #expect(edge.target == "target")
    #expect(edge.weight == 0.75)
    #expect(graph.nodes == [node])
    #expect(graph.edges == [edge])
}

@Test func lectureModelsExposeRequiredValues() {
    let definition = LectureDefinition(id: "definition-1", term: "Chloroplast", definition: "Organelle")
    let memory = LectureMemory()

    #expect(definition.id == "definition-1")
    #expect(definition.term == "Chloroplast")
    #expect(definition.definition == "Organelle")
    #expect(memory.concepts.isEmpty)
    #expect(memory.definitions.isEmpty)
    #expect(memory.importantPoints.isEmpty)
    #expect(memory.possibleQuestions.isEmpty)
    #expect(memory.linkedNotes.isEmpty)
    #expect(RecorderPhase.idle.isRecording == false)
    #expect(RecorderPhase.processing.isRecording == false)
    #expect(RecorderPhase.complete(targetNoteTitle: "Photosynthesis").isRecording == false)
    #expect(RecorderPhase.recording(startedAt: Date(timeIntervalSince1970: 20)).isRecording == true)
}
