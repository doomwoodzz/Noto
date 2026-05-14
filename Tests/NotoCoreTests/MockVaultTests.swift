import Foundation
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

@Test func schoolVaultFixtureHasStableInvariants() {
    let vault = MockVault.school

    #expect(vault.files.count == 11)
    #expect(Set(vault.files.map(\.id)).count == vault.files.count)
    #expect(Set(vault.files.map(\.path)).count == vault.files.count)
    #expect(Set(vault.files.map(\.title)).count == vault.files.count)
    #expect(vault.files.allSatisfy { $0.createdAt == MockVault.baseDate })
    #expect(vault.files.allSatisfy { $0.updatedAt == MockVault.baseDate })

    let titles = Set(vault.files.map(\.title))
    let unresolvedLinks = vault.files.flatMap { file in
        wikiLinks(in: file.content).filter { !titles.contains($0) }
    }
    #expect(unresolvedLinks.isEmpty)
}

private func wikiLinks(in content: String) -> [String] {
    let regex = try! NSRegularExpression(pattern: #"\[\[([^\]]+)\]\]"#)
    let range = NSRange(content.startIndex..<content.endIndex, in: content)

    return regex.matches(in: content, range: range).compactMap { match in
        guard let linkRange = Range(match.range(at: 1), in: content) else {
            return nil
        }
        return String(content[linkRange])
    }
}
