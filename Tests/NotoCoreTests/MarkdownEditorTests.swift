import Foundation
import Testing
@testable import NotoCore

@Test func applyingBoldWrapsSelectedTextAndKeepsSelectionOnInnerText() {
    let edit = MarkdownEditor.applyInlineStyle(
        .bold,
        to: "Study chlorophyll today",
        selection: NSRange(location: 6, length: 11)
    )

    #expect(edit.content == "Study **chlorophyll** today")
    #expect(edit.selection == NSRange(location: 8, length: 11))
}

@Test func applyingItalicWithEmptySelectionInsertsMarkersAroundCursor() {
    let edit = MarkdownEditor.applyInlineStyle(
        .italic,
        to: "Study today",
        selection: NSRange(location: 6, length: 0)
    )

    #expect(edit.content == "Study **today")
    #expect(edit.selection == NSRange(location: 7, length: 0))
}

@Test func applyingUnderlineUsesHtmlUnderlineMarkers() {
    let edit = MarkdownEditor.applyInlineStyle(
        .underline,
        to: "Remember osmosis",
        selection: NSRange(location: 9, length: 7)
    )

    #expect(edit.content == "Remember <u>osmosis</u>")
    #expect(edit.selection == NSRange(location: 12, length: 7))
}

@Test func pressingSpaceAfterDashAtLineStartCreatesBulletMarker() {
    let edit = MarkdownEditor.insertText(
        " ",
        into: "Topic\n-",
        selection: NSRange(location: 7, length: 0)
    )

    #expect(edit.content == "Topic\n- ")
    #expect(edit.selection == NSRange(location: 8, length: 0))
}

@Test func pressingEnterAfterDividerMarkerKeepsDividerAndMovesToNextLine() {
    let edit = MarkdownEditor.handleEnter(
        in: "Before\n---",
        selection: NSRange(location: 10, length: 0)
    )

    #expect(edit.content == "Before\n---\n")
    #expect(edit.selection == NSRange(location: 11, length: 0))
}

@Test func pressingTabIndentsCurrentLine() {
    let edit = MarkdownEditor.handleTab(
        in: "First\nSecond",
        selection: NSRange(location: 8, length: 0),
        isShiftPressed: false
    )

    #expect(edit.content == "First\n    Second")
    #expect(edit.selection == NSRange(location: 12, length: 0))
}

@Test func pressingShiftTabOutdentsCurrentLine() {
    let edit = MarkdownEditor.handleTab(
        in: "First\n    Second",
        selection: NSRange(location: 10, length: 0),
        isShiftPressed: true
    )

    #expect(edit.content == "First\nSecond")
    #expect(edit.selection == NSRange(location: 6, length: 0))
}
