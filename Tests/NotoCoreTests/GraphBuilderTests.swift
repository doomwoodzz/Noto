import Testing
@testable import NotoCore

@Test func buildsNodesAndEdgesFromMetadataCache() {
    let vault = MockVault.school
    let cache = MetadataCacheBuilder.build(files: vault.files)
    let graph = GraphBuilder.build(files: vault.files, cache: cache)

    #expect(graph.nodes.count == vault.files.count)
    #expect(graph.edges.contains { edge in
        edge.source == "biology-photosynthesis" && edge.target == "biology-chloroplast"
    })
    #expect(graph.edges.contains { edge in
        edge.source == "ai-biology-lecture-may-13" && edge.target == "biology-photosynthesis"
    })
}

@Test func graphNodesExposeBacklinkAndOutgoingCountsFromMetadata() throws {
    let vault = MockVault.school
    let cache = MetadataCacheBuilder.build(files: vault.files)
    let graph = GraphBuilder.build(files: vault.files, cache: cache)
    let photosynthesis = try #require(graph.nodes.first { $0.id == "biology-photosynthesis" })

    #expect(photosynthesis.backlinksCount == 6)
    #expect(photosynthesis.outgoingCount == 4)
    #expect(photosynthesis.degree == 10)
}

@Test func localFilterShowsActiveNoteOutgoingLinksAndBacklinks() {
    let vault = MockVault.school
    let cache = MetadataCacheBuilder.build(files: vault.files)
    let graph = GraphBuilder.build(files: vault.files, cache: cache)
    let filtered = GraphBuilder.filter(graph: graph, mode: .local, activeFileId: "biology-photosynthesis")
    let titles = Set(filtered.nodes.map(\.title))

    #expect(titles.contains("Photosynthesis"))
    #expect(titles.contains("Chloroplast"))
    #expect(titles.contains("Glucose"))
    #expect(titles.contains("Carbon Dioxide"))
    #expect(titles.contains("Cell Structure"))
    #expect(titles.contains("Enzymes"))
    #expect(titles.contains("Biology Lecture - May 13"))
    #expect(!titles.contains("Cold War"))
}

@Test func lectureOnlyFilterShowsLectureFolderNotes() {
    let vault = MockVault.school
    let cache = MetadataCacheBuilder.build(files: vault.files)
    let graph = GraphBuilder.build(files: vault.files, cache: cache)
    let filtered = GraphBuilder.filter(graph: graph, mode: .lectureOnly, activeFileId: "biology-photosynthesis")

    #expect(filtered.nodes.map(\.title) == ["Biology Lecture - May 13"])
    #expect(filtered.edges.isEmpty)
}

@Test func orphanFilterShowsNotesWithoutEdges() {
    let vault = MockVault.school
    let cache = MetadataCacheBuilder.build(files: vault.files)
    let graph = GraphBuilder.build(files: vault.files, cache: cache)
    let filtered = GraphBuilder.filter(graph: graph, mode: .orphans, activeFileId: "biology-photosynthesis")
    let titles = Set(filtered.nodes.map(\.title))

    #expect(titles.contains("Cold War"))
    #expect(titles.contains("Industrial Revolution"))
    #expect(titles.contains("Logarithms"))
    #expect(titles.contains("Macbeth"))
    #expect(filtered.edges.isEmpty)
}
