// swift-tools-version: 6.0
import PackageDescription

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
            path: "Tests/NotoCoreTests"
        )
    ]
)
