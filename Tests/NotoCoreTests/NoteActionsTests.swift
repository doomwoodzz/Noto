import Testing
@testable import NotoCore

@Test func appendAINotesAddsStructuredMarkdownAndWikiLinks() throws {
    let original = try #require(MockVault.school.files.first { $0.title == "Photosynthesis" })
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

    #expect(updated.id == original.id)
    #expect(updated.content.contains("## AI Lecture Notes"))
    #expect(updated.content.contains("### Key definitions"))
    #expect(updated.content.contains("[[Chloroplast]]"))
    #expect(updated.content.contains("[[Glucose]]"))
    #expect(updated.content.contains("[[Carbon Dioxide]]"))
    #expect(updated.updatedAt > original.updatedAt)
}

@Test func createLectureNoteBuildsPathAndContent() {
    let note = NoteActions.createLectureNote(title: "Biology Lecture - May 13", now: MockVault.baseDate)

    #expect(note.path == "AI Lecture Notes/Biology Lecture - May 13.md")
    #expect(note.title == "Biology Lecture - May 13")
    #expect(note.content.contains("# Biology Lecture - May 13"))
    #expect(note.createdAt == MockVault.baseDate)
    #expect(note.updatedAt == MockVault.baseDate)
}

@Test func insertBacklinkAppendsWikiLinkAndUpdatesTimestamp() throws {
    let original = try #require(MockVault.school.files.first { $0.title == "Cold War" })
    let updated = NoteActions.insertBacklink(
        "Industrial Revolution",
        into: original,
        now: MockVault.baseDate.addingTimeInterval(120)
    )

    #expect(updated.content.hasSuffix("- [[Industrial Revolution]]"))
    #expect(updated.updatedAt > original.updatedAt)
}
