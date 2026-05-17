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
                appState.toggleRightSidebar()
            } label: {
                Image(systemName: appState.isRightSidebarPresented ? "sidebar.right" : "sidebar.right")
                    .font(.system(size: 13, weight: .medium))
                    .frame(width: 16, height: 16)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .help(appState.isRightSidebarPresented ? "Hide context sidebar" : "Show context sidebar")

            Button {
                appState.updateAppFromCodeChanges()
            } label: {
                if appState.updateStatus.isUpdating {
                    ProgressView()
                        .controlSize(.small)
                        .frame(width: 16, height: 16)
                } else {
                    Label(appState.updateStatus.label, systemImage: "arrow.trianglehead.2.clockwise")
                        .font(.system(size: 12, weight: .medium))
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(appState.updateStatus.isUpdating)
            .help(updateHelpText)

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

    private var updateHelpText: String {
        switch appState.updateStatus {
        case .idle:
            return "Rebuild and relaunch Noto from the latest source code."
        case .updating:
            return "Building the latest source code."
        case .failed(let message):
            return message
        }
    }
}
