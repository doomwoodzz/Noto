import SwiftUI

struct MacWindowView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            LinearGradient(
                colors: [
                    Color(red: 0.88, green: 0.90, blue: 0.94),
                    Color(red: 0.97, green: 0.98, blue: 0.99)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                TitleBarView()

                HStack(spacing: 0) {
                    VaultSidebarView()
                        .frame(width: 246)
                    MarkdownWorkspaceView()
                    RightContextPanelView()
                        .frame(width: 286)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(Color.black.opacity(0.10), lineWidth: 1)
            }
            .shadow(color: Color.black.opacity(0.18), radius: 40, x: 0, y: 24)
            .padding(28)

            if appState.isRecorderPresented {
                AIRecorderPanelView()
                    .padding(.trailing, 70)
                    .padding(.bottom, 68)
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

struct AIRecorderPanelView: View {
    var body: some View {
        EmptyView()
    }
}

struct CommandPaletteView: View {
    var body: some View {
        EmptyView()
    }
}
