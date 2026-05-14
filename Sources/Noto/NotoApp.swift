import SwiftUI

@main
struct NotoApp: App {
    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            MacWindowView()
                .environment(appState)
                .frame(minWidth: 1180, minHeight: 760)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
    }
}
