import NotoCore

enum AppStateBehaviorChecks {
    static func run() throws {
        try selectingFileChangesActiveFile()
        try selectingMissingFileLeavesActiveFileUnchanged()
        try appendingAINotesUpdatesMetadataAndGraph()
        try createNewNoteAddsFileAndSelectsIt()
        try openGraphUsesRequestedFilter()
        try searchQueryFiltersFilesByTitleAndPath()
    }

    private static func selectingFileChangesActiveFile() throws {
        var store = WorkspaceStore(vault: MockVault.school)
        store.selectFile(id: "history-cold-war")

        try expect(store.activeFile?.title == "Cold War", "Selecting a file should update activeFile")
        try expect(store.activeTab == .note, "Selecting a file should return to the note tab")
    }

    private static func selectingMissingFileLeavesActiveFileUnchanged() throws {
        var store = WorkspaceStore(vault: MockVault.school)
        let originalActiveFileId = store.activeFileId

        store.selectFile(id: "missing")

        try expect(store.activeFileId == originalActiveFileId, "Selecting a missing file should be ignored")
    }

    private static func appendingAINotesUpdatesMetadataAndGraph() throws {
        var store = WorkspaceStore(vault: MockVault.school)
        store.selectFile(id: "history-cold-war")
        store.recorder.start(now: MockVault.baseDate)
        store.recorder.tick()
        store.stopRecordingAndAppendNotes(now: MockVault.baseDate.addingTimeInterval(120))

        let active = try required(store.activeFile, "Active file should exist")
        let metadata = try required(store.metadata.filesById[active.id], "Active metadata should exist")

        try expect(active.content.contains("## AI Lecture Notes"), "Stopping recording should append AI notes")
        try expect(metadata.outgoingLinks.contains("Chloroplast"), "Metadata should update after AI notes append")
        try expect(metadata.headings.contains("AI Lecture Notes"), "Metadata headings should include appended AI section")
        try expect(
            store.graph.edges.contains { $0.source == active.id && $0.target == "biology-chloroplast" },
            "Graph should update after AI notes append"
        )
    }

    private static func createNewNoteAddsFileAndSelectsIt() throws {
        var store = WorkspaceStore(vault: MockVault.school)

        store.createNewNote(now: MockVault.baseDate)

        try expect(store.activeFile?.title == "Untitled 1", "New note should become active")
        try expect(store.activeFile?.path == "AI Lecture Notes/Untitled 1.md", "New note should use lecture notes folder")
        try expect(store.vault.files.count == MockVault.school.files.count + 1, "New note should be added to vault")
    }

    private static func openGraphUsesRequestedFilter() throws {
        var store = WorkspaceStore(vault: MockVault.school)

        store.openGraph(filter: .local)

        try expect(store.activeTab == .graph, "Opening graph should select graph tab")
        try expect(store.graphFilter == .local, "Opening graph should store requested filter")
        try expect(store.visibleGraph.nodes.count < store.graph.nodes.count, "Local visible graph should be filtered")
    }

    private static func searchQueryFiltersFilesByTitleAndPath() throws {
        var store = WorkspaceStore(vault: MockVault.school)
        store.searchQuery = "history"

        try expect(
            store.filteredFiles.map(\.title) == ["Cold War", "Industrial Revolution"],
            "Search should filter files by title and path"
        )
    }

    private static func required<T>(_ value: T?, _ message: String) throws -> T {
        guard let value else {
            throw CheckFailure(message: message)
        }

        return value
    }
}
