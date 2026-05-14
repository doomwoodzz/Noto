import NotoCore

enum MetadataCacheBuilderChecks {
    static func run() throws {
        try buildsOutgoingLinksHeadingsTagsAndWordCount()
        try extractsTagsFromNonHeadingLines()
        try generatesBacklinksByResolvingWikiLinksToKnownTitles()
        try ignoresUnresolvedLinksWhenBuildingBacklinks()
    }

    private static func buildsOutgoingLinksHeadingsTagsAndWordCount() throws {
        let vault = MockVault.school
        let cache = MetadataCacheBuilder.build(files: vault.files)
        let photosynthesis = try required(vault.files.first { $0.title == "Photosynthesis" }, "Photosynthesis should exist")
        let metadata = try required(cache.filesById[photosynthesis.id], "Photosynthesis metadata should exist")

        try expect(
            metadata.headings == [
                "Biology Lecture - Photosynthesis",
                "Key idea",
                "Important terms",
                "Summary",
                "Questions to review"
            ],
            "Photosynthesis headings should be parsed from markdown"
        )
        try expect(
            metadata.outgoingLinks == ["Chloroplast", "Glucose", "Carbon Dioxide", "Cell Structure"],
            "Photosynthesis outgoing links should preserve wiki-link order"
        )
        try expect(metadata.tags.isEmpty, "Photosynthesis should not expose heading text as tags")
        try expect(metadata.path == "Biology/Photosynthesis.md", "Metadata should preserve file path")
        try expect(metadata.wordCount > 20, "Metadata should include markdown word count")
    }

    private static func extractsTagsFromNonHeadingLines() throws {
        let vault = MockVault.school
        let cache = MetadataCacheBuilder.build(files: vault.files)
        let chloroplast = try required(vault.files.first { $0.title == "Chloroplast" }, "Chloroplast should exist")
        let metadata = try required(cache.filesById[chloroplast.id], "Chloroplast metadata should exist")

        try expect(metadata.headings == ["Chloroplast"], "Chloroplast should expose its markdown heading")
        try expect(metadata.tags == ["biology"], "Chloroplast should expose inline biology tag")
    }

    private static func generatesBacklinksByResolvingWikiLinksToKnownTitles() throws {
        let vault = MockVault.school
        let cache = MetadataCacheBuilder.build(files: vault.files)
        let photosynthesis = try required(vault.files.first { $0.title == "Photosynthesis" }, "Photosynthesis should exist")
        let metadata = try required(cache.filesById[photosynthesis.id], "Photosynthesis metadata should exist")
        let expected = Set([
            "Biology Lecture - May 13",
            "Cell Structure",
            "Chloroplast",
            "Enzymes",
            "Glucose",
            "Carbon Dioxide"
        ])

        try expect(Set(metadata.backlinks) == expected, "Backlinks should be generated from resolved wiki links")
    }

    private static func ignoresUnresolvedLinksWhenBuildingBacklinks() throws {
        var files = MockVault.school.files
        let original = files[0]
        files[0] = VaultFile(
            id: original.id,
            path: original.path,
            title: original.title,
            content: original.content + "\n- [[Unresolved Topic]]",
            createdAt: original.createdAt,
            updatedAt: original.updatedAt
        )

        let cache = MetadataCacheBuilder.build(files: files)

        try expect(cache.fileIdByTitle["Unresolved Topic"] == nil, "Unresolved links should not create title lookups")
        try expect(
            !cache.filesById.values.contains { $0.backlinks.contains("Unresolved Topic") },
            "Unresolved links should not become backlinks"
        )
    }

    private static func required<T>(_ value: T?, _ message: String) throws -> T {
        guard let value else {
            throw CheckFailure(message: message)
        }

        return value
    }
}
