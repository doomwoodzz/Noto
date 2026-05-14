import SwiftUI
import NotoCore

struct VaultSidebarView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState

        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(appState.store.vault.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(NotoDesign.ink)
                    Text("Local Markdown Vault")
                        .font(.system(size: 11))
                        .foregroundStyle(NotoDesign.muted)
                }

                Spacer()
            }

            TextField("Search notes", text: $appState.store.searchQuery)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .padding(.horizontal, 10)
                .frame(height: 30)
                .background {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.white.opacity(0.80))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(NotoDesign.line, lineWidth: 1)
                }

            Button {
                appState.createNewNote()
            } label: {
                Label("New Note", systemImage: "square.and.pencil")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)

            Button {
                appState.openGraph(filter: .all)
            } label: {
                Label("Knowledge Web", systemImage: "point.3.connected.trianglepath.dotted")
                    .font(.system(size: 12, weight: .medium))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .foregroundStyle(NotoDesign.accent)

            ScrollView {
                FileTreeView(files: appState.store.filteredFiles)
                    .padding(.top, 2)
            }
            .scrollIndicators(.hidden)

            Spacer(minLength: 0)
        }
        .padding(16)
        .background(.ultraThinMaterial)
        .overlay(alignment: .trailing) {
            Rectangle()
                .fill(NotoDesign.line)
                .frame(width: 1)
        }
    }
}
