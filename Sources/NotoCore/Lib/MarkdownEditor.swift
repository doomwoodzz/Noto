import Foundation

public struct MarkdownEdit: Equatable {
    public let content: String
    public let selection: NSRange

    public init(content: String, selection: NSRange) {
        self.content = content
        self.selection = selection
    }
}

public enum MarkdownInlineStyle: Equatable {
    case bold
    case italic
    case underline

    var openingMarker: String {
        switch self {
        case .bold:
            return "**"
        case .italic:
            return "*"
        case .underline:
            return "<u>"
        }
    }

    var closingMarker: String {
        switch self {
        case .bold:
            return "**"
        case .italic:
            return "*"
        case .underline:
            return "</u>"
        }
    }
}

public enum MarkdownEditor {
    public static func applyInlineStyle(
        _ style: MarkdownInlineStyle,
        to content: String,
        selection: NSRange
    ) -> MarkdownEdit {
        let safeSelection = clamped(selection, in: content)
        let storage = NSMutableString(string: content)
        let selectedText = storage.substring(with: safeSelection)
        let replacement = "\(style.openingMarker)\(selectedText)\(style.closingMarker)"

        storage.replaceCharacters(in: safeSelection, with: replacement)

        return MarkdownEdit(
            content: storage as String,
            selection: NSRange(
                location: safeSelection.location + style.openingMarker.utf16.count,
                length: safeSelection.length
            )
        )
    }

    public static func insertText(_ text: String, into content: String, selection: NSRange) -> MarkdownEdit {
        replaceSelection(with: text, in: content, selection: selection)
    }

    public static func handleEnter(in content: String, selection: NSRange) -> MarkdownEdit {
        let safeSelection = clamped(selection, in: content)
        let linePrefix = currentLinePrefix(in: content, location: safeSelection.location)
        let trimmedPrefix = linePrefix.trimmingCharacters(in: .whitespaces)

        if trimmedPrefix == "-" {
            let lineStart = currentLineStart(in: content, location: safeSelection.location)
            let storage = NSMutableString(string: content)
            storage.replaceCharacters(in: NSRange(location: lineStart, length: safeSelection.location - lineStart), with: "")
            return MarkdownEdit(content: storage as String, selection: NSRange(location: lineStart, length: 0))
        }

        if linePrefix.trimmingCharacters(in: .whitespaces).hasPrefix("- "), !linePrefix.trimmingCharacters(in: .whitespaces).dropFirst(2).isEmpty {
            return replaceSelection(with: "\n- ", in: content, selection: safeSelection)
        }

        return replaceSelection(with: "\n", in: content, selection: safeSelection)
    }

    public static func handleTab(in content: String, selection: NSRange, isShiftPressed: Bool) -> MarkdownEdit {
        let safeSelection = clamped(selection, in: content)
        let lineStart = currentLineStart(in: content, location: safeSelection.location)

        if isShiftPressed {
            return outdent(content: content, selection: safeSelection, lineStart: lineStart)
        }

        let storage = NSMutableString(string: content)
        storage.insert("    ", at: lineStart)

        return MarkdownEdit(
            content: storage as String,
            selection: NSRange(location: safeSelection.location + 4, length: safeSelection.length)
        )
    }

    private static func replaceSelection(with text: String, in content: String, selection: NSRange) -> MarkdownEdit {
        let safeSelection = clamped(selection, in: content)
        let storage = NSMutableString(string: content)

        storage.replaceCharacters(in: safeSelection, with: text)

        return MarkdownEdit(
            content: storage as String,
            selection: NSRange(location: safeSelection.location + text.utf16.count, length: 0)
        )
    }

    private static func outdent(content: String, selection: NSRange, lineStart: Int) -> MarkdownEdit {
        let storage = NSMutableString(string: content)
        let lineRemainder = storage.substring(
            with: NSRange(location: lineStart, length: min(4, max(storage.length - lineStart, 0)))
        )
        let removableSpaces = lineRemainder.prefix { $0 == " " }.count
        guard removableSpaces > 0 else {
            return MarkdownEdit(content: content, selection: selection)
        }

        storage.deleteCharacters(in: NSRange(location: lineStart, length: removableSpaces))

        return MarkdownEdit(
            content: storage as String,
            selection: NSRange(
                location: max(lineStart, selection.location - removableSpaces),
                length: selection.length
            )
        )
    }

    private static func currentLinePrefix(in content: String, location: Int) -> String {
        let storage = content as NSString
        let safeLocation = min(max(location, 0), storage.length)
        let lineStart = currentLineStart(in: content, location: safeLocation)
        return storage.substring(with: NSRange(location: lineStart, length: safeLocation - lineStart))
    }

    private static func currentLineStart(in content: String, location: Int) -> Int {
        let storage = content as NSString
        let safeLocation = min(max(location, 0), storage.length)
        guard safeLocation > 0 else {
            return 0
        }

        let range = NSRange(location: 0, length: safeLocation)
        let beforeCursor = storage.substring(with: range)
        guard let newlineRange = beforeCursor.range(of: "\n", options: .backwards) else {
            return 0
        }

        return beforeCursor.distance(from: beforeCursor.startIndex, to: newlineRange.upperBound)
    }

    private static func clamped(_ range: NSRange, in content: String) -> NSRange {
        let length = (content as NSString).length
        let location = min(max(range.location, 0), length)
        let end = min(max(range.location + range.length, location), length)
        return NSRange(location: location, length: end - location)
    }
}
