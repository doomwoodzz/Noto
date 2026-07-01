import NotoCore

enum NoteActionsChecks {
    static func run() throws {
        try appendAINotesAddsStructuredMarkdownAndWikiLinks()
        try createLectureNoteBuildsPathAndContent()
        try insertBacklinkAppendsWikiLinkAndUpdatesTimestamp()
    }

    private static func appendAINotesAddsStructuredMarkdownAndWikiLinks() throws {
        let original = try required(
            MockVault.school.files.first { $0.title == "Photosynthesis" },
            "Photosynthesis should exist"
        )
        let memory = LectureMemory(
            concepts: ["chlorophyll absorbs light"],
            definitions: [
                LectureDefinition(
                    id: "chlorophyll",
                    term: "Chlorophyll",
                    definition: "Pigment that absorbs light energy."
                )
            ],
            importantPoints: ["Photosynthesis converts light energy into chemical energy."],
            possibleQuestions: ["Why is chlorophyll important?"],
            linkedNotes: ["Chloroplast", "Glucose", "Carbon Dioxide"]
        )

        let updated = NoteActions.appendAINotes(
            to: original,
            memory: memory,
            now: MockVault.baseDate.addingTimeInterval(60)
        )

        try expect(updated.id == original.id, "AI note append should preserve file identity")
        try expect(updated.content.contains("## AI Lecture Notes"), "AI note append should add a section heading")
        try expect(updated.content.contains("### Key definitions"), "AI note append should add key definitions")
        try expect(updated.content.contains("[[Chloroplast]]"), "AI note append should link Chloroplast")
        try expect(updated.content.contains("[[Glucose]]"), "AI note append should link Glucose")
        try expect(updated.content.contains("[[Carbon Dioxide]]"), "AI note append should link Carbon Dioxide")
        try expect(updated.updatedAt > original.updatedAt, "AI note append should refresh updatedAt")
    }

    private static func createLectureNoteBuildsPathAndContent() throws {
        let note = NoteActions.createLectureNote(title: "Biology Lecture - May 13", now: MockVault.baseDate)

        try expect(note.path == "AI Lecture Notes/Biology Lecture - May 13.md", "Lecture note should live in AI Lecture Notes")
        try expect(note.title == "Biology Lecture - May 13", "Lecture note should preserve title")
        try expect(note.content.contains("# Biology Lecture - May 13"), "Lecture note content should start with a heading")
        try expect(note.createdAt == MockVault.baseDate, "Lecture note should use supplied createdAt")
        try expect(note.updatedAt == MockVault.baseDate, "Lecture note should use supplied updatedAt")
    }

    private static func insertBacklinkAppendsWikiLinkAndUpdatesTimestamp() throws {
        let original = try required(MockVault.school.files.first { $0.title == "Cold War" }, "Cold War should exist")
        let updated = NoteActions.insertBacklink(
            "Industrial Revolution",
            into: original,
            now: MockVault.baseDate.addingTimeInterval(120)
        )

        try expect(updated.content.hasSuffix("- [[Industrial Revolution]]"), "Insert backlink should append a wiki link")
        try expect(updated.updatedAt > original.updatedAt, "Insert backlink should refresh updatedAt")
    }

    private static func required<T>(_ value: T?, _ message: String) throws -> T {
        guard let value else {
            throw CheckFailure(message: message)
        }

        return value
    }
}
