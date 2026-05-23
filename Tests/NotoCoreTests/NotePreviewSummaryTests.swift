import Testing
@testable import NotoCore

@Test func previewSummaryRemovesMarkdownChromeAndUsesReadableSentences() {
    let content = """
    # Photosynthesis

    ## Key idea
    Photosynthesis converts light energy into chemical energy stored in glucose.
    - [[Chloroplast]]
    > Important: compare light-dependent reactions with the Calvin cycle.
    #biology
    """

    #expect(
        NotePreviewSummary.summarize(content) ==
        "Photosynthesis converts light energy into chemical energy stored in glucose. Chloroplast."
    )
}

@Test func previewSummaryFallsBackWhenContentHasNoReadableText() {
    #expect(NotePreviewSummary.summarize("# Title\n\n#biology") == "No preview text available.")
}

@Test func previewSummaryKeepsCompactCharacterLimit() {
    let content = """
    First sentence has enough detail to be useful. Second sentence adds context for the preview card. Third sentence should be excluded by the sentence limit.
    """

    #expect(
        NotePreviewSummary.summarize(content, sentenceLimit: 2, maxCharacters: 82) ==
        "First sentence has enough detail to be useful. Second sentence adds context for..."
    )
}
