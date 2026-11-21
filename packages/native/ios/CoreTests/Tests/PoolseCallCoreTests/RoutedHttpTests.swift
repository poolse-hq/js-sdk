import Foundation
import XCTest
@testable import PoolseCallCore

// Several servers (workspaces) behind one runtime: every request goes to
// the server its call came from.

final class MultiServerRig {
  let a = FakeHttp() // the default server
  let b = FakeHttp()
  let media = FakeMedia(); let surface = FakeSurface()
  let session = FakeSession(); let timers = FakeTimers(); let sink = FakeSink()
  lazy var router = RoutedHttpPort { [unowned self] server in server == "b" ? self.b : self.a }
  lazy var runtime = CallCoreRuntime(http: router, media: media, surface: surface, session: session,
                                     timers: timers, sink: sink, executor: { $0() })

  /// What the platform does as a ring enters: bind, then hand it over.
  func ringFrom(_ server: String?, _ callId: String) {
    var r = ring(callId)
    r.serverId = server
    router.bindCall(callId, serverId: server)
    runtime.onRing(r)
  }
}

final class RoutedHttpTests: XCTestCase {

  func testUnboundCallsGoToTheDefaultServer() {
    let r = MultiServerRig()
    r.ringFrom(nil, "c1")
    r.runtime.answer()
    XCTAssertEqual(r.a.log.last, "answer:c1:grant-c1")
    XCTAssertTrue(r.b.log.isEmpty)
  }

  func testARingFromAnotherServerIsAnsweredThere() {
    let r = MultiServerRig()
    r.ringFrom("b", "c1")
    r.runtime.answer()
    XCTAssertEqual(r.b.log.last, "answer:c1:grant-c1")
    r.b.lastCb!(.ok(bundle("c1")))
    r.runtime.onMediaConnected()
    r.runtime.hangUp()
    XCTAssertEqual(r.b.log.last, "hangup:c1:ctl-c1")
    XCTAssertTrue(r.a.log.isEmpty)
  }

  func testCallWaitingAcrossServersAnswersAndDeclinesWhereEachRingCameFrom() {
    let r = MultiServerRig()
    r.ringFrom(nil, "c1")
    r.runtime.answer()
    r.a.lastCb!(.ok(bundle("c1")))
    r.runtime.onMediaConnected()

    // Server B rings while on A's call: it waits; End & answer ends A's
    // call on A and answers on B with B's grant.
    r.ringFrom("b", "c2")
    XCTAssertEqual(r.runtime.currentState().waiting?.callId, "c2")
    XCTAssertEqual(r.runtime.waitingRing?.serverId, "b")
    r.runtime.answerWaiting()
    XCTAssertEqual(r.a.log.last, "hangup:c1:ctl-c1")
    XCTAssertEqual(r.b.log.last, "answer:c2:grant-c2")

    // A third ring, from A, while on B's call and with c2 now current:
    // waits, then is turned away on A.
    r.b.lastCb!(.ok(bundle("c2")))
    r.runtime.onMediaConnected()
    r.ringFrom(nil, "c3")
    r.runtime.declineWaiting()
    XCTAssertEqual(r.a.log.last, "decline:c3:grant-c3:busy=true")
    XCTAssertFalse(r.b.log.contains { $0.hasPrefix("decline:c3") })
  }

  func testAPlacedCallKeepsItsServerOnceTheIdIsMinted() {
    let r = MultiServerRig()
    r.router.bindPlace("conv-1", serverId: "b")
    r.runtime.place(conversationId: "conv-1", media: "audio", sessionToken: "sess-b")
    XCTAssertEqual(r.b.log.last, "place:conv-1:audio:sess-b")
    XCTAssertEqual(r.router.serverFor("pending:conv-1"), "b")
    r.b.lastCb!(.ok(bundle("out-1")))
    XCTAssertEqual(r.router.serverFor("out-1"), "b")
    r.runtime.hangUp()
    XCTAssertEqual(r.b.log.last, "hangup:out-1:ctl-out-1")
    XCTAssertTrue(r.a.log.isEmpty)
  }

  func testBindingsAreBounded() {
    let router = RoutedHttpPort { _ in FakeHttp() }
    for i in 0..<100 { router.bindCall("c\(i)", serverId: "b") }
    XCTAssertNil(router.serverFor("c0"))
    XCTAssertEqual(router.serverFor("c99"), "b")
    router.bindCall("c99", serverId: nil)
    XCTAssertNil(router.serverFor("c99"))
  }
}
