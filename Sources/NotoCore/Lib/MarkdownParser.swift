import Foundation

public struct ChecklistItem: Equatable, Identifiable {
    public let id: String
    public let text: String
    public let isComplete: Bool

    public init(text: String, isComplete: Bool) {
        self.id = "\(isComplete)-\(text)"
        self.text = text
        self.isComplete = isComplete
    }
}

public enum MarkdownParser {
    public static func extractWikiLinks(from content: String) -> [String] {
        matches(for: #"\[\[([^\[\]]+)\]\]"#, in: content)
            .map(normalizeTitle)
            .filter { !$0.isEmpty }
    }

    public static func extractHeadings(from content: String) -> [String] {
        content
            .split(whereSeparator: \.isNewline)
            .compactMap { headingText(from: String($0)) }
    }

    public static func extractTags(from content: String) -> [String] {
        var tags: [String] = []

        for line in content.split(whereSeparator: \.isNewline) {
            let text = String(line).trimmingCharacters(in: .whitespaces)
            if headingText(from: text) != nil {
                continue
            }

            let lineTags = matches(for: #"(?<!\w)#([A-Za-z][A-Za-z0-9_-]*)"#, in: text)
            for tag in lineTags where !tags.contains(tag) {
                tags.append(tag)
            }
        }

        return tags
    }

    public static func wordCount(in content: String) -> Int {
        var text = content
        text = text.replacingOccurrences(
            of: #"\[\[([^\[\]]+)\]\]"#,
            with: "$1",
            options: .regularExpression
        )
        text = text.replacingOccurrences(
            of: #"(?m)^#{1,6}\s+"#,
            with: "",
            options: .regularExpression
        )
        text = text.replacingOccurrences(
            of: #"(?m)^-\s+\[[ xX]\]\s+"#,
            with: "",
            options: .regularExpression
        )
        text = text.replacingOccurrences(
            of: #"(?m)^[-*]\s+"#,
            with: "",
            options: .regularExpression
        )
        text = text.replacingOccurrences(
            of: #"#([A-Za-z][A-Za-z0-9_-]*)"#,
            with: "",
            options: .regularExpression
        )

        return text
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .count
    }

    public static func extractChecklistItems(from content: String) -> [ChecklistItem] {
        content
            .split(whereSeparator: \.isNewline)
            .compactMap { line -> ChecklistItem? in
                let text = String(line).trimmingCharacters(in: .whitespaces)

                if text.hasPrefix("- [ ] ") {
                    return ChecklistItem(text: String(text.dropFirst(6)), isComplete: false)
                }

                if text.hasPrefix("- [x] ") || text.hasPrefix("- [X] ") {
                    return ChecklistItem(text: String(text.dropFirst(6)), isComplete: true)
                }

                return nil
            }
    }

    public static func normalizeTitle(_ title: String) -> String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func headingText(from line: String) -> String? {
        let text = line.trimmingCharacters(in: .whitespaces)
        var hashCount = 0

        for character in text {
            if character == "#" {
                hashCount += 1
            } else {
                break
            }
        }

        guard (1...6).contains(hashCount) else {
            return nil
        }

        let contentStart = text.index(text.startIndex, offsetBy: hashCount)
        guard contentStart < text.endIndex, text[contentStart].isWhitespace else {
            return nil
        }

        let heading = text[contentStart...].trimmingCharacters(in: .whitespaces)
        return heading.isEmpty ? nil : heading
    }

    private static func matches(for pattern: String, in text: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return []
        }

        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.matches(in: text, range: range).compactMap { match in
            guard match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: text) else {
                return nil
            }

            return String(text[range])
        }
    }
}
