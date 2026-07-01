import Testing
@testable import NotoCore

@Test func selectingFileChangesActiveFile() {
    var store = WorkspaceStore(vault: MockVault.school)
    store.selectFile(id: "history-cold-war")

    #expect(store.activeFile?.title == "Cold War")
    #expect(store.activeTab == .note)
}

@Test func selectingMissingFileLeavesActiveFileUnchanged() {
    var store = WorkspaceStore(vault: MockVault.school)
    let originalActiveFileId = store.activeFileId

    store.selectFile(id: "missing")

    #expect(store.activeFileId == originalActiveFileId)
}

@Test func appendingAINotesUpdatesMetadataAndGraph() throws {
    var store = WorkspaceStore(vault: MockVault.school)
    store.selectFile(id: "history-cold-war")
    store.recorder.start(now: MockVault.baseDate)
    store.recorder.tick()
    store.stopRecordingAndAppendNotes(now: MockVault.baseDate.addingTimeInterval(120))

    let active = try #require(store.activeFile)
    let metadata = try #require(store.metadata.filesById[active.id])

    #expect(active.content.contains("## AI Lecture Notes"))
    #expect(metadata.outgoingLinks.contains("Chloroplast"))
    #expect(metadata.headings.contains("AI Lecture Notes"))
    #expect(store.graph.edges.contains { $0.source == active.id && $0.target == "biology-chloroplast" })
}

@Test func createNewNoteAddsFileAndSelectsIt() {
    var store = WorkspaceStore(vault: MockVault.school)

    store.createNewNote(now: MockVault.baseDate)

    #expect(store.activeFile?.title == "Untitled 1")
    #expect(store.activeFile?.path == "AI Lecture Notes/Untitled 1.md")
    #expect(store.vault.files.count == MockVault.school.files.count + 1)
}

@Test func openGraphUsesRequestedFilter() {
    var store = WorkspaceStore(vault: MockVault.school)

    store.openGraph(filter: .local)

    #expect(store.activeTab == .graph)
    #expect(store.graphFilter == .local)
    #expect(store.visibleGraph.nodes.count < store.graph.nodes.count)
}

@Test func searchQueryFiltersFilesByTitleAndPath() {
    var store = WorkspaceStore(vault: MockVault.school)
    store.searchQuery = "history"

    #expect(store.filteredFiles.map(\.title) == ["Cold War", "Industrial Revolution"])
}
