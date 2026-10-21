import Foundation

/// The engine around the machine: owns the state, serializes events,
/// executes effects through the ports, runs the timers, and emits a
/// snapshot after every change. Direct port of CallCoreRuntime.kt.
///
/// The machine decides; this class merely obeys. If behavior is wrong,
/// the fix is in CallMachine + vectors, not here.
///
/// Threading: ONE serial queue (the main thread), no lock. Every input —
/// PushKit, CallKit actions, URLSession callbacks, SFU events, timers, JS
/// commands — is `post`ed through `executor` (default: hop to
/// DispatchQueue.main). A result produced while effects execute is QUEUED
/// behind the current dispatch, never run inside it, and each dispatch
/// emits its snapshot only after its last effect. Tests pass a direct
/// executor; the internal trampoline gives them the same ordering.
public final class CallCoreRuntime {

  public static let ENDED_LINGER_MS: Int64 = 2_500
  public static let RECONNECT_BUDGET_MS: Int64 = 25_000
  /// CONNECTING watchdog: two HTTP attempts plus an SFU connect fit inside.
  public static let CONNECT_WATCHDOG_MS: Int64 = 20_000
  /// Caller-side backstop if the server's finish/no-answer never arrives.
  public static let RING_OUT_BACKSTOP_MS: Int64 = 75_000
  /// Device clocks drift; the deadline is server epoch.
  public static let CLOCK_SLACK_MS: Int64 = 10_000
  public static let RESOLVED_LRU = 32

  private static let T_DEADLINE = "ring_deadline"
  private static let T_LINGER = "linger"
  private static let T_RECONNECT = "reconnect_budget"
  private static let T_CONNECT = "connect_watchdog"
  private static let T_RING_OUT = "ring_out_backstop"

  private let http: HttpPort
  private let media: MediaPort
  private let surface: RingSurfacePort
  private let session: CallSessionPort
  private let timers: TimerPort
  private let sink: SnapshotSink
  private let executor: (@escaping () -> Void) -> Void

  private var state: MachineState = .IDLE
  /// The ring being shown (its grant answers/declines it).
  private var ring: RingContext?
  /// Grants of rings auto-declined busy, kept until the decline fires.
  private var busyRings: [String: RingContext] = [:]
  /// The session bundle of the current call, once the server accepted.
  private var bundle: CallSessionBundle?
  /// The session token place/join were called with, for one retry.
  private var sessionToken: String?
  /// Call generation: bumped when a call starts CONNECTING and when one ends.
  private var gen = 0
  /// callIds already resolved on this device; bounded LRU (insertion/refresh order).
  private var resolved: [String] = []

  private var queue: [() -> Void] = []
  private var draining = false

  /// `executor` runs a task on the single runtime thread; must be serial.
  /// Default: inline when already on the main thread, else DispatchQueue.main.async.
  public init(http: HttpPort, media: MediaPort, surface: RingSurfacePort, session: CallSessionPort,
              timers: TimerPort, sink: SnapshotSink,
              executor: ((@escaping () -> Void) -> Void)? = nil) {
    self.http = http
    self.media = media
    self.surface = surface
    self.session = session
    self.timers = timers
    self.sink = sink
    self.executor = executor ?? { block in
      if Thread.isMainThread { block() } else { DispatchQueue.main.async(execute: block) }
    }
  }

  // MARK: serial queue

  /// Run `block` on the runtime thread, after anything already queued.
  public func post(_ block: @escaping () -> Void) {
    executor { [weak self] in self?.enqueue(block) }
  }

  private func enqueue(_ block: @escaping () -> Void) {
    queue.append(block)
    if draining { return } // a dispatch is executing: run after it, not inside it
    draining = true
    defer { draining = false }
    while !queue.isEmpty {
      let next = queue.removeFirst()
      next()
    }
  }

  // MARK: inputs from adapters

  public func currentState() -> MachineState { state }

  /// Best name for the current call: the server's bundle, else the ring's. Runtime thread only.
  public var conversationName: String? { bundle?.conversationName ?? ring?.conversationName }

  /// True if `callId` was already resolved here — its ring must never surface again.
  public func isResolved(_ callId: String) -> Bool { resolved.contains(callId) }

  private func markResolved(_ callId: String?) {
    guard let callId = callId, !callId.hasPrefix("pending:") else { return }
    resolved.removeAll { $0 == callId }
    resolved.append(callId)
    if resolved.count > CallCoreRuntime.RESOLVED_LRU { resolved.removeFirst(resolved.count - CallCoreRuntime.RESOLVED_LRU) }
  }

  /// A ring arrived — push or socket, the machine treats them alike.
  public func onRing(_ ctx: RingContext) {
    post { [self] in
      if isResolved(ctx.callId) { return }
      // A late duplicate of the ring for the call we are already IN must
      // not read as "another call while busy".
      let s = state
      if s.callId == ctx.callId && s.phase != .idle && s.phase != .ringingIn { return }
      let stale = ctx.ringDeadlineEpochMs + CallCoreRuntime.CLOCK_SLACK_MS <= timers.nowMs()
      if !stale { busyRings[ctx.callId] = ctx }
      dispatch(.ring(callId: ctx.callId, conversationId: ctx.conversationId, media: ctx.media, stale: stale),
               ringCtx: ctx)
      busyRings.removeValue(forKey: ctx.callId)
    }
  }

  public func onRingEnded(callId: String, reason: String) {
    post { [self] in
      dispatch(.ringEnded(callId: callId, reason: reason))
      markResolved(callId)
    }
  }

  public func onCallFinished(callId: String, reason: String? = nil) {
    post { [self] in
      dispatch(.callFinished(callId: callId, reason: reason))
      markResolved(callId)
    }
  }

  public func answer() { post { [self] in dispatch(.userAnswer) } }
  public func decline() { post { [self] in dispatch(.userDecline) } }
  public func hangUp() { post { [self] in dispatch(.userHangup) } }

  public func place(conversationId: String, media: String, sessionToken: String) {
    post { [self] in
      if state.phase != .idle && state.phase != .ended { return }
      self.sessionToken = sessionToken
      // call_id is server-minted on place; a placeholder keys the state until the bundle arrives.
      dispatch(.userPlace(callId: "pending:\(conversationId)", conversationId: conversationId, media: media))
    }
  }

  public func join(callId: String, conversationId: String?, sessionToken: String) {
    post { [self] in
      if state.phase != .idle && state.phase != .ended { return }
      self.sessionToken = sessionToken
      dispatch(.userJoin(callId: callId, conversationId: conversationId))
    }
  }

  /// Caller-side: the bridge resolved every ring from `ring_states`.
  public func allRingsResolved(_ outcome: String) { post { [self] in dispatch(.allRingsResolved(outcome: outcome)) } }

  public func onMediaConnected() { post { [self] in dispatch(.mediaConnected) } }
  public func onMediaFailed() { post { [self] in dispatch(.mediaFailed) } }
  public func onMediaLost() { post { [self] in dispatch(.mediaLost) } }
  public func onMediaReconnecting() { post { [self] in dispatch(.mediaReconnecting) } }
  public func onMediaRecovered() { post { [self] in dispatch(.mediaRecovered) } }
  public func onRemoteJoined() { post { [self] in dispatch(.remoteJoined) } }

  public func setMuted(_ muted: Bool) { post { [self] in media.setMuted(muted) } }
  public func setCamera(_ on: Bool) { post { [self] in media.setCamera(on) } }
  public func switchCamera() { post { [self] in media.switchCamera() } }
  public func setSpeaker(_ on: Bool) { post { [self] in media.setSpeaker(on) } }
  public func setAudioOutput(_ id: String) { post { [self] in media.setAudioOutput(id) } }

  /// Re-emit the current state (the bridge's roster/route changed).
  public func reemit() { post { [self] in if state.phase != .idle { sink.emit(state: state) } } }

  // MARK: dispatch

  private func isTerminal(_ p: Phase) -> Bool { p == .idle || p == .ended }

  private func dispatch(_ event: Event, ringCtx: RingContext? = nil) {
    let before = state
    let t = CallMachine.transition(before, event)
    let next = t.state
    state = next
    // A new call attempt, or the end of one: old callbacks go stale.
    if next.phase == .connecting && before.phase != .connecting { gen += 1 }
    if isTerminal(next.phase) && !isTerminal(before.phase) {
      gen += 1
      markResolved(before.callId)
    }
    for effect in t.effects { execute(effect, ringCtx: ringCtx) }
    // Retire the ring grant / bundle only after EVERY effect had its chance.
    if isTerminal(next.phase) {
      ring = nil
      bundle = nil
      sessionToken = nil
    }
    runTimers(before, next)
    if next != before || !t.effects.isEmpty { sink.emit(state: next) }
  }

  private func execute(_ effect: Effect, ringCtx: RingContext?) {
    let g = gen
    switch effect {
    case .showRing:
      ring = ringCtx
      if let r = ringCtx { surface.show(ring: r) }
    case .dismissRing:
      // The grant is NOT retired here: HTTP_DECLINE may follow in this list.
      if let r = ring ?? ringCtx { surface.dismiss(callId: r.callId) }
    case .ringtoneStart: surface.ringtoneStart()
    case .ringtoneStop: surface.ringtoneStop()
    case .ringbackStart: surface.ringbackStart()
    case .ringbackStop: surface.ringbackStop()

    case .httpAnswer:
      if let r = ring {
        http.answer(callId: r.callId, grant: r.grant) { [weak self] res in
          self?.post { self?.onHttpResult(g, res) }
        }
      } else {
        post { [weak self] in self?.onHttpResult(g, .authFailed(code: "no_grant")) }
      }
    case .httpJoin:
      if let callId = state.callId, let token = sessionToken {
        http.join(callId: callId, sessionToken: token) { [weak self] res in
          self?.post { self?.onHttpResult(g, res) }
        }
      } else {
        post { [weak self] in self?.onHttpResult(g, .authFailed(code: "no_session")) }
      }
    case .httpPlace:
      if let conversationId = state.conversationId, let token = sessionToken {
        http.place(conversationId: conversationId, media: state.media, sessionToken: token) { [weak self] res in
          self?.post { self?.onHttpResult(g, res) }
        }
      } else {
        post { [weak self] in self?.onHttpResult(g, .authFailed(code: "no_session")) }
      }
    case .httpDecline:
      if let r = ring { http.decline(callId: r.callId, auth: r.grant, busy: false) }
    case let .httpDeclineBusy(callId):
      if let r = busyRings[callId] { http.decline(callId: r.callId, auth: r.grant, busy: true) }
      markResolved(callId)
    case .httpHangup:
      if let b = bundle {
        http.hangup(callId: b.callId, controlToken: b.controlToken)
      } else if let r = ring {
        // Hanging up a connecting answer with no bundle yet: resolve the ring instead.
        http.decline(callId: r.callId, auth: r.grant, busy: false)
      }
    case .httpReconnect:
      if let b = bundle {
        http.reconnect(current: b) { [weak self] res in
          self?.post { self?.onReconnectResult(g, res) }
        }
      } else {
        post { [weak self] in
          guard let self = self else { return }
          if g == self.gen { self.dispatch(.httpGone) }
        }
      }

    case .mediaJoin:
      if let b = bundle { media.join(bundle: b) }
    case .mediaLeave:
      media.leave()

    case .callSessionStart:
      session.start(callId: state.callId ?? "", media: state.media)
    case .callSessionStop:
      session.stop()
      bundle = nil
      ring = nil
      sessionToken = nil
    }
  }

  private func onHttpResult(_ requestGen: Int, _ result: HttpResult) {
    if requestGen != gen {
      // The call this request belonged to is over. The server may still have
      // let us in: leave with the token it just gave us, and keep nothing.
      if case let .ok(b) = result { http.hangup(callId: b.callId, controlToken: b.controlToken) }
      return
    }
    switch result {
    case let .ok(b):
      if let existing = bundle {
        // The timeout retry's twin answered too. Same call: ignore; different: leave it.
        if existing.callId != b.callId { http.hangup(callId: b.callId, controlToken: b.controlToken) }
        return
      }
      if state.phase != .connecting {
        http.hangup(callId: b.callId, controlToken: b.controlToken)
        return
      }
      bundle = b
      // The server is the authority on the call's identity, conversation and media.
      state.callId = b.callId
      state.conversationId = b.conversationId
      state.media = b.media
      dispatch(.httpOk(created: b.created))
    case .gone: dispatch(.httpGone)
    case .timeout: dispatch(.httpTimeout)
    case let .authFailed(code): dispatch(.httpFailed(code: code))
    case let .failed(code): dispatch(.httpFailed(code: code))
    }
  }

  private func onReconnectResult(_ requestGen: Int, _ result: HttpResult) {
    if requestGen != gen || state.phase != .reconnecting { return }
    switch result {
    case let .ok(b):
      // Fresh token (and possibly URL): rejoin. MEDIA_CONNECTED returns us to ACTIVE.
      bundle = b
      media.join(bundle: b)
    case .gone: dispatch(.httpGone)
    case let .authFailed(code): dispatch(.httpFailed(code: code))
    case .timeout, .failed: break // transient: the reconnect budget timer is the backstop
    }
  }

  // MARK: timers

  private func schedule(_ key: String, _ delayMs: Int64, _ event: Event) {
    let g = gen
    timers.schedule(key: key, delayMs: delayMs) { [weak self] in
      self?.post {
        guard let self = self else { return }
        if g == self.gen { self.dispatch(event) }
      }
    }
  }

  private func runTimers(_ before: MachineState, _ after: MachineState) {
    if before.phase == after.phase { return }
    switch before.phase {
    case .ringingIn: timers.cancel(key: CallCoreRuntime.T_DEADLINE)
    case .ended: timers.cancel(key: CallCoreRuntime.T_LINGER)
    case .reconnecting: timers.cancel(key: CallCoreRuntime.T_RECONNECT)
    case .connecting: timers.cancel(key: CallCoreRuntime.T_CONNECT)
    case .ringingOut: timers.cancel(key: CallCoreRuntime.T_RING_OUT)
    default: break
    }
    switch after.phase {
    case .ringingIn:
      guard let deadline = ring?.ringDeadlineEpochMs else { return }
      // Floor at the clock slack: a non-stale ring still gets a moment on screen.
      let delay = max(deadline - timers.nowMs(), CallCoreRuntime.CLOCK_SLACK_MS)
      schedule(CallCoreRuntime.T_DEADLINE, delay, .ringDeadline)
    case .ended:
      schedule(CallCoreRuntime.T_LINGER, CallCoreRuntime.ENDED_LINGER_MS, .lingerElapsed)
    case .reconnecting:
      schedule(CallCoreRuntime.T_RECONNECT, CallCoreRuntime.RECONNECT_BUDGET_MS, .reconnectBudgetElapsed)
    case .connecting:
      schedule(CallCoreRuntime.T_CONNECT, CallCoreRuntime.CONNECT_WATCHDOG_MS, .connectTimeout)
    case .ringingOut:
      schedule(CallCoreRuntime.T_RING_OUT, CallCoreRuntime.RING_OUT_BACKSTOP_MS, .allRingsResolved(outcome: "no_answer"))
    default: break
    }
  }
}

/// The real TimerPort: DispatchQueue.main work items keyed by token.
/// `nowMs` is wall-clock epoch (compared against the server's ring_deadline);
/// the delay itself counts down monotonically.
public final class MainQueueTimerPort: TimerPort {
  private var pending: [String: DispatchWorkItem] = [:]
  private let queue: DispatchQueue

  public init(queue: DispatchQueue = .main) { self.queue = queue }

  public func nowMs() -> Int64 { Int64((Date().timeIntervalSince1970 * 1000).rounded()) }

  public func schedule(key: String, delayMs: Int64, fire: @escaping () -> Void) {
    cancel(key: key)
    var item: DispatchWorkItem!
    item = DispatchWorkItem { [weak self] in
      if let self = self, self.pending[key] === item { self.pending.removeValue(forKey: key) }
      fire()
    }
    pending[key] = item
    queue.asyncAfter(deadline: .now() + .milliseconds(Int(max(0, delayMs))), execute: item)
  }

  public func cancel(key: String) {
    pending.removeValue(forKey: key)?.cancel()
  }
}
