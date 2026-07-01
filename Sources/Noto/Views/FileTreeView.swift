import SwiftUI
import NotoCore

struct FileTreeView: View {
    @Environment(AppState.self) private var appState
    let files: [VaultFile]

    private let folderOrder = [
        "Biology",
        "History",
        "Mathematics",
        "Literature",
        "AI Lecture Notes"
    ]

    private var grouped: [(folder: String, files: [VaultFile])] {
        let groups = Dictionary(grouping: files) { file in
            file.path.components(separatedBy: "/").first ?? "Notes"
        }

        return groups.keys.sorted(by: sortFolders).map { key in
            (key, groups[key, default: []].sorted { $0.title < $1.title })
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if files.isEmpty {
                Text("No notes found.")
                    .font(.system(size: 13))
                    .foregroundStyle(NotoDesign.muted)
                    .padding(.vertical, 10)
            }

            ForEach(grouped, id: \.folder) { group in
                VStack(alignment: .leading, spacing: 7) {
                    Label(group.folder, systemImage: "folder")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(NotoDesign.muted)

                    ForEach(group.files) { file in
                        Button {
                            appState.selectFile(id: file.id)
                        } label: {
                            HStack(spacing: 7) {
                                Image(systemName: "doc.plaintext")
                                    .font(.system(size: 13))
                                    .frame(width: 16)
                                Text(file.title)
                                    .lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .font(.system(size: 14))
                            .padding(.vertical, 8)
                            .padding(.horizontal, 10)
                            .background(rowBackground(for: file))
                            .foregroundStyle(file.id == appState.store.activeFileId ? NotoDesign.accent : NotoDesign.ink)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func rowBackground(for file: VaultFile) -> some View {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(file.id == appState.store.activeFileId ? NotoDesign.accent.opacity(0.18) : Color.clear)
    }

    private func sortFolders(_ left: String, _ right: String) -> Bool {
        let leftIndex = folderOrder.firstIndex(of: left) ?? Int.max
        let rightIndex = folderOrder.firstIndex(of: right) ?? Int.max

        if leftIndex == rightIndex {
            return left < right
        }

        return leftIndex < rightIndex
    }
}
