import Foundation
import Observation
import NotoCore

@Observable
final class AppState {
    var store = WorkspaceStore(vault: MockVault.school)
    var isCommandPalettePresented = false
    var isRecorderPresented = false

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
}
