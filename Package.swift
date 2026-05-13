// swift-tools-version: 6.3
import PackageDescription

let commandLineToolsDeveloperFrameworks = "/Library/Developer/CommandLineTools/Library/Developer/Frameworks"
let commandLineToolsDeveloperLibraries = "/Library/Developer/CommandLineTools/Library/Developer/usr/lib"

let package = Package(
    name: "Noto",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "Noto", targets: ["Noto"]),
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
