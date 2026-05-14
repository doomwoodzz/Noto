import Foundation

public struct WorkspaceStore: Equatable {
    public var vault: Vault
    public var activeFileId: String
    public var activeTab: WorkspaceTab
    public var graphFilter: GraphFilter
    public var searchQuery: String
    public var recorder: AIRecorderModel

    public init(vault: Vault) {
        self.vault = vault
        self.activeFileId = vault.files.first?.id ?? ""
        self.activeTab = .note
        self.graphFilter = .all
        self.searchQuery = ""
        self.recorder = AIRecorderModel()
    }

    public var activeFile: VaultFile? {
        vault.files.first { $0.id == activeFileId }
    }

    public var metadata: MetadataCache {
        MetadataCacheBuilder.build(files: vault.files)
    }

    public var graph: KnowledgeGraph {
        GraphBuilder.build(files: vault.files, cache: metadata)
    }

    public var visibleGraph: KnowledgeGraph {
        GraphBuilder.filter(graph: graph, mode: graphFilter, activeFileId: activeFileId)
    }

    public var filteredFiles: [VaultFile] {
        let trimmed = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return vault.files
        }

        return vault.files.filter {
            $0.title.localizedCaseInsensitiveContains(trimmed) ||
            $0.path.localizedCaseInsensitiveContains(trimmed)
        }
    }

    public mutating func selectFile(id: String) {
        guard vault.files.contains(where: { $0.id == id }) else {
            return
        }

        activeFileId = id
        activeTab = .note
    }

    public mutating func openGraph(filter: GraphFilter = .all) {
        graphFilter = filter
        activeTab = .graph
    }

    public mutating func createNewNote(now: Date) {
        let count = vault.files.filter { $0.path.hasPrefix("AI Lecture Notes/Untitled") }.count + 1
        let title = "Untitled \(count)"
        let file = VaultFile(
            id: "untitled-\(count)",
            path: "AI Lecture Notes/\(title).md",
            title: title,
            content: "# \(title)\n\n",
            createdAt: now,
            updatedAt: now
        )

        replaceVaultFiles(vault.files + [file])
        activeFileId = file.id
        activeTab = .note
    }

    public mutating func stopRecordingAndAppendNotes(now: Date) {
        guard let file = activeFile, recorder.phase.isRecording else {
            return
        }

        recorder.stop(targetNoteTitle: file.title)
        let updated = NoteActions.appendAINotes(to: file, memory: recorder.memory, now: now)
        replaceFile(updated)
    }

    public mutating func replaceFile(_ file: VaultFile) {
        var files = vault.files
        guard let index = files.firstIndex(where: { $0.id == file.id }) else {
            return
        }

        files[index] = file
        replaceVaultFiles(files)
    }

    private mutating func replaceVaultFiles(_ files: [VaultFile]) {
        vault = Vault(id: vault.id, name: vault.name, files: files)
    }
}

public enum WorkspaceTab: String, Equatable {
    case note
    case graph
}
