import NotoCore

enum MarkdownParserChecks {
    static func run() throws {
        try extractsWikiLinksInOrderWithoutBrackets()
        try extractsMarkdownHeadingsWithoutHashMarkers()
        try ignoresInlineTagsWhenExtractingHeadings()
        try extractsTagsWithoutTreatingHeadingsAsTags()
        try countsWordsFromMarkdownText()
        try extractsChecklistItems()
    }

    private static func extractsWikiLinksInOrderWithoutBrackets() throws {
        let content = "Study [[Photosynthesis]], [[Cell Structure]], and [[Cold War]]."

        try expect(
            MarkdownParser.extractWikiLinks(from: content) == [
                "Photosynthesis",
                "Cell Structure",
                "Cold War"
            ],
            "wiki links should be extracted in order without brackets"
        )
    }

    private static func extractsMarkdownHeadingsWithoutHashMarkers() throws {
        let content = """
        # Title
        Paragraph
        ## Key idea
        ### Details
        """

        try expect(
            MarkdownParser.extractHeadings(from: content) == ["Title", "Key idea", "Details"],
            "markdown headings should be extracted without hash markers"
        )
    }

    private static func ignoresInlineTagsWhenExtractingHeadings() throws {
        let content = """
        # Biology
        This paragraph has #biology and #lecture tags.
        """

        try expect(
            MarkdownParser.extractHeadings(from: content) == ["Biology"],
            "inline tags should not be treated as headings"
        )
    }

    private static func extractsTagsWithoutTreatingHeadingsAsTags() throws {
        let content = """
        # Biology
        This line has #biology and #lecture tags.
        """

        try expect(
            MarkdownParser.extractTags(from: content) == ["biology", "lecture"],
            "tags should be extracted without treating headings as tags"
        )
    }

    private static func countsWordsFromMarkdownText() throws {
        let content = """
        # Biology Lecture
        Photosynthesis converts light energy into chemical energy stored in glucose.
        - [[Chloroplast]]
        """

        try expect(MarkdownParser.wordCount(in: content) == 13, "markdown word count should ignore syntax")
    }

    private static func extractsChecklistItems() throws {
        let content = """
        - [ ] Review chlorophyll
        - [x] Compare Calvin cycle
        """

        try expect(
            MarkdownParser.extractChecklistItems(from: content) == [
                ChecklistItem(text: "Review chlorophyll", isComplete: false),
                ChecklistItem(text: "Compare Calvin cycle", isComplete: true)
            ],
            "checklist items should preserve text and completion state"
        )
    }
}
