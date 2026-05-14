import SwiftUI
import NotoCore

struct MarkdownWorkspaceView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                tab("Note", selected: appState.store.activeTab == .note) {
                    appState.store.activeTab = .note
                }
                tab("Knowledge Web", selected: appState.store.activeTab == .graph) {
                    appState.openGraph(filter: appState.store.graphFilter)
                }

                Spacer()
            }
            .padding(.horizontal, 18)
            .frame(height: 40)
            .background(Color.white.opacity(0.52))
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(NotoDesign.line)
                    .frame(height: 1)
            }

            if appState.store.activeTab == .note {
                MarkdownPreviewView(file: appState.store.activeFile)
            } else {
                KnowledgeGraphView()
            }
        }
        .background(NotoDesign.editor)
    }

    private func tab(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: selected ? .semibold : .regular))
                .foregroundStyle(selected ? NotoDesign.ink : NotoDesign.muted)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(selected ? Color.white : Color.clear)
                }
        }
        .buttonStyle(.plain)
    }
}
