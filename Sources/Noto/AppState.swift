import Foundation
import Observation
import NotoCore

@Observable
@MainActor
final class AppState {
    var store = WorkspaceStore(vault: MockVault.school)
    var isCommandPalettePresented = false
    var isRecorderPresented = false
    var isRightSidebarPresented = true
    var updateStatus: AppUpdateStatus = .idle

    var slogan: String {
        "When you listen, Noto remembers"
    }

    func selectFile(id: String) {
        store.selectFile(id: id)
    }

    func openGraph(filter: GraphFilter = .all) {
        store.openGraph(filter: filter)
    }

    func toggleRecorder() {
        isRecorderPresented.toggle()
    }

    func toggleCommandPalette() {
        isCommandPalettePresented.toggle()
    }

    func toggleRightSidebar() {
        isRightSidebarPresented.toggle()
    }

    func startRecording() {
        store.recorder.start(now: Date())
    }

    func recorderTick() {
        store.recorder.tick()
    }

    func stopRecording() {
        store.stopRecordingAndAppendNotes(now: Date())
    }

    func finishRecordingProcessing() {
        let title = store.activeFile?.title ?? "Current Note"
        store.recorder.finishProcessing(targetNoteTitle: title)
    }

    func recordMore() {
        store.recorder.reset()
    }

    func createNewNote() {
        store.createNewNote(now: Date())
    }

    func updateActiveFileContent(_ content: String) {
        store.updateActiveFileContent(content, now: Date())
    }

    func updateAppFromCodeChanges() {
        guard !updateStatus.isUpdating else {
            return
        }

        updateStatus = .updating

        Task { @MainActor [weak self] in
            do {
                _ = try await AppUpdateService.rebuildAndRelaunch()
            } catch {
                self?.updateStatus = .failed(error.localizedDescription)
            }
        }
    }
}

enum AppUpdateStatus: Equatable {
    case idle
    case updating
    case failed(String)

    var isUpdating: Bool {
        if case .updating = self {
            return true
        }

        return false
    }

    var label: String {
        switch self {
        case .idle:
            return "Update"
        case .updating:
            return "Updating"
        case .failed:
            return "Retry"
        }
    }
}
