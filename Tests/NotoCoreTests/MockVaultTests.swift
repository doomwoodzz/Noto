import Testing
@testable import NotoCore

@Test func schoolVaultContainsRequiredFoldersAndNotes() {
    let vault = MockVault.school

    #expect(vault.name == "School Vault")
    #expect(vault.files.contains { $0.path == "Biology/Photosynthesis.md" })
    #expect(vault.files.contains { $0.path == "Biology/Cell Structure.md" })
    #expect(vault.files.contains { $0.path == "Biology/Enzymes.md" })
    #expect(vault.files.contains { $0.path == "History/Cold War.md" })
    #expect(vault.files.contains { $0.path == "History/Industrial Revolution.md" })
    #expect(vault.files.contains { $0.path == "Mathematics/Logarithms.md" })
    #expect(vault.files.contains { $0.path == "AI Lecture Notes/Biology Lecture - May 13.md" })
}

@Test func biologyLectureContainsWikiLinks() {
    let lecture = MockVault.school.files.first { $0.title == "Biology Lecture - May 13" }

    #expect(lecture != nil)
    #expect(lecture?.content.contains("[[Chloroplast]]") == true)
    #expect(lecture?.content.contains("[[Cell Structure]]") == true)
}
