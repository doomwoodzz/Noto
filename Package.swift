// swift-tools-version: 6.3
import PackageDescription

// CommandLineTools on this machine provides Swift Testing but not XCTest.
// Keep these absolute framework paths scoped to the test target only.
let commandLineToolsDeveloperFrameworks = "/Library/Developer/CommandLineTools/Library/Developer/Frameworks"
let commandLineToolsDeveloperLibraries = "/Library/Developer/CommandLineTools/Library/Developer/usr/lib"

let package = Package(
    name: "Noto",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "Noto", targets: ["Noto"]),
        .executable(name: "NotoCoreChecks", targets: ["NotoCoreChecks"]),
        .library(name: "NotoCore", targets: ["NotoCore"])
    ],
    targets: [
        .target(
            name: "NotoCore",
            path: "Sources/NotoCore"
        ),
        .executableTarget(
            name: "Noto",
            dependencies: ["NotoCore"],
            path: "Sources/Noto"
        ),
        .executableTarget(
            name: "NotoCoreChecks",
            dependencies: ["NotoCore"],
            path: "Checks/NotoCoreChecks"
        ),
        .testTarget(
            name: "NotoCoreTests",
            dependencies: ["NotoCore"],
            path: "Tests/NotoCoreTests",
            swiftSettings: [
                .unsafeFlags(["-F", commandLineToolsDeveloperFrameworks])
            ],
            linkerSettings: [
                .unsafeFlags([
                    "-F", commandLineToolsDeveloperFrameworks,
                    "-Xlinker", "-rpath",
                    "-Xlinker", commandLineToolsDeveloperFrameworks,
                    "-Xlinker", "-rpath",
                    "-Xlinker", commandLineToolsDeveloperLibraries
                ])
            ]
        )
    ],
    swiftLanguageModes: [.v6]
)
