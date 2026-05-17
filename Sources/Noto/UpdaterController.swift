import Foundation
import Observation
import Sparkle

@Observable
@MainActor
final class UpdaterController {
    private let sparkleController: SPUStandardUpdaterController?

    let isConfigured: Bool

    init(bundle: Bundle = .main) {
        isConfigured = Self.hasSparkleConfiguration(in: bundle)
        sparkleController = isConfigured
            ? SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
            : nil
    }

    var canCheckForUpdates: Bool {
        sparkleController?.updater.canCheckForUpdates ?? false
    }

    var buttonTitle: String {
        isConfigured ? "Check for Updates..." : "Updates Unconfigured"
    }

    var helpText: String {
        isConfigured
            ? "Check GitHub Releases for a newer Noto update."
            : "Sparkle update metadata is missing from this build. Package a release with SUFeedURL and SUPublicEDKey."
    }

    func checkForUpdates() {
        sparkleController?.checkForUpdates(nil)
    }

    private static func hasSparkleConfiguration(in bundle: Bundle) -> Bool {
        guard let feedURL = bundle.object(forInfoDictionaryKey: "SUFeedURL") as? String,
              let publicKey = bundle.object(forInfoDictionaryKey: "SUPublicEDKey") as? String else {
            return false
        }

        return feedURL.hasPrefix("https://") &&
            !publicKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            publicKey != "REPLACE_WITH_SPARKLE_PUBLIC_ED_KEY"
    }
}
