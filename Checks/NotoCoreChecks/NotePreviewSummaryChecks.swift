import NotoCore

enum NotePreviewSummaryChecks {
    static func run() throws {
        try removesMarkdownChromeAndUsesReadableSentences()
        try fallsBackWhenContentHasNoReadableText()
        try keepsCompactCharacterLimit()
    }

    private static func removesMarkdownChromeAndUsesReadableSentences() throws {
        let content = """
        # Photosynthesis

        ## Key idea
        Photosynthesis converts light energy into chemical energy stored in glucose.
        - [[Chloroplast]]
        > Important: compare light-dependent reactions with the Calvin cycle.
        #biology
        """

        try expect(
            NotePreviewSummary.summarize(content) ==
            "Photosynthesis converts light energy into chemical energy stored in glucose. Chloroplast.",
            "preview summary should remove markdown-only lines and keep readable note text"
        )
    }

    private static func fallsBackWhenContentHasNoReadableText() throws {
        try expect(
            NotePreviewSummary.summarize("# Title\n\n#biology") == "No preview text available.",
            "preview summary should provide an empty-content fallback"
        )
    }

    private static func keepsCompactCharacterLimit() throws {
        let content = """
        First sentence has enough detail to be useful. Second sentence adds context for the preview card. Third sentence should be excluded by the sentence limit.
        """

        try expect(
            NotePreviewSummary.summarize(content, sentenceLimit: 2, maxCharacters: 82) ==
            "First sentence has enough detail to be useful. Second sentence adds context for...",
            "preview summary should stay within a compact character limit"
        )
    }
}
