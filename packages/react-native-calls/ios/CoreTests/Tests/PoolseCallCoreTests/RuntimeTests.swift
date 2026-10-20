import Foundation
import XCTest
@testable import PoolseCallCore

// Port of call-core-android RuntimeTest.kt — the runtime's bookkeeping.

final class FakeHttp: HttpPort {
  var log: [String] = []
  var lastCb: ((HttpResult) -> Void)?
  var cbs: [(HttpResult) -> Void] = []
  var lastReconnectCb: ((HttpResult) -> Void)?
  /// When set, request/response doors answer synchronously, inside the effect.
  var immediate: HttpResult?

  private func take(_ cb: @escaping (HttpResult) -> Void) {
    lastCb = cb; cbs.append(cb)
    if let i = immediate { cb(i) }
  }
  func answer(callId: String, grant: String, cb: @escaping (HttpResult) -> Void) { log.append("answer:\(callId):\(grant)"); take(cb) }
  func join(callId: String, sessionToken: String, cb: @escaping (HttpResult) -> Void) { log.append("join:\(callId):\(sessionToken)"); take(cb) }
  func place(conversationId: String, media: String, sessionToken: String, cb: @escaping (HttpResult) -> Void) {
    log.append("place:\(conversationId):\(media):\(sessionToken)"); take(cb)
  }
  func decline(callId: String, auth: String, busy: Bool) { log.append("decline:\(callId):\(auth):busy=\(busy)") }
  func hangup(callId: String, controlToken: String) { log.append("hangup:\(callId):\(controlToken)") }
  func reconnect(current: CallSessionBundle, cb: @escaping (HttpResult) -> Void) {
    log.append("reconnect:\(current.callId):\(current.controlToken)"); lastReconnectCb = cb
  }
}

final class FakeMedia: MediaPort {
  var log: [String] = []
  func join(bundle: CallSessionBundle) { log.append("join:\(bundle.callId):\(bundle.livekitToken)") }
  func leave() { log.append("leave") }
  func setMuted(_ muted: Bool) { log.append("muted:\(muted)") }
  func setCamera(_ on: Bool) { log.append("camera:\(on)") }
  func switchCamera() { log.append("switch") }
  func setSpeaker(_ on: Bool) { log.append("speaker:\(on)") }
}

final class FakeSurface: RingSurfacePort {
  var log: [String] = []
  func show(ring: RingContext) { log.append("show:\(ring.callId)") }
  func dismiss(callId: String) { log.append("dismiss:\(callId)") }
  func ringtoneStart() { log.append("ringtone+") }
  func ringtoneStop() { log.append("ringtone-") }
  func ringbackStart() { log.append("ringback+") }
  func ringbackStop() { log.append("ringback-") }
}

final class FakeSession: CallSessionPort {
  var log: [String] = []
  func start(callId: String, media: String) { log.append("start:\(callId):\(media)") }
  func stop() { log.append("stop") }
}

final class FakeTimers: TimerPort {
  var now: Int64 = 1_000_000
  var scheduled: [String: (Int64, () -> Void)] = [:]
  func nowMs() -> Int64 { now }
  func schedule(key: String, delayMs: Int64, fire: @escaping () -> Void) { scheduled[key] = (delayMs, fire) }
  func cancel(key: String) { scheduled.removeValue(forKey: key) }
  func fire(_ key: String) {
    guard let (_, fn) = scheduled.removeValue(forKey: key) else { return XCTFail("timer \(key) not scheduled") }
    fn()
  }
}

final class FakeSink: SnapshotSink {
  var phases: [Phase] = []
  var states: [MachineState] = []
  func emit(state: MachineState) { phases.append(state.phase); states.append(state) }
}

final class Rig {
  let http = FakeHttp(); let media = FakeMedia(); let surface = FakeSurface()
  let session = FakeSession(); let timers = FakeTimers(); let sink = FakeSink()
  lazy var runtime = CallCoreRuntime(http: http, media: media, surface: surface, session: session,
                                     timers: timers, sink: sink, executor: { $0() })

  func activeCall(_ callId: String = "c1") {
    runtime.onRing(ring(callId))
    runtime.answer()
    http.lastCb!(.ok(bundle(callId)))
    runtime.onMediaConnected()
    XCTAssertEqual(runtime.currentState().phase, .active)
  }

  @discardableResult
  func ringingOut() -> String {
    runtime.place(conversationId: "conv-1", media: "audio", sessionToken: "sess")
    http.lastCb!(.ok(bundle("out-1")))
    XCTAssertEqual(runtime.currentState().phase, .ringingOut)
    return "out-1"
  }
}

func ring(_ callId: String = "c1", deadlineIn: Int64 = 45_000) -> RingContext {
  RingContext(callId: callId, conversationId: "conv-\(callId)", conversationName: "Fix the boiler",
              callerName: "Elena", media: "audio", grant: "grant-\(callId)",
              ringDeadlineEpochMs: 1_000_000 + deadlineIn)
}

func bundle(_ callId: String = "c1", created: Bool = true) -> CallSessionBundle {
  CallSessionBundle(callId: callId, conversationId: "conv-\(callId)", conversationName: "Fix the boiler",
                    media: "audio", created: created, livekitUrl: "wss://sfu", livekitToken: "lk-\(callId)",
                    controlToken: "ctl-\(callId)")
}

final class RuntimeTests: XCTestCase {

  func testColdRingToConnectedCallUsesTheRingsGrant() {
    let r = Rig()
    r.runtime.onRing(ring())
    XCTAssertEqual(r.surface.log, ["show:c1", "ringtone+"])
    XCTAssertNotNil(r.timers.scheduled["ring_deadline"])
    r.runtime.answer()
    XCTAssertEqual(r.http.log.last, "answer:c1:grant-c1")
    XCTAssertEqual(r.session.log.last, "start:c1:audio")
    XCTAssertNil(r.timers.scheduled["ring_deadline"])
    r.http.lastCb!(.ok(bundle()))
    XCTAssertEqual(r.media.log.last, "join:c1:lk-c1")
    r.runtime.onMediaConnected()
    XCTAssertEqual(r.runtime.currentState().phase, .active)
    XCTAssertEqual(r.sink.phases.last, .active)
  }

  func testSecondRingBusyDeclinedWithItsOwnGrant() {
    let r = Rig()
    r.runtime.onRing(ring("c1"))
    r.runtime.onRing(ring("c2"))
    XCTAssertEqual(r.http.log.last, "decline:c2:grant-c2:busy=true")
    XCTAssertEqual(r.runtime.currentState().phase, .ringingIn)
    XCTAssertEqual(r.runtime.currentState().callId, "c1")
  }

  func testRingDeadlineDismisses() {
    let r = Rig()
    r.runtime.onRing(ring())
    r.timers.fire("ring_deadline")
    XCTAssertEqual(r.surface.log, ["show:c1", "ringtone+", "ringtone-", "dismiss:c1"])
    XCTAssertEqual(r.runtime.currentState().phase, .idle)
  }

  func testDeclineResolvesWithGrantAndDropsToIdle() {
    let r = Rig()
    r.runtime.onRing(ring())
    r.runtime.decline()
    XCTAssertEqual(r.http.log.last, "decline:c1:grant-c1:busy=false")
    XCTAssertEqual(r.runtime.currentState().phase, .idle)
    XCTAssertEqual(r.sink.phases, [.ringingIn, .idle])
  }

  func testStaleRingNeverSurfaces() {
    let r = Rig()
    r.runtime.onRing(ring(deadlineIn: -10_001))
    XCTAssertTrue(r.surface.log.isEmpty)
    XCTAssertEqual(r.runtime.currentState().phase, .idle)
  }

  func testPlacingAdoptsServerIdAndRingsBack() {
    let r = Rig()
    r.runtime.place(conversationId: "conv-1", media: "audio", sessionToken: "sess-token")
    XCTAssertEqual(r.http.log.last, "place:conv-1:audio:sess-token")
    r.http.lastCb!(.ok(bundle("real-id")))
    XCTAssertEqual(r.runtime.currentState().callId, "real-id")
    XCTAssertEqual(r.runtime.currentState().phase, .ringingOut)
    XCTAssertEqual(r.surface.log.last, "ringback+")
    r.runtime.onRemoteJoined()
    XCTAssertEqual(r.runtime.currentState().phase, .active)
    XCTAssertEqual(r.surface.log.last, "ringback-")
  }

  func testPlacingOntoLiveCallBecomesJoin() {
    let r = Rig()
    r.runtime.place(conversationId: "conv-1", media: "audio", sessionToken: "sess-token")
    r.http.lastCb!(.ok(bundle("real-id", created: false)))
    XCTAssertEqual(r.runtime.currentState().direction, .joined)
    XCTAssertEqual(r.runtime.currentState().phase, .connecting)
    XCTAssertFalse(r.surface.log.contains("ringback+"))
  }

  func testReconnectUsesControlTokenAndGoneMeansOut() {
    let r = Rig()
    r.activeCall()
    r.runtime.onMediaLost()
    XCTAssertEqual(r.http.log.last, "reconnect:c1:ctl-c1")
    XCTAssertNotNil(r.timers.scheduled["reconnect_budget"])
    r.http.lastReconnectCb!(.gone)
    XCTAssertEqual(r.runtime.currentState().phase, .ended)
    XCTAssertEqual(r.runtime.currentState().reason, .left)
    XCTAssertEqual(r.session.log.last, "stop")
  }

  func testExhaustedReconnectBudgetHangsUp() {
    let r = Rig()
    r.activeCall()
    r.runtime.onMediaLost()
    r.timers.fire("reconnect_budget")
    XCTAssertEqual(r.runtime.currentState().reason, .connectionLost)
    XCTAssertTrue(r.http.log.contains("hangup:c1:ctl-c1"))
  }

  func testHangupMidAnswerWithoutBundleResolvesRing() {
    let r = Rig()
    r.runtime.onRing(ring())
    r.runtime.answer()
    r.runtime.hangUp()
    XCTAssertEqual(r.http.log.last, "decline:c1:grant-c1:busy=false")
    XCTAssertEqual(r.runtime.currentState().phase, .ended)
  }

  func testLingerResetsToIdle() {
    let r = Rig()
    r.activeCall("c3")
    r.runtime.hangUp()
    XCTAssertEqual(r.runtime.currentState().phase, .ended)
    XCTAssertEqual(r.timers.scheduled["linger"]?.0, CallCoreRuntime.ENDED_LINGER_MS)
    XCTAssertEqual(r.sink.states.last?.reason, .left)
    r.timers.fire("linger")
    XCTAssertEqual(r.runtime.currentState().phase, .idle)
    XCTAssertEqual(r.sink.phases.last, .idle)
  }

  func testLeavingActiveSendsHangup() {
    let r = Rig()
    r.activeCall()
    r.runtime.hangUp()
    XCTAssertEqual(r.http.log.last, "hangup:c1:ctl-c1")
    XCTAssertEqual(r.runtime.currentState().reason, .left)
    XCTAssertEqual(r.media.log.last, "leave")
  }

  func testRingWithinClockSlackStillShows() {
    let r = Rig()
    r.runtime.onRing(ring(deadlineIn: -5_000))
    XCTAssertEqual(r.runtime.currentState().phase, .ringingIn)
    XCTAssertEqual(r.timers.scheduled["ring_deadline"]?.0, CallCoreRuntime.CLOCK_SLACK_MS)
  }

  func testReconnectAppliesFreshBundle() {
    let r = Rig()
    r.activeCall()
    r.runtime.onMediaLost()
    XCTAssertEqual(r.runtime.currentState().phase, .reconnecting)
    var fresh = bundle(); fresh.livekitToken = "lk-fresh"; fresh.controlToken = "ctl-fresh"
    r.http.lastReconnectCb!(.ok(fresh))
    XCTAssertEqual(r.media.log.last, "join:c1:lk-fresh")
    r.runtime.onMediaConnected()
    XCTAssertEqual(r.runtime.currentState().phase, .active)
    XCTAssertNil(r.timers.scheduled["reconnect_budget"])
    r.runtime.hangUp()
    XCTAssertEqual(r.http.log.last, "hangup:c1:ctl-fresh")
  }

  func testSfuSelfRecovery() {
    let r = Rig()
    r.activeCall()
    let before = r.http.log.count
    r.runtime.onMediaReconnecting()
    XCTAssertEqual(r.runtime.currentState().phase, .reconnecting)
    XCTAssertEqual(r.http.log.count, before)
    XCTAssertNotEqual(r.media.log.last, "leave")
    r.runtime.onMediaRecovered()
    XCTAssertEqual(r.runtime.currentState().phase, .active)
  }

  func testHangupWhileConnectingHangsUpLateBundle() {
    let r = Rig()
    r.runtime.onRing(ring())
    r.runtime.answer()
    r.runtime.hangUp()
    XCTAssertEqual(r.runtime.currentState().phase, .ended)
    r.http.lastCb!(.ok(bundle()))
    XCTAssertEqual(r.http.log.last, "hangup:c1:ctl-c1")
    XCTAssertFalse(r.media.log.contains { $0.hasPrefix("join") })
    r.runtime.onRing(ring("c2"))
    r.runtime.answer()
    r.http.lastCb!(.ok(bundle("c2")))
    XCTAssertEqual(r.media.log.last, "join:c2:lk-c2")
  }

  func testPreviousCallsLatePlaceResponseNotAdopted() {
    let r = Rig()
    r.runtime.place(conversationId: "conv-a", media: "audio", sessionToken: "sess")
    let first = r.http.lastCb!
    r.runtime.hangUp()
    r.runtime.place(conversationId: "conv-b", media: "audio", sessionToken: "sess")
    XCTAssertEqual(r.runtime.currentState().phase, .connecting)
    first(.ok(bundle("a")))
    XCTAssertEqual(r.http.log.last, "hangup:a:ctl-a")
    XCTAssertEqual(r.runtime.currentState().phase, .connecting)
    XCTAssertEqual(r.runtime.currentState().callId, "pending:conv-b")
    XCTAssertFalse(r.media.log.contains { $0.hasPrefix("join") })
  }

  func testRetryTwinIgnored() {
    let r = Rig()
    r.runtime.onRing(ring())
    r.runtime.answer()
    let first = r.http.cbs[0]
    first(.timeout)
    let second = r.http.cbs[1]
    second(.ok(bundle()))
    first(.ok(bundle()))
    XCTAssertEqual(r.media.log.filter { $0.hasPrefix("join") }.count, 1)
    XCTAssertFalse(r.http.log.contains { $0.hasPrefix("hangup") })
  }

  func testMediaFailureWhileRingingOut() {
    let r = Rig()
    r.ringingOut()
    r.runtime.onMediaFailed()
    let s = r.runtime.currentState()
    XCTAssertEqual(s.phase, .ended)
    XCTAssertEqual(s.reason, .failed)
    XCTAssertEqual(r.surface.log.last, "ringback-")
    XCTAssertEqual(r.media.log.last, "leave")
    XCTAssertEqual(r.http.log.last, "hangup:out-1:ctl-out-1")
    XCTAssertEqual(r.session.log.last, "stop")
  }

  func testFinishedPushEndsRingingOutWithReason() {
    let r = Rig()
    let id = r.ringingOut()
    r.runtime.onCallFinished(callId: id, reason: "no_answer")
    let s = r.runtime.currentState()
    XCTAssertEqual(s.phase, .ended)
    XCTAssertEqual(s.reason, .noAnswer)
    XCTAssertEqual(r.surface.log.last, "ringback-")
    XCTAssertEqual(r.media.log.last, "leave")
    XCTAssertFalse(r.http.log.contains { $0.hasPrefix("hangup") })
  }

  func testFinishedPushEndsActiveAsFinished() {
    let r = Rig()
    r.activeCall()
    r.runtime.onCallFinished(callId: "c1", reason: "finished")
    XCTAssertEqual(r.runtime.currentState().reason, .finished)
    XCTAssertEqual(r.session.log.last, "stop")
  }

  func testAuthRefusalFails() {
    let r = Rig()
    r.runtime.onRing(ring())
    r.runtime.answer()
    r.http.lastCb!(.authFailed(code: "grant_spent"))
    XCTAssertEqual(r.runtime.currentState().reason, .failed)
    XCTAssertEqual(r.session.log.last, "stop")
  }

  func testSecondTimeoutFails() {
    let r = Rig()
    r.runtime.place(conversationId: "conv-1", media: "audio", sessionToken: "sess")
    r.http.lastCb!(.timeout)
    XCTAssertEqual(r.runtime.currentState().phase, .connecting)
    r.http.lastCb!(.timeout)
    XCTAssertEqual(r.runtime.currentState().phase, .ended)
    XCTAssertEqual(r.runtime.currentState().reason, .failed)
    XCTAssertEqual(r.session.log.last, "stop")
  }

  func testConnectWatchdog() {
    let r = Rig()
    r.runtime.place(conversationId: "conv-1", media: "audio", sessionToken: "sess")
    r.timers.fire("connect_watchdog")
    XCTAssertEqual(r.runtime.currentState().reason, .failed)
  }

  func testResolvedCallNeverRingsAgain() {
    let r = Rig()
    r.runtime.onRing(ring("c1"))
    r.runtime.decline()
    r.surface.log.removeAll()
    r.runtime.onRing(ring("c1"))
    XCTAssertTrue(r.surface.log.isEmpty)
    XCTAssertEqual(r.runtime.currentState().phase, .idle)
    r.runtime.onRingEnded(callId: "c9", reason: "cancelled")
    r.runtime.onRing(ring("c9"))
    XCTAssertTrue(r.surface.log.isEmpty)
  }

  func testDuplicateRingOfOwnCallNotBusyDeclined() {
    let r = Rig()
    r.activeCall("c1")
    r.runtime.onRing(ring("c1"))
    XCTAssertFalse(r.http.log.contains { $0.hasPrefix("decline") })
    XCTAssertEqual(r.runtime.currentState().phase, .active)
  }

  func testResolvedLRUBounded() {
    let r = Rig()
    for i in 0...CallCoreRuntime.RESOLVED_LRU { r.runtime.onRingEnded(callId: "x\(i)", reason: "cancelled") }
    XCTAssertFalse(r.runtime.isResolved("x0"))
    XCTAssertTrue(r.runtime.isResolved("x1"))
    XCTAssertTrue(r.runtime.isResolved("x\(CallCoreRuntime.RESOLVED_LRU)"))
  }

  func testSynchronousPortResultQueuedNotReentered() {
    let r = Rig()
    r.http.immediate = .ok(bundle("out-1"))
    r.runtime.place(conversationId: "conv-1", media: "audio", sessionToken: "sess")
    XCTAssertEqual(r.runtime.currentState().phase, .ringingOut)
    XCTAssertEqual(r.sink.phases, [.connecting, .ringingOut])
    XCTAssertEqual(r.session.log.first, "start:pending:conv-1:audio")
  }

  func testStaleTimerCannotTouchNextCall() {
    let r = Rig()
    r.runtime.place(conversationId: "conv-a", media: "audio", sessionToken: "sess")
    let staleFire = r.timers.scheduled["connect_watchdog"]!.1
    r.runtime.hangUp()
    r.runtime.place(conversationId: "conv-b", media: "audio", sessionToken: "sess")
    staleFire()
    XCTAssertEqual(r.runtime.currentState().phase, .connecting)
  }

  func testJoinAdoptsServerConversationAndMedia() {
    let r = Rig()
    r.runtime.join(callId: "c1", conversationId: nil, sessionToken: "sess")
    XCTAssertEqual(r.runtime.currentState().media, "audio")
    var b = bundle(); b.media = "video"; b.conversationId = "conv-x"
    r.http.lastCb!(.ok(b))
    XCTAssertEqual(r.runtime.currentState().media, "video")
    XCTAssertEqual(r.runtime.currentState().conversationId, "conv-x")
    XCTAssertEqual(r.sink.states.last?.media, "video")
  }

  func testLaterFinishUpgradesReason() {
    let r = Rig()
    let id = r.ringingOut()
    r.runtime.onCallFinished(callId: id, reason: nil)
    XCTAssertEqual(r.runtime.currentState().reason, .finished)
    r.runtime.onCallFinished(callId: id, reason: "declined_all")
    XCTAssertEqual(r.runtime.currentState().reason, .declinedAll)
    XCTAssertEqual(r.sink.states.last?.reason, .declinedAll)
    XCTAssertNotNil(r.timers.scheduled["linger"])
  }

  func testDefaultExecutorOnMainRunsInline() {
    let http = FakeHttp(), media = FakeMedia(), surface = FakeSurface(), session = FakeSession()
    let timers = FakeTimers(), sink = FakeSink()
    let rt = CallCoreRuntime(http: http, media: media, surface: surface, session: session, timers: timers, sink: sink)
    XCTAssertTrue(Thread.isMainThread)
    rt.onRing(ring())
    XCTAssertEqual(rt.currentState().phase, .ringingIn)
  }
}

// MARK: - HTTP classification + snapshot encoding

final class HttpAndSnapshotTests: XCTestCase {

  let full = """
  {"call":{"id":"c1","conversation_id":"conv-1","conversation_name":"Boiler","media":"video"},
   "created":false,"livekit":{"url":"wss://sfu","token":"lk"},"control_token":"ctl"}
  """

  func testFullBundleParses() {
    guard case let .ok(b) = CallHttpClient.classify(code: 200, payload: full) else { return XCTFail() }
    XCTAssertEqual(b, CallSessionBundle(callId: "c1", conversationId: "conv-1", conversationName: "Boiler",
                                        media: "video", created: false, livekitUrl: "wss://sfu",
                                        livekitToken: "lk", controlToken: "ctl"))
  }

  func testCreatedDefaultsTrueAndMediaAudio() {
    let p = #"{"call":{"id":"c1","conversation_id":"v"},"livekit":{"url":"u","token":"t"},"control_token":"x"}"#
    guard case let .ok(b) = CallHttpClient.classify(code: 201, payload: p) else { return XCTFail() }
    XCTAssertTrue(b.created)
    XCTAssertEqual(b.media, "audio")
    XCTAssertNil(b.conversationName)
  }

  func testLegacyReconnectShapeAppliesOntoCurrent() {
    let cur = bundle()
    let p = #"{"livekit":{"token":"lk-new"}}"#
    guard case let .ok(b) = CallHttpClient.classify(code: 200, payload: p, current: cur) else { return XCTFail() }
    XCTAssertEqual(b.livekitToken, "lk-new")
    XCTAssertEqual(b.livekitUrl, "wss://sfu")
    XCTAssertEqual(b.controlToken, "ctl-c1")
    XCTAssertEqual(CallHttpClient.classify(code: 200, payload: p), .failed(code: "bad_body"))
  }

  func testStatusMapping() {
    XCTAssertEqual(CallHttpClient.classify(code: 200, payload: "nope"), .failed(code: "bad_body"))
    XCTAssertEqual(CallHttpClient.classify(code: 404, payload: nil), .gone)
    XCTAssertEqual(CallHttpClient.classify(code: 410, payload: nil), .gone)
    XCTAssertEqual(CallHttpClient.classify(code: 401, payload: #"{"error":{"code":"grant_spent"}}"#),
                   .authFailed(code: "grant_spent"))
    XCTAssertEqual(CallHttpClient.classify(code: 403, payload: nil), .authFailed(code: "http_403"))
    XCTAssertEqual(CallHttpClient.classify(code: 503, payload: #"{"error":"no_capacity"}"#), .failed(code: "no_capacity"))
    XCTAssertEqual(CallHttpClient.classify(code: 500, payload: nil), .timeout)
    XCTAssertEqual(CallHttpClient.classify(code: 429, payload: nil), .timeout)
    XCTAssertEqual(CallHttpClient.classify(code: 422, payload: nil), .failed(code: "http_422"))
  }

  func testSnapshotShape() {
    XCTAssertNil(MachineState.IDLE.toSnapshot())
    let s = MachineState(phase: .ended, callId: "c1", conversationId: "v", direction: .outgoing,
                         media: "video", reason: .declinedAll)
    let snap = s.toSnapshot(conversationName: nil,
                            participants: [SnapshotParticipant(userId: "u", externalId: "e", speaking: true, muted: false, cameraOn: true)],
                            audioRoute: "speaker", mutedSelf: true, cameraOn: true, cameraFacing: "front")!
    XCTAssertEqual(snap["cv"] as? Int, 1)
    XCTAssertEqual(snap["phase"] as? String, "ended")
    XCTAssertEqual(snap["direction"] as? String, "outgoing")
    XCTAssertEqual(snap["reason"] as? String, "declined_all")
    XCTAssertTrue(snap["conversationName"] is NSNull)
    XCTAssertEqual(snap["cameraFacing"] as? String, "front")
    XCTAssertEqual((snap["participants"] as? [[String: Any]])?.first?["externalId"] as? String, "e")
    let active = MachineState(phase: .active, callId: "c1", conversationId: "v").toSnapshot()!
    XCTAssertNil(active["reason"])
    XCTAssertNil(active["cameraFacing"])
    XCTAssertEqual(active["direction"] as? String, "incoming")
    XCTAssertTrue(JSONSerialization.isValidJSONObject(snap))
  }
}
