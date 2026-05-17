import Foundation
import SwiftUI

struct AppUpdateResult: Equatable {
    let packageRoot: URL
    let output: String
}

enum AppUpdateError: Error, LocalizedError {
    case packageRootMissing
    case executableMissing
    case buildFailed(String)
    case relaunchFailed(String)

    var errorDescription: String? {
        switch self {
        case .packageRootMissing:
            return "Package.swift could not be found."
        case .executableMissing:
            return "The running app executable could not be found."
        case .buildFailed(let output):
            return output.isEmpty ? "swift build failed." : output
        case .relaunchFailed(let message):
            return message
        }
    }
}

enum AppUpdateService {
    static func rebuildAndRelaunch() async throws -> AppUpdateResult {
        let root = try packageRoot()
        let output = try await runSwiftBuild(in: root)
        try await MainActor.run {
            try relaunchCurrentExecutable()
        }
        return AppUpdateResult(packageRoot: root, output: output)
    }

    private static func packageRoot() throws -> URL {
        let fileManager = FileManager.default
        var candidates: [URL] = [URL(fileURLWithPath: fileManager.currentDirectoryPath)]

        if let executableURL = Bundle.main.executableURL {
            candidates.append(executableURL.deletingLastPathComponent())
        }

        for candidate in candidates {
            var current = candidate.standardizedFileURL

            while current.path != current.deletingLastPathComponent().path {
                if fileManager.fileExists(atPath: current.appendingPathComponent("Package.swift").path) {
                    return current
                }

                current.deleteLastPathComponent()
            }
        }

        throw AppUpdateError.packageRootMissing
    }

    private static func runSwiftBuild(in root: URL) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                let outputPipe = Pipe()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/swift")
                process.arguments = ["build"]
                process.currentDirectoryURL = root
                process.standardOutput = outputPipe
                process.standardError = outputPipe

                do {
                    try process.run()
                    process.waitUntilExit()

                    let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
                    let output = String(data: data, encoding: .utf8) ?? ""

                    if process.terminationStatus == 0 {
                        continuation.resume(returning: output)
                    } else {
                        continuation.resume(throwing: AppUpdateError.buildFailed(output))
                    }
                } catch {
                    continuation.resume(throwing: AppUpdateError.buildFailed(error.localizedDescription))
                }
            }
        }
    }

    @MainActor
    private static func relaunchCurrentExecutable() throws {
        guard let executableURL = Bundle.main.executableURL else {
            throw AppUpdateError.executableMissing
        }

        let process = Process()
        process.executableURL = executableURL

        do {
            try process.run()
        } catch {
            throw AppUpdateError.relaunchFailed(error.localizedDescription)
        }

        NSApp.terminate(nil)
    }
}
