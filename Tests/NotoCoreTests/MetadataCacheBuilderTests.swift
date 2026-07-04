import Testing
@testable import NotoCore

@Test func buildsOutgoingLinksHeadingsTagsAndWordCount() throws {
    let cache = MetadataCacheBuilder.build(files: MockVault.school.files)
    let photosynthesis = try #require(MockVault.school.files.first { $0.title == "Photosynthesis" })
    let metadata = try #require(cache.filesById[photosynthesis.id])

    #expect(metadata.headings == [
        "Biology Lecture - Photosynthesis",
        "Key idea",
        "Important terms",
        "Summary",
        "Questions to review"
    ])
    #expect(metadata.outgoingLinks == ["Chloroplast", "Glucose", "Carbon Dioxide", "Cell Structure"])
    #expect(metadata.tags == [])
    #expect(metadata.path == "Biology/Photosynthesis.md")
    #expect(metadata.wordCount > 20)
}

@Test func extractsTagsFromNonHeadingLines() throws {
    let cache = MetadataCacheBuilder.build(files: MockVault.school.files)
    let chloroplast = try #require(MockVault.school.files.first { $0.title == "Chloroplast" })
    let metadata = try #require(cache.filesById[chloroplast.id])

    #expect(metadata.headings == ["Chloroplast"])
    #expect(metadata.tags == ["biology"])
}

@Test func generatesBacklinksByResolvingWikiLinksToKnownTitles() throws {
    let cache = MetadataCacheBuilder.build(files: MockVault.school.files)
    let photosynthesis = try #require(MockVault.school.files.first { $0.title == "Photosynthesis" })
    let metadata = try #require(cache.filesById[photosynthesis.id])

    #expect(Set(metadata.backlinks) == Set([
        "Biology Lecture - May 13",
        "Cell Structure",
        "Chloroplast",
        "Enzymes",
        "Glucose",
        "Carbon Dioxide"
    ]))
}

@Test func ignoresUnresolvedLinksWhenBuildingBacklinks() throws {
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

    #expect(cache.fileIdByTitle["Unresolved Topic"] == nil)
    #expect(!cache.filesById.values.contains { $0.backlinks.contains("Unresolved Topic") })
}
