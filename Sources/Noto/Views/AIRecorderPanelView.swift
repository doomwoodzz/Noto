import SwiftUI
import NotoCore

struct AIRecorderPanelView: View {
    @Environment(AppState.self) private var appState
    @State private var timerTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 14) {
            phaseHeader

            AudioWaveformView(isAnimating: appState.store.recorder.phase.isRecording)
                .opacity(appState.store.recorder.phase.isRecording ? 1 : 0.45)

            phaseBody

            Text("Recording only starts when you press Record.")
                .font(.system(size: 10))
                .foregroundStyle(NotoDesign.muted)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(width: 340, height: 300)
        .background(NotoDesign.glassBackground(cornerRadius: 42))
        .shadow(color: Color.black.opacity(0.22), radius: 34, x: 0, y: 22)
        .onDisappear {
            stopTimer()
        }
    }

    private var phaseHeader: some View {
        VStack(spacing: 5) {
            HStack(spacing: 6) {
                if appState.store.recorder.phase.isRecording {
                    Circle()
                        .fill(NotoDesign.recorderRed)
                        .frame(width: 8, height: 8)
                }

                Text("Lecture AI")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(NotoDesign.ink)
            }

            Text(statusText)
                .font(.system(size: 12))
                .foregroundStyle(NotoDesign.muted)
        }
    }

    private var phaseBody: some View {
        VStack(spacing: 10) {
            switch appState.store.recorder.phase {
            case .idle:
                Button {
                    appState.startRecording()
                    startTimer()
                } label: {
                    Label("Record", systemImage: "mic.fill")
                        .frame(width: 118)
                }
                .buttonStyle(.borderedProminent)

            case .recording:
                Text(timerText)
                    .font(.system(size: 18, weight: .semibold, design: .monospaced))
                    .foregroundStyle(NotoDesign.ink)

                Button {
                    stopTimer()
                    appState.stopRecording()
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                        .frame(width: 112)
                }
                .buttonStyle(.bordered)

            case .processing:
                ProgressView()
                    .controlSize(.small)
                    .onAppear {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                            appState.finishRecordingProcessing()
                        }
                    }

            case .complete:
                HStack(spacing: 8) {
                    Button("Open note") {
                        appState.store.activeTab = .note
                    }
                    Button("Record more") {
                        appState.recordMore()
                    }
                }
                .controlSize(.small)
            }

            if !appState.store.recorder.memory.concepts.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(appState.store.recorder.memory.concepts.suffix(3), id: \.self) { concept in
                        Text("- \(concept)")
                            .font(.system(size: 11))
                            .foregroundStyle(NotoDesign.ink)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var statusText: String {
        switch appState.store.recorder.phase {
        case .idle:
            return "Ready to listen when you start."
        case .recording:
            return "Listening to lecture..."
        case .processing:
            return "Organizing notes..."
        case .complete(let title):
            return "Notes added to \(title)"
        }
    }

    private var timerText: String {
        let seconds = appState.store.recorder.elapsedSeconds
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }

    private func startTimer() {
        stopTimer()
        timerTask = Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                guard !Task.isCancelled else {
                    return
                }
                appState.recorderTick()
            }
        }
    }

    private func stopTimer() {
        timerTask?.cancel()
        timerTask = nil
    }
}
