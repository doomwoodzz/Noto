import XCTest
@testable import NotoCore

final class PackageSmokeTests: XCTestCase {
    func testCoreModuleLoads() {
        XCTAssertEqual(NotoCore.moduleName, "NotoCore")
    }
}
