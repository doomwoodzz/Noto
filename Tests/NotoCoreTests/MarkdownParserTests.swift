import Testing
@testable import NotoCore

@Test func extractsWikiLinksInOrderWithoutBrackets() {
    let content = "Study [[Photosynthesis]], [[Cell Structure]], and [[Cold War]]."

    #expect(
        MarkdownParser.extractWikiLinks(from: content) == [
            "Photosynthesis",
            "Cell Structure",
            "Cold War"
        ]
    )
}

@Test func extractsMarkdownHeadingsWithoutHashMarkers() {
    let content = """
    # Title
    Paragraph
    ## Key idea
    ### Details
    """

    #expect(MarkdownParser.extractHeadings(from: content) == ["Title", "Key idea", "Details"])
}

@Test func ignoresInlineTagsWhenExtractingHeadings() {
    let content = """
    # Biology
    This paragraph has #biology and #lecture tags.
    """

    #expect(MarkdownParser.extractHeadings(from: content) == ["Biology"])
}

@Test func extractsTagsWithoutTreatingHeadingsAsTags() {
    let content = """
    # Biology
    This line has #biology and #lecture tags.
    """

    #expect(MarkdownParser.extractTags(from: content) == ["biology", "lecture"])
}

@Test func countsWordsFromMarkdownText() {
    let content = """
    # Biology Lecture
    Photosynthesis converts light energy into chemical energy stored in glucose.
    - [[Chloroplast]]
    """

    #expect(MarkdownParser.wordCount(in: content) == 13)
}

@Test func extractsChecklistItems() {
    let content = """
    - [ ] Review chlorophyll
    - [x] Compare Calvin cycle
    """

    #expect(
        MarkdownParser.extractChecklistItems(from: content) == [
            ChecklistItem(text: "Review chlorophyll", isComplete: false),
            ChecklistItem(text: "Compare Calvin cycle", isComplete: true)
        ]
    )
}
