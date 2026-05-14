import SwiftUI

struct TitleBarView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        HStack(spacing: 8) {
            trafficLight(.red)
            trafficLight(.yellow)
            trafficLight(.green)

            VStack(alignment: .leading, spacing: 1) {
                Text("Noto")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(NotoDesign.ink)
                Text(appState.slogan)
                    .font(.system(size: 10))
                    .foregroundStyle(NotoDesign.muted)
            }
            .padding(.leading, 16)

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
        .padding(.horizontal, 14)
        .frame(height: 48)
        .background(.ultraThinMaterial)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(NotoDesign.line)
                .frame(height: 1)
        }
    }

    private func trafficLight(_ color: Color) -> some View {
        Circle()
            .fill(color)
            .frame(width: 12, height: 12)
            .overlay {
                Circle()
                    .stroke(Color.black.opacity(0.08), lineWidth: 0.5)
            }
    }
}
