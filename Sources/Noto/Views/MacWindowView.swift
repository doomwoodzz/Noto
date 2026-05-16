import SwiftUI

struct MacWindowView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            NotoDesign.background
            .ignoresSafeArea()

            VStack(spacing: 0) {
                TitleBarView()

                HStack(spacing: 0) {
                    VaultSidebarView()
                        .frame(width: 300)
                    MarkdownWorkspaceView()
                    RightContextPanelView()
                        .frame(width: 340)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if appState.isRecorderPresented {
                AIRecorderPanelView()
                    .padding(.trailing, 34)
                    .padding(.bottom, 34)
                    .transition(.scale(scale: 0.92).combined(with: .opacity))
            }
        }
        .overlay {
            if appState.isCommandPalettePresented {
                CommandPaletteView()
                    .transition(.scale(scale: 0.96).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.86), value: appState.isRecorderPresented)
        .animation(.spring(response: 0.22, dampingFraction: 0.88), value: appState.isCommandPalettePresented)
        .preferredColorScheme(.dark)
        .focusable()
        .onKeyPress("k", phases: .down) { press in
            guard press.modifiers.contains(.command) else {
                return .ignored
            }

            appState.toggleCommandPalette()
            return .handled
        }
        .onKeyPress("m", phases: .down) { press in
            guard press.modifiers.contains(.command), press.modifiers.contains(.control) else {
                return .ignored
            }

            appState.toggleRecorder()
            return .handled
        }
    }
}
