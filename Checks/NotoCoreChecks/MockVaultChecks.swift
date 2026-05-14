import NotoCore

enum MockVaultChecks {
    static func run() throws {
        let vault = MockVault.school
        try expect(vault.name == "School Vault", "School Vault should have the required name")

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

        let lecture = vault.files.first { $0.title == "Biology Lecture - May 13" }
        try expect(lecture != nil, "Biology Lecture - May 13 should exist")
        try expect(lecture?.content.contains("[[Chloroplast]]") == true, "Biology lecture should link to Chloroplast")
        try expect(lecture?.content.contains("[[Cell Structure]]") == true, "Biology lecture should link to Cell Structure")
    }
}
