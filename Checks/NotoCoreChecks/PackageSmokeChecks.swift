import NotoCore

enum PackageSmokeChecks {
    static func run() throws {
        try expect(NotoCore.moduleName == "NotoCore", "NotoCore module name should be available")
    }
}
