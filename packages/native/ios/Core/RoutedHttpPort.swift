import Foundation

/// One HttpPort for several API servers (signed in to several
/// workspaces): each request goes to the server its call belongs to.
/// Direct port of RoutedHttpPort.kt.
///
/// The runtime stays single-server — it only knows call ids. The platform
/// binds each call to its server as it enters (a ring's `serverId`, a
/// place/join with the host's server id), and this port looks the call up
/// per request. A placed call is keyed by its conversation until the
/// server mints its id; the answer binds that id too. Unbound calls go to
/// the default server (nil), which is all a single-server app ever has.
///
/// Thread-safe: rings are bound from PushKit, requests run on main.
public final class RoutedHttpPort: HttpPort {
  private static let pending = "pending:"
  private static let maxBound = 64

  private let portFor: (String?) -> HttpPort
  private let lock = NSLock()
  private var calls: [(callId: String, serverId: String)] = []
  private var places: [String: String] = [:]

  /// `portFor`: the HTTP port of one server (nil = the default one).
  public init(portFor: @escaping (String?) -> HttpPort) {
    self.portFor = portFor
  }

  /// The call `callId` belongs to `serverId` (nil forgets it: the default server).
  public func bindCall(_ callId: String, serverId: String?) {
    lock.lock(); defer { lock.unlock() }
    calls.removeAll { $0.callId == callId }
    guard let serverId = serverId else { return }
    calls.append((callId, serverId))
    if calls.count > Self.maxBound { calls.removeFirst(calls.count - Self.maxBound) }
  }

  /// The next call placed on `conversationId` goes to `serverId`.
  public func bindPlace(_ conversationId: String, serverId: String?) {
    lock.lock(); defer { lock.unlock() }
    places[conversationId] = serverId
    if places.count > Self.maxBound, let any = places.keys.first(where: { $0 != conversationId }) {
      places.removeValue(forKey: any)
    }
  }

  /// The server `callId` is bound to (a `pending:<conversation>` id: its place); nil = the default.
  public func serverFor(_ callId: String) -> String? {
    lock.lock(); defer { lock.unlock() }
    if callId.hasPrefix(Self.pending) { return places[String(callId.dropFirst(Self.pending.count))] }
    return calls.last { $0.callId == callId }?.serverId
  }

  public func answer(callId: String, grant: String, cb: @escaping (HttpResult) -> Void) {
    portFor(serverFor(callId)).answer(callId: callId, grant: grant, cb: cb)
  }

  public func join(callId: String, sessionToken: String, cb: @escaping (HttpResult) -> Void) {
    portFor(serverFor(callId)).join(callId: callId, sessionToken: sessionToken, cb: cb)
  }

  public func place(conversationId: String, media: String, sessionToken: String,
                    cb: @escaping (HttpResult) -> Void) {
    lock.lock(); let server = places[conversationId]; lock.unlock()
    portFor(server).place(conversationId: conversationId, media: media, sessionToken: sessionToken) { [weak self] result in
      // Everything after the answer (hangup, reconnect) names the minted id.
      if case let .ok(bundle) = result { self?.bindCall(bundle.callId, serverId: server) }
      cb(result)
    }
  }

  public func decline(callId: String, auth: String, busy: Bool) {
    portFor(serverFor(callId)).decline(callId: callId, auth: auth, busy: busy)
  }

  public func hangup(callId: String, controlToken: String) {
    portFor(serverFor(callId)).hangup(callId: callId, controlToken: controlToken)
  }

  public func reconnect(current: CallSessionBundle, cb: @escaping (HttpResult) -> Void) {
    portFor(serverFor(current.callId)).reconnect(current: current, cb: cb)
  }
}
