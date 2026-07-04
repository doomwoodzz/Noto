import Foundation
import NaturalLanguage

public enum NotePreviewSummary {
    public static func summarize(
        _ content: String,
        sentenceLimit: Int = 2,
        maxCharacters: Int = 180
    ) -> String {
        let cleaned = readableLines(from: content)
        guard !cleaned.isEmpty else {
            return "No preview text available."
        }

        let sentences = cleaned
            .flatMap(sentences(from:))
            .filter { !$0.isEmpty }

        let summary: String
        if sentences.isEmpty {
            summary = cleaned.joined(separator: " ")
        } else {
            summary = sentences.prefix(max(sentenceLimit, 1)).joined(separator: " ")
        }

        return compact(summary, maxCharacters: maxCharacters)
    }

    private static func readableLines(from content: String) -> [String] {
        content
            .split(whereSeparator: \.isNewline)
            .compactMap { line -> String? in
                var text = String(line).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else {
                    return nil
                }

                if isHeading(text) || isTagOnlyLine(text) || text.hasPrefix(">") {
                    return nil
                }

                text = text.replacingOccurrences(
                    of: #"^[-*]\s+\[[ xX]\]\s+"#,
                    with: "",
                    options: .regularExpression
                )
                text = text.replacingOccurrences(
                    of: #"^[-*]\s+"#,
                    with: "",
                    options: .regularExpression
                )
                text = text.replacingOccurrences(
                    of: #"\[\[([^\[\]]+)\]\]"#,
                    with: "$1",
                    options: .regularExpression
                )
                text = text.replacingOccurrences(
                    of: #"\*\*([^*]+)\*\*"#,
                    with: "$1",
                    options: .regularExpression
                )
                text = text.replacingOccurrences(
                    of: #"_([^_]+)_"#,
                    with: "$1",
                    options: .regularExpression
                )
                text = text.replacingOccurrences(of: "`", with: "")
                text = text.trimmingCharacters(in: .whitespacesAndNewlines)

                return text.isEmpty ? nil : text
            }
    }

    private static func sentences(from text: String) -> [String] {
        let tokenizer = NLTokenizer(unit: .sentence)
        tokenizer.string = text
        var result: [String] = []

        tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
            let sentence = String(text[range]).trimmingCharacters(in: .whitespacesAndNewlines)
            if !sentence.isEmpty {
                result.append(finishedSentence(sentence))
            }
            return true
        }

        if result.isEmpty {
            return [finishedSentence(text)]
        }

        return result
    }

    private static func finishedSentence(_ text: String) -> String {
        guard let last = text.last, !".?!".contains(last) else {
            return text
        }

        return text + "."
    }

    private static func compact(_ text: String, maxCharacters: Int) -> String {
        let normalized = text
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard normalized.count > maxCharacters, maxCharacters > 3 else {
            return normalized
        }

        let end = normalized.index(normalized.startIndex, offsetBy: maxCharacters - 3)
        return String(normalized[..<end]).trimmingCharacters(in: .whitespacesAndNewlines) + "..."
    }

    private static func isHeading(_ text: String) -> Bool {
        guard let first = text.first, first == "#" else {
            return false
        }

        let hashCount = text.prefix { $0 == "#" }.count
        guard (1...6).contains(hashCount), text.count > hashCount else {
            return false
        }

        let separatorIndex = text.index(text.startIndex, offsetBy: hashCount)
        return text[separatorIndex].isWhitespace
    }

    private static func isTagOnlyLine(_ text: String) -> Bool {
        let pattern = #"^(#[A-Za-z][A-Za-z0-9_-]*\s*)+$"#
        return text.range(of: pattern, options: .regularExpression) != nil
    }
}
