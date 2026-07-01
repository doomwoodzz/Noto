import Testing
@testable import NotoCore

@Test func coreModuleLoads() {
    #expect(NotoCore.moduleName == "NotoCore")
}
