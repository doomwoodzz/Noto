import SwiftUI

@main
struct NotoApp: App {
    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            MacWindowView()
                .environment(appState)
                .frame(minWidth: 1320, minHeight: 840)
                .tint(NotoDesign.accent)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        .defaultSize(width: 1440, height: 900)
        .commands {
            CommandMenu("Noto") {
                Button("Command Palette") {
                    appState.toggleCommandPalette()
                }
                .keyboardShortcut("k", modifiers: .command)

                Button("AI Recorder") {
                    appState.toggleRecorder()
                }
                .keyboardShortcut("m", modifiers: [.command, .control])
            }
        }
    }
}
