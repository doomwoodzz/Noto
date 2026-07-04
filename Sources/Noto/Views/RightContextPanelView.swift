import SwiftUI
import NotoCore

struct RightContextPanelView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        let file = appState.store.activeFile
        let metadata = file.flatMap { appState.store.metadata.filesById[$0.id] }

        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                metadataSection(metadata)
                outlineSection(metadata)
                backlinksSection(metadata)
                outgoingSection(metadata)
                aiMemorySection(appState.store.recorder.memory)
            }
            .padding(20)
        }
        .background(NotoDesign.sidebar)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(NotoDesign.line)
                .frame(width: 1)
        }
    }

    private func metadataSection(_ metadata: FileMetadata?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(title: "Metadata")
            Text(metadata?.path ?? "No active note")
                .font(.system(size: 12))
                .foregroundStyle(NotoDesign.muted)
                .lineLimit(2)

            if let updatedAt = metadata?.updatedAt {
                Text("Edited \(updatedAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.system(size: 11))
                    .foregroundStyle(NotoDesign.muted)
            }

            HStack(spacing: 8) {
                stat("Words", "\(metadata?.wordCount ?? 0)")
                stat("Backlinks", "\(metadata?.backlinks.count ?? 0)")
                stat("Links", "\(metadata?.outgoingLinks.count ?? 0)")
            }
        }
    }

    private func outlineSection(_ metadata: FileMetadata?) -> some View {
        panel(title: "Outline", empty: "No headings yet.", values: metadata?.headings ?? [])
    }

    private func backlinksSection(_ metadata: FileMetadata?) -> some View {
        panel(title: "Backlinks", empty: "No backlinks yet.", values: metadata?.backlinks ?? [])
    }

    private func outgoingSection(_ metadata: FileMetadata?) -> some View {
        panel(title: "Outgoing Links", empty: "No outgoing links.", values: metadata?.outgoingLinks ?? [])
    }

    private func aiMemorySection(_ memory: LectureMemory) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(title: "AI Memory")

            if memory.concepts.isEmpty &&
                memory.definitions.isEmpty &&
                memory.importantPoints.isEmpty &&
                memory.possibleQuestions.isEmpty &&
                memory.linkedNotes.isEmpty {
                Text("Visible after you press Record.")
                    .font(.system(size: 13))
                    .foregroundStyle(NotoDesign.muted)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(memoryCardBackground)
            } else {
                memoryGroup("Concepts", values: memory.concepts)
                memoryGroup("Definitions", values: memory.definitions.map { "\($0.term): \($0.definition)" })
                memoryGroup("Teacher Emphasis", values: memory.importantPoints)
                memoryGroup("Possible Questions", values: memory.possibleQuestions)
                memoryGroup("Linked Notes", values: memory.linkedNotes.map { "[[\($0)]]" })
            }
        }
    }

    private func memoryGroup(_ title: String, values: [String]) -> some View {
        Group {
            if !values.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(NotoDesign.muted)

                    ForEach(values, id: \.self) { value in
                        Text(value)
                            .font(.system(size: 13))
                            .foregroundStyle(NotoDesign.ink)
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(memoryCardBackground)
                    }
                }
            }
        }
    }

    private func panel(title: String, empty: String, values: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(title: title)

            if values.isEmpty {
                Text(empty)
                    .font(.system(size: 13))
                    .foregroundStyle(NotoDesign.muted)
            } else {
                ForEach(values, id: \.self) { value in
                    Text(value)
                        .font(.system(size: 13))
                        .foregroundStyle(NotoDesign.ink)
                        .lineLimit(2)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(NotoDesign.card)
                        }
                }
            }
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(NotoDesign.muted)
            Text(value)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(NotoDesign.ink)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(NotoDesign.card)
        }
    }

    private var memoryCardBackground: some View {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(NotoDesign.card)
    }
}
