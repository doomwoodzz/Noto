import Foundation
import SwiftUI
import NotoCore

struct MarkdownPreviewView: View {
    @Environment(AppState.self) private var appState
    let file: VaultFile?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let file {
                    Text(file.title)
                        .font(.system(size: 30, weight: .bold))
                        .foregroundStyle(NotoDesign.ink)
                        .padding(.bottom, 4)

                    ForEach(renderLines(file.content)) { line in
                        render(line)
                    }
                } else {
                    Text("No note selected.")
                        .foregroundStyle(NotoDesign.muted)
                }
            }
            .frame(maxWidth: 760, alignment: .leading)
            .padding(.horizontal, 38)
            .padding(.vertical, 30)
        }
    }

    private func render(_ line: RenderLine) -> some View {
        Group {
            switch line.kind {
            case .heading(let level, let text):
                Text(text)
                    .font(.system(size: level == 1 ? 24 : 17, weight: .semibold))
                    .foregroundStyle(NotoDesign.ink)
                    .padding(.top, level == 1 ? 4 : 8)
            case .bullet(let text):
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("-")
                        .foregroundStyle(NotoDesign.muted)
                    linkedText(text)
                }
            case .checkbox(let text, let checked):
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: checked ? "checkmark.square.fill" : "square")
                        .foregroundStyle(checked ? NotoDesign.accent : NotoDesign.muted)
                    linkedText(text)
                }
            case .callout(let text):
                linkedText(text)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(NotoDesign.accent.opacity(0.08))
                    }
                    .overlay(alignment: .leading) {
                        Rectangle()
                            .fill(NotoDesign.accent)
                            .frame(width: 3)
                    }
            case .paragraph(let text):
                linkedText(text)
            case .blank:
                Spacer()
                    .frame(height: 4)
            }
        }
    }

    private func linkedText(_ text: String) -> some View {
        FlowLayout(spacing: 5) {
            ForEach(LinkSegment.segments(from: text)) { segment in
                switch segment.kind {
                case .plain:
                    Text(segment.text)
                        .font(.system(size: 14))
                        .foregroundStyle(NotoDesign.ink)
                case .wiki:
                    Button {
                        openWikiLink(segment.text)
                    } label: {
                        Text("[[\(segment.text)]]")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(NotoDesign.accent)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background {
                                Capsule()
                                    .fill(NotoDesign.accent.opacity(0.10))
                            }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func openWikiLink(_ title: String) {
        guard let id = appState.store.metadata.fileIdByTitle[title] else {
            return
        }

        appState.selectFile(id: id)
    }

    private func renderLines(_ content: String) -> [RenderLine] {
        content
            .split(separator: "\n", omittingEmptySubsequences: false)
            .enumerated()
            .map { index, line in
                RenderLine(index: index, raw: String(line))
            }
    }
}

struct RenderLine: Identifiable {
    let id: Int
    let kind: Kind

    init(index: Int, raw: String) {
        id = index
        let text = raw.trimmingCharacters(in: .whitespaces)

        if text.isEmpty {
            kind = .blank
        } else if let heading = Self.heading(from: text) {
            kind = .heading(level: heading.level, text: heading.text)
        } else if text.hasPrefix("- [ ] ") {
            kind = .checkbox(text: String(text.dropFirst(6)), checked: false)
        } else if text.hasPrefix("- [x] ") || text.hasPrefix("- [X] ") {
            kind = .checkbox(text: String(text.dropFirst(6)), checked: true)
        } else if text.hasPrefix("- ") {
            kind = .bullet(text: String(text.dropFirst(2)))
        } else if text.hasPrefix(">") {
            kind = .callout(text: text.dropFirst().trimmingCharacters(in: .whitespaces))
        } else {
            kind = .paragraph(text: text)
        }
    }

    private static func heading(from text: String) -> (level: Int, text: String)? {
        var level = 0
        for character in text {
            if character == "#" {
                level += 1
            } else {
                break
            }
        }

        guard (1...6).contains(level) else {
            return nil
        }

        let contentStart = text.index(text.startIndex, offsetBy: level)
        guard contentStart < text.endIndex, text[contentStart].isWhitespace else {
            return nil
        }

        let value = text[contentStart...].trimmingCharacters(in: .whitespaces)
        return value.isEmpty ? nil : (level, value)
    }

    enum Kind {
        case heading(level: Int, text: String)
        case bullet(text: String)
        case checkbox(text: String, checked: Bool)
        case callout(text: String)
        case paragraph(text: String)
        case blank
    }
}

struct LinkSegment: Identifiable {
    let id: String
    let text: String
    let kind: Kind

    enum Kind {
        case plain
        case wiki
    }

    static func segments(from text: String) -> [LinkSegment] {
        let pattern = #"\[\[([^\[\]]+)\]\]"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return [LinkSegment(id: "plain-\(text)", text: text, kind: .plain)]
        }

        let nsRange = NSRange(text.startIndex..<text.endIndex, in: text)
        var result: [LinkSegment] = []
        var cursor = text.startIndex

        for match in regex.matches(in: text, range: nsRange) {
            guard let fullRange = Range(match.range(at: 0), in: text),
                  let titleRange = Range(match.range(at: 1), in: text) else {
                continue
            }

            if cursor < fullRange.lowerBound {
                let plain = String(text[cursor..<fullRange.lowerBound])
                result.append(LinkSegment(id: "plain-\(result.count)-\(plain)", text: plain, kind: .plain))
            }

            let title = String(text[titleRange])
            result.append(LinkSegment(id: "wiki-\(result.count)-\(title)", text: title, kind: .wiki))
            cursor = fullRange.upperBound
        }

        if cursor < text.endIndex {
            let plain = String(text[cursor..<text.endIndex])
            result.append(LinkSegment(id: "plain-\(result.count)-\(plain)", text: plain, kind: .plain))
        }

        return result
    }
}

struct FlowLayout: Layout {
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        let rows = rows(in: maxWidth, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.reduce(CGFloat.zero) { partial, row in
            partial + row.height
        } + CGFloat(max(rows.count - 1, 0)) * spacing

        return CGSize(width: min(width, maxWidth), height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = rows(in: bounds.width, subviews: subviews)
        var y = bounds.minY

        for row in rows {
            var x = bounds.minX

            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(
                    at: CGPoint(x: x, y: y + (row.height - size.height) / 2),
                    proposal: ProposedViewSize(size)
                )
                x += size.width + spacing
            }

            y += row.height + spacing
        }
    }

    private func rows(in maxWidth: CGFloat, subviews: Subviews) -> [FlowRow] {
        var rows: [FlowRow] = []
        var current = FlowRow()

        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let candidateWidth = current.indices.isEmpty ? size.width : current.width + spacing + size.width

            if candidateWidth > maxWidth, !current.indices.isEmpty {
                rows.append(current)
                current = FlowRow()
            }

            current.indices.append(index)
            current.width = current.width == 0 ? size.width : current.width + spacing + size.width
            current.height = max(current.height, size.height)
        }

        if !current.indices.isEmpty {
            rows.append(current)
        }

        return rows
    }

    private struct FlowRow {
        var indices: [Subviews.Index] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }
}
