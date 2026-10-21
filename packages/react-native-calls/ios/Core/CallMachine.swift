import Foundation

// The call state machine — contract cv 1, CONTRACT.md §7. Direct port of
// android/.../callcore/CallMachine.kt. Pure: no I/O, no platform, no time.
// Pinned by contracts/call-core/vectors.json — change the vectors first.

/// Inputs, named exactly as in the contract and vectors.
public enum Event: Equatable {
  /// A ring from push or socket — treated identically. `stale`: deadline passed. Never surface.
  case ring(callId: String, conversationId: String? = nil, media: String = "audio", stale: Bool = false)
  case ringEnded(callId: String, reason: String)
  /// The server finished the call; `reason` only colours an unanswered caller's ended screen.
  case callFinished(callId: String, reason: String? = nil)
  case userAnswer
  case userDecline
  case userPlace(callId: String, conversationId: String? = nil, media: String = "audio")
  case userJoin(callId: String, conversationId: String? = nil)
  case userHangup
  /// Server accepted answer/join/place. `created=false` on place: an existing live call (became a join).
  case httpOk(created: Bool = true)
  case httpGone
  case httpTimeout
  /// Terminal refusal that is NOT "the call is over" (401/403, 503, unparseable 2xx).
  case httpFailed(code: String = "failed")
  case mediaConnected
  case mediaFailed
  case mediaLost
  /// The SFU is recovering on its own. Show it; do not rejoin.
  case mediaReconnecting
  case mediaRecovered
  case remoteJoined
  /// Caller side: every ring resolved without anyone joining.
  case allRingsResolved(outcome: String)
  case ringDeadline
  case reconnectBudgetElapsed
  /// CONNECTING watchdog.
  case connectTimeout
  case lingerElapsed
  /// Call waiting: leave the current call and answer the waiting one.
  case userAnswerWaiting
  /// Call waiting: turn the waiting call away — its caller hears busy.
  case userDeclineWaiting
  /// The waiting call's ring deadline passed.
  case waitingDeadline
}

/// Abstract effects — each adapter maps them to its platform.
public enum Effect: Equatable {
  case showRing, dismissRing, ringtoneStart, ringtoneStop, ringbackStart, ringbackStop
  case httpAnswer, httpJoin, httpPlace, httpDecline
  case httpDeclineBusy(callId: String)
  case httpHangup, httpReconnect, mediaJoin, mediaLeave, callSessionStart, callSessionStop
  case showWaiting, dismissWaiting
  /// The waiting call becomes the current one: retire the old call's
  /// grant/bundle/generation and take the waiting ring's.
  case promoteWaiting

  public var wire: String {
    switch self {
    case .showRing: return "SHOW_RING"
    case .dismissRing: return "DISMISS_RING"
    case .ringtoneStart: return "RINGTONE_START"
    case .ringtoneStop: return "RINGTONE_STOP"
    case .ringbackStart: return "RINGBACK_START"
    case .ringbackStop: return "RINGBACK_STOP"
    case .httpAnswer: return "HTTP_ANSWER"
    case .httpJoin: return "HTTP_JOIN"
    case .httpPlace: return "HTTP_PLACE"
    case .httpDecline: return "HTTP_DECLINE"
    case .httpDeclineBusy(let callId): return "HTTP_DECLINE_BUSY:\(callId)"
    case .httpHangup: return "HTTP_HANGUP"
    case .httpReconnect: return "HTTP_RECONNECT"
    case .mediaJoin: return "MEDIA_JOIN"
    case .mediaLeave: return "MEDIA_LEAVE"
    case .callSessionStart: return "CALL_SESSION_START"
    case .callSessionStop: return "CALL_SESSION_STOP"
    case .showWaiting: return "SHOW_WAITING"
    case .dismissWaiting: return "DISMISS_WAITING"
    case .promoteWaiting: return "PROMOTE_WAITING"
    }
  }
}

public struct Transition: Equatable {
  public let state: MachineState
  public let effects: [Effect]
  public init(_ state: MachineState, _ effects: [Effect]) {
    self.state = state
    self.effects = effects
  }
}

private extension MachineState {
  func with(phase: Phase? = nil, reason: EndReason?? = nil, direction: Direction?? = nil,
            httpAttempts: Int? = nil) -> MachineState {
    var c = self
    if let phase = phase { c.phase = phase }
    if let reason = reason { c.reason = reason }
    if let direction = direction { c.direction = direction }
    if let httpAttempts = httpAttempts { c.httpAttempts = httpAttempts }
    return c
  }
}

public enum CallMachine {

  /// Phases that can hold a call waiting beside them: this device is on
  /// (or placing, or joining) a call. A second ring while one is ringING
  /// in is still busy — two rings at once is not a choice anyone can make.
  private static func canHoldWaiting(_ s: MachineState) -> Bool {
    switch s.phase {
    case .ringingOut, .connecting, .active, .reconnecting: return true
    default: return false
    }
  }

  /// The ring surface effects the end-and-answer composite skips: the
  /// waiting call goes straight from waiting to connecting, never ringing.
  private static let ringSurfaceEffects: [Effect] = [.showRing, .ringtoneStart, .ringtoneStop, .dismissRing]

  public static func transition(_ s: MachineState, _ e: Event) -> Transition {
    guard let w = s.waiting else {
      switch e {
      case let .ring(callId, conversationId, media, stale)
        where !stale && canHoldWaiting(s) && callId != s.callId:
        var next = s
        next.waiting = WaitingCall(callId: callId, conversationId: conversationId, media: media)
        return Transition(next, [.showWaiting])
      case .userAnswerWaiting, .userDeclineWaiting, .waitingDeadline:
        return noop(s)
      default:
        return single(s, e)
      }
    }

    var cleared = s
    cleared.waiting = nil
    switch e {
    case let .ring(callId, _, _, stale):
      if callId == w.callId || stale { return noop(s) }
      if callId == s.callId { return carry(single(cleared, e), w) }
      return Transition(s, [.httpDeclineBusy(callId: callId)])

    case let .ringEnded(callId, _) where callId == w.callId:
      return Transition(cleared, [.dismissWaiting])
    case let .callFinished(callId, _) where callId == w.callId:
      return Transition(cleared, [.dismissWaiting])
    case .waitingDeadline:
      return Transition(cleared, [.dismissWaiting])
    case .userDeclineWaiting:
      return Transition(cleared, [.httpDeclineBusy(callId: w.callId), .dismissWaiting])

    case .userAnswerWaiting:
      // Leaving rings the waiting call (below); answering it at once
      // makes that ring a no-op the surface never sees.
      let left = transition(s, .userHangup)
      guard left.state.phase == .ringingIn, left.state.callId == w.callId else { return noop(s) }
      let answered = single(left.state, .userAnswer)
      let effects = (left.effects + answered.effects).filter { !ringSurfaceEffects.contains($0) }
      return Transition(answered.state, effects)

    default:
      let t = single(cleared, e)
      guard t.state.phase == .ended || t.state.phase == .idle else { return carry(t, w) }
      // The current call is over while another rings beside it: that
      // ring is now simply THE ring (no ended screen in between).
      let ringing = MachineState(phase: .ringingIn, callId: w.callId, conversationId: w.conversationId,
                                 direction: .incoming, media: w.media)
      return Transition(ringing, t.effects + [.promoteWaiting, .showRing, .ringtoneStart])
    }
  }

  private static func carry(_ t: Transition, _ w: WaitingCall) -> Transition {
    var state = t.state
    state.waiting = w
    return Transition(state, t.effects)
  }

  /// The one-call machine: everything that is not about a waiting call.
  private static func single(_ s: MachineState, _ e: Event) -> Transition {
    switch e {

    case let .ring(callId, conversationId, media, stale):
      return ring(s, callId: callId, conversationId: conversationId, media: media, stale: stale)

    case let .ringEnded(callId, _):
      if s.phase == .ringingIn && callId == s.callId {
        return Transition(.IDLE, [.ringtoneStop, .dismissRing])
      }
      return noop(s)

    case let .callFinished(callId, reason):
      guard callId == s.callId else { return noop(s) }
      switch s.phase {
      case .ringingIn:
        return Transition(.IDLE, [.ringtoneStop, .dismissRing])
      case .ringingOut:
        return Transition(s.with(phase: .ended, reason: .some(ringOutcome(reason))),
                          [.ringbackStop, .mediaLeave, .callSessionStop])
      case .active, .reconnecting, .connecting:
        return Transition(s.with(phase: .ended, reason: .some(.finished)), [.mediaLeave, .callSessionStop])
      case .ended:
        let outcome = ringOutcome(reason)
        if s.direction == .outgoing && s.reason == .finished && outcome != .finished {
          return Transition(s.with(reason: .some(outcome)), [])
        }
        return noop(s)
      default:
        return noop(s)
      }

    case .userAnswer:
      if s.phase == .ringingIn {
        return Transition(s.with(phase: .connecting, direction: .some(.incoming), httpAttempts: 1),
                          [.ringtoneStop, .dismissRing, .httpAnswer, .callSessionStart])
      }
      return noop(s)

    case .userDecline:
      if s.phase == .ringingIn {
        return Transition(.IDLE, [.ringtoneStop, .dismissRing, .httpDecline])
      }
      return noop(s)

    case let .userPlace(callId, conversationId, media):
      if s.phase == .idle || s.phase == .ended {
        return Transition(MachineState(phase: .connecting, callId: callId, conversationId: conversationId,
                                       direction: .outgoing, media: media, httpAttempts: 1),
                          [.httpPlace, .callSessionStart])
      }
      return noop(s)

    case let .userJoin(callId, conversationId):
      if s.phase == .idle || s.phase == .ended {
        return Transition(MachineState(phase: .connecting, callId: callId, conversationId: conversationId,
                                       direction: .joined, httpAttempts: 1),
                          [.httpJoin, .callSessionStart])
      }
      return noop(s)

    case .userHangup:
      switch s.phase {
      case .ringingOut:
        return Transition(s.with(phase: .ended, reason: .some(.cancelled)),
                          [.ringbackStop, .mediaLeave, .httpHangup, .callSessionStop])
      case .active, .reconnecting, .connecting:
        return Transition(s.with(phase: .ended, reason: .some(.left)),
                          [.mediaLeave, .httpHangup, .callSessionStop])
      default:
        return noop(s)
      }

    case let .httpOk(created):
      if s.phase != .connecting { return noop(s) }
      if s.direction == .outgoing && created {
        return Transition(s.with(phase: .ringingOut), [.mediaJoin, .ringbackStart])
      }
      if s.direction == .outgoing && !created {
        return Transition(s.with(direction: .some(.joined)), [.mediaJoin])
      }
      return Transition(s, [.mediaJoin])

    case .httpGone:
      switch s.phase {
      case .connecting:
        return Transition(s.with(phase: .ended, reason: .some(.finished)), [.callSessionStop])
      case .reconnecting:
        return Transition(s.with(phase: .ended, reason: .some(.left)), [.mediaLeave, .callSessionStop])
      default:
        return noop(s)
      }

    case .httpTimeout:
      if s.phase != .connecting { return noop(s) }
      if s.httpAttempts < 2 {
        let retry: Effect
        switch s.direction {
        case .outgoing?: retry = .httpPlace
        case .joined?: retry = .httpJoin
        default: retry = .httpAnswer
        }
        return Transition(s.with(httpAttempts: s.httpAttempts + 1), [retry])
      }
      return Transition(s.with(phase: .ended, reason: .some(.failed)), [.httpHangup, .callSessionStop])

    case .httpFailed:
      switch s.phase {
      case .connecting:
        return Transition(s.with(phase: .ended, reason: .some(.failed)), [.httpHangup, .callSessionStop])
      case .reconnecting:
        return Transition(s.with(phase: .ended, reason: .some(.failed)), [.mediaLeave, .callSessionStop])
      default:
        return noop(s)
      }

    case .connectTimeout:
      if s.phase == .connecting {
        return Transition(s.with(phase: .ended, reason: .some(.failed)),
                          [.mediaLeave, .httpHangup, .callSessionStop])
      }
      return noop(s)

    case .mediaConnected:
      switch s.phase {
      case .connecting, .reconnecting: return Transition(s.with(phase: .active), [])
      default: return noop(s)
      }

    case .mediaFailed:
      switch s.phase {
      case .connecting:
        return Transition(s.with(phase: .ended, reason: .some(.failed)), [.httpHangup, .callSessionStop])
      case .ringingOut:
        return Transition(s.with(phase: .ended, reason: .some(.failed)),
                          [.ringbackStop, .mediaLeave, .httpHangup, .callSessionStop])
      default:
        return noop(s)
      }

    case .mediaLost:
      switch s.phase {
      case .active: return Transition(s.with(phase: .reconnecting), [.httpReconnect])
      case .reconnecting: return Transition(s, [.httpReconnect])
      default: return noop(s)
      }

    case .mediaReconnecting:
      return s.phase == .active ? Transition(s.with(phase: .reconnecting), []) : noop(s)

    case .mediaRecovered:
      return s.phase == .reconnecting ? Transition(s.with(phase: .active), []) : noop(s)

    case .remoteJoined:
      return s.phase == .ringingOut ? Transition(s.with(phase: .active), [.ringbackStop]) : noop(s)

    case let .allRingsResolved(outcome):
      guard s.phase == .ringingOut else { return noop(s) }
      let reason: EndReason
      switch outcome {
      case "busy_all": reason = .busyAll
      case "no_answer": reason = .noAnswer
      case "cancelled": reason = .cancelled
      default: reason = .declinedAll
      }
      return Transition(s.with(phase: .ended, reason: .some(reason)),
                        [.ringbackStop, .mediaLeave, .httpHangup, .callSessionStop])

    case .ringDeadline:
      return s.phase == .ringingIn ? Transition(.IDLE, [.ringtoneStop, .dismissRing]) : noop(s)

    case .reconnectBudgetElapsed:
      if s.phase == .reconnecting {
        return Transition(s.with(phase: .ended, reason: .some(.connectionLost)),
                          [.mediaLeave, .httpHangup, .callSessionStop])
      }
      return noop(s)

    case .lingerElapsed:
      return s.phase == .ended ? Transition(.IDLE, []) : noop(s)

    case .userAnswerWaiting, .userDeclineWaiting, .waitingDeadline:
      return noop(s) // handled by `transition`, which owns the waiting slot
    }
  }

  private static func ring(_ s: MachineState, callId: String, conversationId: String?, media: String,
                           stale: Bool) -> Transition {
    if stale { return noop(s) }
    // Already showing this very ring (push + socket race): one surface.
    if s.phase == .ringingIn && callId == s.callId { return noop(s) }
    // A fresh ring on idle — or over a lingering ended screen.
    if s.phase == .idle || s.phase == .ended {
      return Transition(MachineState(phase: .ringingIn, callId: callId, conversationId: conversationId,
                                     direction: .incoming, media: media),
                        [.showRing, .ringtoneStart])
    }
    // Busy ringing another call (a call in progress holds it waiting
    // instead — see `transition`): auto-decline the newcomer.
    return Transition(s, [.httpDeclineBusy(callId: callId)])
  }

  /// A finish push's reason, read as the caller's unanswered outcome.
  private static func ringOutcome(_ reason: String?) -> EndReason {
    switch reason {
    case "no_answer"?, "timeout"?: return .noAnswer
    case "declined_all"?, "declined"?: return .declinedAll
    case "busy_all"?: return .busyAll
    case "cancelled"?: return .cancelled
    default: return .finished
    }
  }

  private static func noop(_ s: MachineState) -> Transition { Transition(s, []) }
}
