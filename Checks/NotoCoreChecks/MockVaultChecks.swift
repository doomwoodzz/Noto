import Foundation
import NotoCore

enum MockVaultChecks {
    static func run() throws {
        let vault = MockVault.school
        try expect(vault.name == "School Vault", "School Vault should have the required name")
        try expect(vault.files.count == 11, "School Vault should contain 11 files")

        let requiredPaths = [
            "Biology/Photosynthesis.md",
            "Biology/Cell Structure.md",
            "Biology/Enzymes.md",
            "History/Cold War.md",
            "History/Industrial Revolution.md",
            "Mathematics/Logarithms.md",
            "AI Lecture Notes/Biology Lecture - May 13.md"
        ]

        for path in requiredPaths {
            try expect(vault.files.contains { $0.path == path }, "Missing required note path: \(path)")
        }

        let lecture = vault.files.first {
            $0.path == "AI Lecture Notes/Biology Lecture - May 13.md" &&
            $0.title == "Biology Lecture - May 13"
        }
        try expect(lecture != nil, "Biology Lecture - May 13 should exist")
        try expect(lecture?.content.contains("[[Chloroplast]]") == true, "Biology lecture should link to Chloroplast")
        try expect(lecture?.content.contains("[[Cell Structure]]") == true, "Biology lecture should link to Cell Structure")

        try expect(Set(vault.files.map(\.id)).count == vault.files.count, "Mock vault file ids should be unique")
        try expect(Set(vault.files.map(\.path)).count == vault.files.count, "Mock vault file paths should be unique")
        try expect(Set(vault.files.map(\.title)).count == vault.files.count, "Mock vault file titles should be unique")

        for file in vault.files {
            try expect(file.createdAt == MockVault.baseDate, "\(file.path) should use deterministic createdAt")
            try expect(file.updatedAt == MockVault.baseDate, "\(file.path) should use deterministic updatedAt")
        }

        let titles = Set(vault.files.map(\.title))
        let unresolvedLinks = vault.files.flatMap { file in
            wikiLinks(in: file.content)
                .filter { !titles.contains($0) }
                .map { "\(file.path) -> \($0)" }
        }
        try expect(
            unresolvedLinks.isEmpty,
            "Mock vault wiki links should resolve to file titles: \(unresolvedLinks.joined(separator: ", "))"
        )
    }

    private static func wikiLinks(in content: String) -> [String] {
        let regex = try! NSRegularExpression(pattern: #"\[\[([^\]]+)\]\]"#)
        let range = NSRange(content.startIndex..<content.endIndex, in: content)

        return regex.matches(in: content, range: range).compactMap { match in
            guard let linkRange = Range(match.range(at: 1), in: content) else {
                return nil
            }
            return String(content[linkRange])
        }
    }
}
