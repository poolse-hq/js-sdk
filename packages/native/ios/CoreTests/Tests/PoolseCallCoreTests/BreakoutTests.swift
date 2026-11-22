import Foundation
import XCTest
@testable import PoolseCallCore

// Breakout rooms (MEETINGS.md §5): the same call, another LiveKit room.
// Mirrored by call-core-android's BreakoutTest.kt.

func breakoutBundle(_ callId: String = "c1", room: String = "split.2") -> CallSessionBundle {
  var b = bundle(callId)
  b.livekitToken = "lk-\(room)"
  b.controlToken = "ctl-\(room)"
  b.breakoutRoomId = room
  b.breakoutName = "Room 2"
  return b
}

final class BreakoutTests: XCTestCase {

  func testMovingSwapsTheMediaRoomAndKeepsTheCall() {
    let r = Rig()
    r.activeCall()
    let emitted = r.sink.states.count
    var accepted: Bool?
    r.runtime.moveToRoom(breakoutBundle()) { accepted = $0 }
    XCTAssertEqual(accepted, true)
    XCTAssertEqual(r.media.log.last, "join:c1:lk-split.2")
    XCTAssertFalse(r.media.log.contains("leave"))
    XCTAssertEqual(r.runtime.currentState().phase, .active)
    XCTAssertEqual(r.runtime.breakout?.roomId, "split.2")
    XCTAssertEqual(r.runtime.breakout?.name, "Room 2")
    XCTAssertGreaterThan(r.sink.states.count, emitted)
    // The system call is untouched: no new session, no stop.
    XCTAssertEqual(r.session.log, ["start:c1:audio"])
    r.runtime.onMediaConnected()
    XCTAssertEqual(r.runtime.currentState().phase, .active)
    // Hanging up uses the room's bundle (the same call).
    r.runtime.hangUp()
    XCTAssertEqual(r.http.log.last, "hangup:c1:ctl-split.2")
  }

  func testReturningToTheMainRoomClearsTheBreakout() {
    let r = Rig()
    r.activeCall()
    r.runtime.moveToRoom(breakoutBundle())
    r.runtime.onMediaConnected()
    var main = bundle()
    main.livekitToken = "lk-main-2"
    r.runtime.moveToRoom(main)
    XCTAssertEqual(r.media.log.last, "join:c1:lk-main-2")
    XCTAssertNil(r.runtime.breakout)
  }

  func testAMoveIsRefusedWithoutALiveCallOrForAnotherCall() {
    let r = Rig()
    var results: [Bool] = []
    r.runtime.moveToRoom(breakoutBundle()) { results.append($0) }
    r.runtime.onRing(ring())
    r.runtime.answer()
    r.runtime.moveToRoom(breakoutBundle()) { results.append($0) } // connecting: no bundle yet
    r.http.lastCb!(.ok(bundle()))
    r.runtime.onMediaConnected()
    r.runtime.moveToRoom(breakoutBundle("other")) { results.append($0) }
    XCTAssertEqual(results, [false, false, false])
    XCTAssertNil(r.runtime.breakout)
  }

  func testARoomThatWillNotHaveUsFallsBackToTheOneWeCameFrom() {
    let r = Rig()
    r.activeCall()
    r.runtime.moveToRoom(breakoutBundle())
    r.runtime.onMediaFailed()
    XCTAssertEqual(r.media.log.last, "join:c1:lk-c1")
    XCTAssertEqual(r.runtime.currentState().phase, .active)
    XCTAssertNil(r.runtime.breakout)
    // Once settled, a failure is the machine's again (a no-op while active).
    r.runtime.onMediaConnected()
    r.runtime.onMediaFailed()
    XCTAssertEqual(r.media.log.last, "join:c1:lk-c1")
  }

  func testAloneInABreakoutRoomIsNotTheCallEnding() {
    let r = Rig()
    r.activeCall()
    r.runtime.onRemoteCount(1)
    r.runtime.moveToRoom(breakoutBundle())
    r.runtime.onMediaConnected()
    r.runtime.onRemoteCount(1)
    r.runtime.onRemoteCount(0)
    XCTAssertNil(r.timers.scheduled["alone_probe"])
    XCTAssertEqual(r.runtime.currentState().phase, .active)
  }

  func testAMoveCancelsAPendingAloneProbe() {
    let r = Rig()
    r.activeCall()
    r.runtime.onRemoteCount(1)
    r.runtime.onRemoteCount(0)
    XCTAssertNotNil(r.timers.scheduled["alone_probe"])
    r.runtime.moveToRoom(breakoutBundle())
    XCTAssertNil(r.timers.scheduled["alone_probe"])
  }

  func testAReconnectInABreakoutRoomRejoinsThatRoom() {
    let r = Rig()
    r.activeCall()
    r.runtime.moveToRoom(breakoutBundle())
    r.runtime.onMediaConnected()
    r.runtime.onMediaLost()
    XCTAssertEqual(r.runtime.currentState().phase, .reconnecting)
    XCTAssertEqual(r.http.log.last, "reconnect:c1:ctl-split.2")
    var fresh = bundle()
    fresh.controlToken = "ctl-fresh"
    fresh.livekitToken = "lk-main-fresh"
    r.http.lastReconnectCb!(.ok(fresh))
    XCTAssertEqual(r.media.log.last, "join:c1:lk-split.2")
    XCTAssertEqual(r.runtime.breakout?.roomId, "split.2")
    XCTAssertEqual(r.runtime.control?.controlToken, "ctl-fresh")
    r.runtime.onMediaConnected()
    XCTAssertEqual(r.runtime.currentState().phase, .active)
  }

  func testTheEndOfTheCallForgetsTheRoom() {
    let r = Rig()
    r.activeCall()
    r.runtime.moveToRoom(breakoutBundle())
    r.runtime.hangUp()
    XCTAssertNil(r.runtime.breakout)
    XCTAssertNil(r.runtime.currentBundle)
  }

  func testABreakoutJoinBundleNamesItsRoom() throws {
    let body = """
    {"cv":1,"created":false,"control_token":"ctl","livekit":{"url":"wss://sfu","token":"lk-room"},
     "breakout":{"room_id":"0b7e.2","name":"Design"},
     "call":{"id":"c1","conversation_id":"conv","kind":"call"}}
    """
    let b = try CallHttpClient.parseBundle(body)
    XCTAssertEqual(b.breakoutRoomId, "0b7e.2")
    XCTAssertEqual(b.breakoutName, "Design")
    XCTAssertEqual(b.livekitToken, "lk-room")
    // The main room's bundle (return) never inherits the room.
    let main = """
    {"cv":1,"created":false,"control_token":"ctl","livekit":{"url":"wss://sfu","token":"lk-main"},
     "call":{"id":"c1","conversation_id":"conv","kind":"call"}}
    """
    XCTAssertNil(try CallHttpClient.parseBundle(main, current: b).breakoutRoomId)
    XCTAssertNil(try CallHttpClient.parseBundle(#"{"livekit":{"token":"lk2"}}"#, current: b).breakoutRoomId)
  }
}
