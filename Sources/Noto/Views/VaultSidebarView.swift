import SwiftUI
import NotoCore

struct VaultSidebarView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState

        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(appState.store.vault.name)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(NotoDesign.ink)
                    Text("Local Markdown Vault")
                        .font(.system(size: 13))
                        .foregroundStyle(NotoDesign.muted)
                }

                Spacer()
            }

            TextField("Search notes", text: $appState.store.searchQuery)
                .textFieldStyle(.plain)
                .font(.system(size: 15))
                .foregroundStyle(NotoDesign.ink)
                .padding(.horizontal, 12)
                .frame(height: 38)
                .background {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(NotoDesign.field)
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
                    .font(.system(size: 14, weight: .medium))
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
        .padding(20)
        .background(NotoDesign.sidebar)
        .overlay(alignment: .trailing) {
            Rectangle()
                .fill(NotoDesign.line)
                .frame(width: 1)
        }
    }
}
