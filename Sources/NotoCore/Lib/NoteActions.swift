import Foundation

public enum NoteActions {
    public static func appendAINotes(to file: VaultFile, memory: LectureMemory, now: Date) -> VaultFile {
        let content = file.content.trimmingCharacters(in: .whitespacesAndNewlines) + "\n\n" + aiSection(from: memory)

        return VaultFile(
            id: file.id,
            path: file.path,
            title: file.title,
            content: content,
            createdAt: file.createdAt,
            updatedAt: now
        )
    }

    public static func createLectureNote(title: String, now: Date) -> VaultFile {
        let safeTitle = normalizedTitle(title, fallback: "Untitled Lecture")

        return VaultFile(
            id: "lecture-\(slug(from: safeTitle))",
            path: "AI Lecture Notes/\(safeTitle).md",
            title: safeTitle,
            content: """
            # \(safeTitle)

            ## Live notes
            Noto will add structured lecture notes here after you press Record and then Stop.
            """,
            createdAt: now,
            updatedAt: now
        )
    }

    public static func insertBacklink(_ title: String, into file: VaultFile, now: Date) -> VaultFile {
        let safeTitle = normalizedTitle(title, fallback: "Untitled")

        return VaultFile(
            id: file.id,
            path: file.path,
            title: file.title,
            content: file.content + "\n- [[\(safeTitle)]]",
            createdAt: file.createdAt,
            updatedAt: now
        )
    }

    private static func aiSection(from memory: LectureMemory) -> String {
        let definitions = memory.definitions.isEmpty
            ? [
                "- Chlorophyll: pigment that absorbs light energy.",
                "- Chloroplast: organelle where photosynthesis occurs.",
                "- Calvin cycle: process that helps produce sugar."
            ]
            : memory.definitions.map { "- \($0.term): \($0.definition)" }

        let relationships = memory.linkedNotes.isEmpty
            ? [
                "- [[Chloroplast]] is connected to [[Photosynthesis]]",
                "- [[Glucose]] is the product of photosynthesis",
                "- [[Carbon Dioxide]] is a reactant in the process"
            ]
            : memory.linkedNotes.map { "- [[\($0)]] is connected to the lecture" }

        let questions = memory.possibleQuestions.isEmpty
            ? [
                "- Explain the difference between light-dependent reactions and the Calvin cycle.",
                "- Why is chlorophyll important?",
                "- What role does carbon dioxide play?"
            ]
            : memory.possibleQuestions.map { "- \($0)" }

        return """
        ## AI Lecture Notes

        ### Main explanation
        The teacher explained that photosynthesis converts light energy into chemical energy stored in glucose.

        ### Key definitions
        \(definitions.joined(separator: "\n"))

        ### Important relationships
        \(relationships.joined(separator: "\n"))

        ### Possible test questions
        \(questions.joined(separator: "\n"))
        """
    }

    private static func normalizedTitle(_ title: String, fallback: String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : trimmed
    }

    private static func slug(from title: String) -> String {
        let allowed = CharacterSet.alphanumerics
        let scalars = title.lowercased().unicodeScalars.map { scalar -> Character in
            allowed.contains(scalar) ? Character(scalar) : "-"
        }
        let dashed = String(scalars)

        return dashed
            .split(separator: "-")
            .joined(separator: "-")
    }
}
