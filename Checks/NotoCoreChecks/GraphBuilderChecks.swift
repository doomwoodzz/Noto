import NotoCore

enum GraphBuilderChecks {
    static func run() throws {
        try buildsNodesAndEdgesFromMetadataCache()
        try graphNodesExposeBacklinkAndOutgoingCountsFromMetadata()
        try localFilterShowsActiveNoteOutgoingLinksAndBacklinks()
        try lectureOnlyFilterShowsLectureFolderNotes()
        try orphanFilterShowsNotesWithoutEdges()
    }

    private static func buildsNodesAndEdgesFromMetadataCache() throws {
        let vault = MockVault.school
        let cache = MetadataCacheBuilder.build(files: vault.files)
        let graph = GraphBuilder.build(files: vault.files, cache: cache)

        try expect(graph.nodes.count == vault.files.count, "Graph should contain one node per vault file")
        try expect(
            graph.edges.contains { $0.source == "biology-photosynthesis" && $0.target == "biology-chloroplast" },
            "Graph should include Photosynthesis to Chloroplast edge"
        )
        try expect(
            graph.edges.contains { $0.source == "ai-biology-lecture-may-13" && $0.target == "biology-photosynthesis" },
            "Graph should include lecture note to Photosynthesis edge"
        )
    }

    private static func graphNodesExposeBacklinkAndOutgoingCountsFromMetadata() throws {
        let vault = MockVault.school
        let cache = MetadataCacheBuilder.build(files: vault.files)
        let graph = GraphBuilder.build(files: vault.files, cache: cache)
        let photosynthesis = try required(
            graph.nodes.first { $0.id == "biology-photosynthesis" },
            "Photosynthesis graph node should exist"
        )

        try expect(photosynthesis.backlinksCount == 6, "Photosynthesis should expose generated backlink count")
        try expect(photosynthesis.outgoingCount == 4, "Photosynthesis should expose generated outgoing count")
        try expect(photosynthesis.degree == 10, "Photosynthesis degree should combine backlink and outgoing counts")
    }

    private static func localFilterShowsActiveNoteOutgoingLinksAndBacklinks() throws {
        let vault = MockVault.school
        let cache = MetadataCacheBuilder.build(files: vault.files)
        let graph = GraphBuilder.build(files: vault.files, cache: cache)
        let filtered = GraphBuilder.filter(graph: graph, mode: .local, activeFileId: "biology-photosynthesis")
        let titles = Set(filtered.nodes.map(\.title))

        for title in [
            "Photosynthesis",
            "Chloroplast",
            "Glucose",
            "Carbon Dioxide",
            "Cell Structure",
            "Enzymes",
            "Biology Lecture - May 13"
        ] {
            try expect(titles.contains(title), "Local graph should include \(title)")
        }

        try expect(!titles.contains("Cold War"), "Local graph should exclude unrelated notes")
    }

    private static func lectureOnlyFilterShowsLectureFolderNotes() throws {
        let vault = MockVault.school
        let cache = MetadataCacheBuilder.build(files: vault.files)
        let graph = GraphBuilder.build(files: vault.files, cache: cache)
        let filtered = GraphBuilder.filter(graph: graph, mode: .lectureOnly, activeFileId: "biology-photosynthesis")

        try expect(filtered.nodes.map(\.title) == ["Biology Lecture - May 13"], "Lecture graph should only include lecture notes")
        try expect(filtered.edges.isEmpty, "Lecture graph should only keep edges within lecture notes")
    }

    private static func orphanFilterShowsNotesWithoutEdges() throws {
        let vault = MockVault.school
        let cache = MetadataCacheBuilder.build(files: vault.files)
        let graph = GraphBuilder.build(files: vault.files, cache: cache)
        let filtered = GraphBuilder.filter(graph: graph, mode: .orphans, activeFileId: "biology-photosynthesis")
        let titles = Set(filtered.nodes.map(\.title))

        for title in ["Cold War", "Industrial Revolution", "Logarithms", "Macbeth"] {
            try expect(titles.contains(title), "Orphan graph should include \(title)")
        }

        try expect(filtered.edges.isEmpty, "Orphan graph should not contain edges")
    }

    private static func required<T>(_ value: T?, _ message: String) throws -> T {
        guard let value else {
            throw CheckFailure(message: message)
        }

        return value
    }
}
