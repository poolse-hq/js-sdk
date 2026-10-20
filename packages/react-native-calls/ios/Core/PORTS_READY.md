# iOS call core — ports & runtime API (ready to code against)

Swift port of `android/.../callcore/{Ports,CallMachine,CallCoreRuntime}.kt`.
Foundation only, main-thread confined, no Sendable. All types `public`.

## Ports (ios/Core/Ports.swift)

```swift
protocol HttpPort: AnyObject {
  func answer(callId: String, grant: String, cb: @escaping (HttpResult) -> Void)
  func join(callId: String, sessionToken: String, cb: @escaping (HttpResult) -> Void)
  func place(conversationId: String, media: String, sessionToken: String, cb: @escaping (HttpResult) -> Void)
  func decline(callId: String, auth: String, busy: Bool)
  func hangup(callId: String, controlToken: String)
  func reconnect(current: CallSessionBundle, cb: @escaping (HttpResult) -> Void)
}
enum HttpResult { case ok(CallSessionBundle), gone, timeout, authFailed(code: String), failed(code: String) }
struct CallSessionBundle { callId, conversationId, conversationName?, media, created, livekitUrl, livekitToken, controlToken }

protocol MediaPort: AnyObject {
  func join(bundle: CallSessionBundle); func leave()
  func setMuted(_ muted: Bool); func setCamera(_ on: Bool); func switchCamera(); func setSpeaker(_ on: Bool)
}
protocol RingSurfacePort: AnyObject {
  func show(ring: RingContext); func dismiss(callId: String)
  func ringtoneStart(); func ringtoneStop(); func ringbackStart(); func ringbackStop()
}
struct RingContext { callId, conversationId, conversationName?, callerName?, media, grant, ringDeadlineEpochMs: Int64 }
protocol CallSessionPort: AnyObject { func start(callId: String, media: String); func stop() }
protocol SnapshotSink: AnyObject { func emit(state: MachineState) }   // BlockSnapshotSink { state in ... } helper
protocol TimerPort: AnyObject {
  func nowMs() -> Int64
  func schedule(key: String, delayMs: Int64, fire: @escaping () -> Void)  // same key replaces
  func cancel(key: String)
}
// State values: Phase (.idle .ringingIn .ringingOut .connecting .active .reconnecting .ended),
// Direction (.incoming .outgoing .joined), EndReason (.left .finished .declinedAll .busyAll
// .noAnswer .cancelled .connectionLost .failed; `.wire` = "declined_all" etc.),
// MachineState { phase, callId?, conversationId?, direction?, media, reason?, httpAttempts }
```

Provided implementations in Core: `CallHttpClient` (HttpPort, URLSession),
`MainQueueTimerPort()` (TimerPort on DispatchQueue.main, epoch nowMs), `BlockSnapshotSink { state in }`.

## Runtime (ios/Core/CallCoreRuntime.swift)

```swift
let rt = CallCoreRuntime(
  http: HttpPort, media: MediaPort, surface: RingSurfacePort,
  session: CallSessionPort, timers: TimerPort, sink: SnapshotSink,
  executor: ((@escaping () -> Void) -> Void)? = nil)  // default: inline if on main thread, else DispatchQueue.main.async

rt.currentState() -> MachineState
rt.conversationName: String?          // bundle's, else the ring's (main thread)
rt.isResolved(_ callId: String) -> Bool
rt.post(_ block: @escaping () -> Void)

// inputs
rt.onRing(_ ctx: RingContext)          // push (PushKit) or socket — same path
rt.onRingEnded(callId:reason:)
rt.onCallFinished(callId:reason:)      // reason: String? = nil
rt.answer(); rt.decline(); rt.hangUp()
rt.place(conversationId:media:sessionToken:)
rt.join(callId:conversationId:sessionToken:)   // conversationId: String?
rt.allRingsResolved(_ outcome: String)
rt.onMediaConnected(); rt.onMediaFailed(); rt.onMediaLost()
rt.onMediaReconnecting(); rt.onMediaRecovered(); rt.onRemoteJoined()
rt.setMuted(_:); rt.setCamera(_:); rt.switchCamera(); rt.setSpeaker(_:)
rt.reemit()                            // re-emit current state (roster/route changed)
```

Constants: `CallCoreRuntime.ENDED_LINGER_MS` (2500), `RECONNECT_BUDGET_MS` (25000),
`CONNECT_WATCHDOG_MS` (20000), `RING_OUT_BACKSTOP_MS` (75000), `CLOCK_SLACK_MS` (10000), `RESOLVED_LRU` (32).

The sink receives the MachineState after every change; IDLE means "no call" (emit `snapshot: null`).
Ended state lingers 2.5 s, then IDLE is emitted.

## HTTP client (ios/Core/CallHttpClient.swift)

```swift
CallHttpClient(baseUrl: @escaping () -> String, session: URLSession = CallHttpClient.defaultSession())
// baseUrl read per request (staging/prod switch). 9 s total timeout. Static classify/parseBundle/errorCode are pure.
```

## Snapshot (ios/Core/SnapshotEncoding.swift)

```swift
struct SnapshotParticipant { userId, externalId, speaking, muted, cameraOn }
MachineState.toSnapshot(conversationName: String? = nil,
  participants: [SnapshotParticipant] = [], audioRoute: String = "earpiece",
  mutedSelf: Bool = false, cameraOn: Bool = false, cameraFacing: String? = nil) -> [String: Any]?
// nil for IDLE. conversationName nil -> NSNull; reason / cameraFacing omitted when nil.
```
