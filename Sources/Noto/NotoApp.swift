import SwiftUI

@main
struct NotoApp: App {
    var body: some Scene {
        WindowGroup {
            Text("Noto")
                .frame(width: 960, height: 640)
        }
        .windowStyle(.hiddenTitleBar)
    }
}
