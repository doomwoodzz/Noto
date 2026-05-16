import SwiftUI

struct TitleBarView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text("Noto")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(NotoDesign.ink)
                Text(appState.slogan)
                    .font(.system(size: 12))
                    .foregroundStyle(NotoDesign.muted)
            }

            Spacer()

            Button {
                appState.toggleCommandPalette()
            } label: {
                Label("Command", systemImage: "command")
                    .font(.system(size: 12, weight: .medium))
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .help("Open Command Palette")
        }
        .padding(.leading, 84)
        .padding(.trailing, 22)
        .frame(height: 64)
        .background(NotoDesign.panel)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(NotoDesign.line)
                .frame(height: 1)
        }
    }
}
