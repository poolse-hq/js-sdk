import XCTest
@testable import PoolseCallCore

final class CallServersTests: XCTestCase {
  private let a = CallServer(id: "default", apiBaseUrl: "https://a.example", tenantId: "ta", name: "Acme")
  private let b = CallServer(id: "beta", apiBaseUrl: "https://b.example", tenantId: "tb", name: "Beta Corp")

  func testAPushFindsTheServerOfItsTenant() {
    let s = CallServers([a, b])
    XCTAssertEqual(s.resolve(tenantId: "tb")?.id, "beta")
    XCTAssertEqual(s.resolve(tenantId: "ta")?.id, "default")
  }

  func testAPushWithoutAKnownTenantStillRings() {
    XCTAssertEqual(CallServers([b]).resolve(tenantId: "unknown")?.id, "beta", "the only server")
    XCTAssertEqual(CallServers([a, b]).resolve(tenantId: nil)?.id, "default")
    let untagged = CallServer(id: "c", apiBaseUrl: "https://c.example")
    XCTAssertEqual(CallServers([b, untagged]).resolve(tenantId: "unknown")?.id, "c", "the one without a tenant")
    XCTAssertNil(CallServers().resolve(tenantId: "ta"))
  }

  func testUpsertKeepsTheOrderAndRemoveForgets() {
    var s = CallServers([a, b])
    s.upsert(CallServer(id: "default", apiBaseUrl: "https://a2.example"))
    XCTAssertEqual(s.all.map(\.id), ["default", "beta"])
    XCTAssertEqual(s.get(nil)?.apiBaseUrl, "https://a2.example")
    s.remove("default")
    XCTAssertEqual(s.all.map(\.id), ["beta"])
  }

  func testTheWorkspaceShowsOnlyWithSeveralSignedIn() {
    XCTAssertNil(CallServers([a]).workspaceLabel(serverId: "default", pushName: "Acme"))
    let both = CallServers([a, b])
    XCTAssertEqual(both.workspaceLabel(serverId: "beta", pushName: "Beta (push)"), "Beta (push)")
    XCTAssertEqual(both.workspaceLabel(serverId: "beta", pushName: nil), "Beta Corp")
    XCTAssertEqual(CallServers.title("Ana", workspace: "Acme"), "Ana · Acme")
    XCTAssertEqual(CallServers.title(nil, workspace: "Acme"), "Acme")
    XCTAssertEqual(CallServers.title("Ana", workspace: nil), "Ana")
  }

  func testDictRoundTrip() {
    XCTAssertEqual(CallServer(dict: b.dict), b)
    XCTAssertNil(CallServer(dict: ["id": "", "apiBaseUrl": "https://x"]))
  }
}
