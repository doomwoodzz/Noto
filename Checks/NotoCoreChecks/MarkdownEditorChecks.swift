import Foundation
import NotoCore

enum MarkdownEditorChecks {
    static func run() throws {
        try applyingBoldWrapsSelectedTextAndKeepsSelectionOnInnerText()
        try applyingItalicWithEmptySelectionInsertsMarkersAroundCursor()
        try applyingUnderlineUsesHtmlUnderlineMarkers()
        try pressingSpaceAfterDashAtLineStartCreatesBulletMarker()
        try pressingEnterAfterDividerMarkerKeepsDividerAndMovesToNextLine()
        try pressingTabIndentsCurrentLine()
        try pressingShiftTabOutdentsCurrentLine()
    }

    private static func applyingBoldWrapsSelectedTextAndKeepsSelectionOnInnerText() throws {
        let edit = MarkdownEditor.applyInlineStyle(
            .bold,
            to: "Study chlorophyll today",
            selection: NSRange(location: 6, length: 11)
        )

        try expect(edit.content == "Study **chlorophyll** today", "Bold should wrap selected text")
        try expect(edit.selection == NSRange(location: 8, length: 11), "Bold should keep inner text selected")
    }

    private static func applyingItalicWithEmptySelectionInsertsMarkersAroundCursor() throws {
        let edit = MarkdownEditor.applyInlineStyle(
            .italic,
            to: "Study today",
            selection: NSRange(location: 6, length: 0)
        )

        try expect(edit.content == "Study **today", "Italic should insert paired markers")
        try expect(edit.selection == NSRange(location: 7, length: 0), "Italic cursor should sit between markers")
    }

    private static func applyingUnderlineUsesHtmlUnderlineMarkers() throws {
        let edit = MarkdownEditor.applyInlineStyle(
            .underline,
            to: "Remember osmosis",
            selection: NSRange(location: 9, length: 7)
        )

        try expect(edit.content == "Remember <u>osmosis</u>", "Underline should use HTML underline markers")
        try expect(edit.selection == NSRange(location: 12, length: 7), "Underline should keep inner text selected")
    }

    private static func pressingSpaceAfterDashAtLineStartCreatesBulletMarker() throws {
        let edit = MarkdownEditor.insertText(
            " ",
            into: "Topic\n-",
            selection: NSRange(location: 7, length: 0)
        )

        try expect(edit.content == "Topic\n- ", "Space after line-start dash should create bullet marker")
        try expect(edit.selection == NSRange(location: 8, length: 0), "Bullet marker should advance cursor")
    }

    private static func pressingEnterAfterDividerMarkerKeepsDividerAndMovesToNextLine() throws {
        let edit = MarkdownEditor.handleEnter(
            in: "Before\n---",
            selection: NSRange(location: 10, length: 0)
        )

        try expect(edit.content == "Before\n---\n", "Enter after divider marker should keep divider")
        try expect(edit.selection == NSRange(location: 11, length: 0), "Divider enter should move cursor to next line")
    }

    private static func pressingTabIndentsCurrentLine() throws {
        let edit = MarkdownEditor.handleTab(
            in: "First\nSecond",
            selection: NSRange(location: 8, length: 0),
            isShiftPressed: false
        )

        try expect(edit.content == "First\n    Second", "Tab should indent current line")
        try expect(edit.selection == NSRange(location: 12, length: 0), "Tab should preserve cursor position within line")
    }

    private static func pressingShiftTabOutdentsCurrentLine() throws {
        let edit = MarkdownEditor.handleTab(
            in: "First\n    Second",
            selection: NSRange(location: 10, length: 0),
            isShiftPressed: true
        )

        try expect(edit.content == "First\nSecond", "Shift-Tab should outdent current line")
        try expect(edit.selection == NSRange(location: 6, length: 0), "Shift-Tab should move cursor with removed indent")
    }
}
