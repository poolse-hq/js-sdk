import Foundation

// The seams between the pure machine and the platform. Direct port of
// android/.../callcore/Ports.kt (plus the state value types from
// CallMachine.kt). Everything is main-thread confined: adapters may call
// back from any thread — the runtime hops onto DispatchQueue.main.

// MARK: - HTTP (CONTRACT.md §4 — the three doors)

public protocol HttpPort: AnyObject {
  /// POST /calls/:id/answer with the ring grant.
  func answer(callId: String, grant: String, cb: @escaping (HttpResult) -> Void)
  /// POST /calls/:id/join with a session token.
  func join(callId: String, sessionToken: String, cb: @escaping (HttpResult) -> Void)
  /// POST /conversations/:id/calls with a session token.
  func place(conversationId: String, media: String, sessionToken: String, cb: @escaping (HttpResult) -> Void)
  /// POST /calls/:id/decline — grant or session; fire-and-forget with retry.
  func decline(callId: String, auth: String, busy: Bool)
  /// POST /calls/:id/hangup with the call-control token; fire-and-forget with retry.
  func hangup(callId: String, controlToken: String)
  /// POST /calls/:id/reconnect with the call-control token. Answers with the
  /// FULL bundle; `current` lets an older server's `{livekit:{url,token}}`
  /// refresh be applied onto it.
  func reconnect(current: CallSessionBundle, cb: @escaping (HttpResult) -> Void)
}

public enum HttpResult: Equatable {
  /// 2xx: the CallSessionBundle (or reconnect's token refresh).
  case ok(CallSessionBundle)
  /// 404/410 — the call is finished (or this device was superseded).
  case gone
  /// Timeout / transient network failure.
  case timeout
  /// 401/403 — grant spent, expired, or wrong device. Terminal.
  case authFailed(code: String)
  /// Terminal but not auth: 503, another 4xx, or an unparseable 2xx.
  case failed(code: String)
}

public struct CallSessionBundle: Equatable {
  public var callId: String
  public var conversationId: String
  public var conversationName: String?
  public var media: String
  public var created: Bool
  public var livekitUrl: String
  public var livekitToken: String
  public var controlToken: String
  /// `room` (rings nobody, CONTRACT.md §5.6) or `call`.
  public var kind: String

  public init(callId: String, conversationId: String, conversationName: String?, media: String,
              created: Bool, livekitUrl: String, livekitToken: String, controlToken: String,
              kind: String = "call") {
    self.callId = callId
    self.conversationId = conversationId
    self.conversationName = conversationName
    self.media = media
    self.created = created
    self.livekitUrl = livekitUrl
    self.livekitToken = livekitToken
    self.controlToken = controlToken
    self.kind = kind
  }
}

// MARK: - Media

/// LiveKit (or any SFU) — media only, no lifecycle opinions.
public protocol MediaPort: AnyObject {
  func join(bundle: CallSessionBundle)
  func leave()
  func setMuted(_ muted: Bool)
  func setCamera(_ on: Bool)
  func switchCamera()
  /// Loudspeaker (`true`) or back to the private route (`false`).
  func setSpeaker(_ on: Bool)
  /// Play through one specific output — an id from `Snapshot.audioOutputs`.
  func setAudioOutput(_ id: String)
}

public extension MediaPort {
  /// Engines without device selection fall back to the speaker toggle.
  func setAudioOutput(_ id: String) { setSpeaker(id == "speaker") }
}

// MARK: - Ring surface

/// The ring UX. iOS: CallKit report + tones.
public protocol RingSurfacePort: AnyObject {
  func show(ring: RingContext)
  func dismiss(callId: String)
  func ringtoneStart()
  func ringtoneStop()
  func ringbackStart()
  func ringbackStop()
}

public struct RingContext: Equatable {
  public var callId: String
  public var conversationId: String
  public var conversationName: String?
  public var callerName: String?
  public var media: String
  public var grant: String
  public var ringDeadlineEpochMs: Int64

  public init(callId: String, conversationId: String, conversationName: String?, callerName: String?,
              media: String, grant: String, ringDeadlineEpochMs: Int64) {
    self.callId = callId
    self.conversationId = conversationId
    self.conversationName = conversationName
    self.callerName = callerName
    self.media = media
    self.grant = grant
    self.ringDeadlineEpochMs = ringDeadlineEpochMs
  }
}

// MARK: - Session / snapshots / time

/// Android: the phoneCall foreground service. iOS: the CallKit session / audio session.
public protocol CallSessionPort: AnyObject {
  func start(callId: String, media: String)
  func stop()
}

/// Snapshots out — the bridge turns these into JS events (IDLE → null).
public protocol SnapshotSink: AnyObject {
  func emit(state: MachineState)
}

/// Closure-backed SnapshotSink convenience.
public final class BlockSnapshotSink: SnapshotSink {
  private let block: (MachineState) -> Void
  public init(_ block: @escaping (MachineState) -> Void) { self.block = block }
  public func emit(state: MachineState) { block(state) }
}

/// Time, injectable: real adapter uses DispatchQueue.main; tests a fake.
public protocol TimerPort: AnyObject {
  func nowMs() -> Int64
  /// Scheduling an existing key replaces it.
  func schedule(key: String, delayMs: Int64, fire: @escaping () -> Void)
  func cancel(key: String)
}

// MARK: - Machine state value types (CallMachine.kt)

public enum Phase: String, CaseIterable {
  case idle = "IDLE"
  case ringingIn = "RINGING_IN"
  case ringingOut = "RINGING_OUT"
  case connecting = "CONNECTING"
  case active = "ACTIVE"
  case reconnecting = "RECONNECTING"
  case ended = "ENDED"
}

public enum Direction: String {
  case incoming = "INCOMING"
  case outgoing = "OUTGOING"
  case joined = "JOINED"
}

public enum EndReason: String {
  case left = "LEFT"
  case finished = "FINISHED"
  case declinedAll = "DECLINED_ALL"
  case busyAll = "BUSY_ALL"
  case noAnswer = "NO_ANSWER"
  case cancelled = "CANCELLED"
  case connectionLost = "CONNECTION_LOST"
  case failed = "FAILED"

  /// Wire form: lowercase snake (e.g. "declined_all").
  public var wire: String { rawValue.lowercased() }
}

/// Everything the machine knows. Immutable value; transitions return a new one.
public struct MachineState: Equatable {
  public var phase: Phase
  public var callId: String?
  public var conversationId: String?
  public var direction: Direction?
  public var media: String
  public var reason: EndReason?
  /// HTTP attempts made for the current connecting request (retry budget = 2).
  public var httpAttempts: Int

  public init(phase: Phase = .idle, callId: String? = nil, conversationId: String? = nil,
              direction: Direction? = nil, media: String = "audio", reason: EndReason? = nil,
              httpAttempts: Int = 0) {
    self.phase = phase
    self.callId = callId
    self.conversationId = conversationId
    self.direction = direction
    self.media = media
    self.reason = reason
    self.httpAttempts = httpAttempts
  }

  public static var IDLE: MachineState { MachineState() }
}
