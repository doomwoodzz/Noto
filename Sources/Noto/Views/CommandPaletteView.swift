import SwiftUI
import NotoCore

struct CommandPaletteView: View {
    @Environment(AppState.self) private var appState
    @State private var query = ""

    private var commands: [PaletteCommand] {
        [
            PaletteCommand(title: "New Note", icon: "square.and.pencil") {
                appState.createNewNote()
                close()
            },
            PaletteCommand(title: "Open Knowledge Web", icon: "point.3.connected.trianglepath.dotted") {
                appState.openGraph(filter: .all)
                close()
            },
            PaletteCommand(title: "Toggle AI Recorder", icon: "mic.circle") {
                appState.toggleRecorder()
                close()
            },
            PaletteCommand(title: "Search Notes", icon: "magnifyingglass") {
                close()
            },
            PaletteCommand(title: "Insert Backlink", icon: "link") {
                guard let active = appState.store.activeFile else {
                    close()
                    return
                }

                let updated = NoteActions.insertBacklink("Photosynthesis", into: active, now: Date())
                appState.store.replaceFile(updated)
                close()
            },
            PaletteCommand(title: "Create Lecture Note", icon: "waveform") {
                let title = "Biology Lecture - May 13"
                if let existing = appState.store.vault.files.first(where: { $0.title == title }) {
                    appState.store.selectFile(id: existing.id)
                    close()
                    return
                }

                let note = NoteActions.createLectureNote(title: title, now: Date())
                let files = appState.store.vault.files + [note]
                appState.store.vault = Vault(id: appState.store.vault.id, name: appState.store.vault.name, files: files)
                appState.store.selectFile(id: note.id)
                close()
            },
            PaletteCommand(title: "Show Local Graph", icon: "scope") {
                appState.openGraph(filter: .local)
                close()
            }
        ]
    }

    private var filteredCommands: [PaletteCommand] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return commands
        }

        return commands.filter { $0.title.localizedCaseInsensitiveContains(trimmed) }
    }

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                Image(systemName: "command")
                    .foregroundStyle(NotoDesign.muted)
                TextField("Search commands", text: $query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 15))
                    .foregroundStyle(NotoDesign.ink)
            }
            .padding(12)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(NotoDesign.field)
            }

            VStack(spacing: 4) {
                ForEach(filteredCommands) { command in
                    Button {
                        command.action()
                    } label: {
                        HStack {
                            Image(systemName: command.icon)
                                .frame(width: 22)
                            Text(command.title)
                                .foregroundStyle(NotoDesign.ink)
                            Spacer()
                        }
                        .font(.system(size: 13))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .background {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(Color.clear)
                    }
                }
            }
        }
        .padding(12)
        .frame(width: 460)
        .background(NotoDesign.glassBackground(cornerRadius: 18))
        .shadow(color: Color.black.opacity(0.20), radius: 34, x: 0, y: 22)
    }

    private func close() {
        appState.isCommandPalettePresented = false
    }
}

struct PaletteCommand: Identifiable {
    var id: String { title }

    let title: String
    let icon: String
    let action: () -> Void
}
