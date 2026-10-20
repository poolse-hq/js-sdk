import CallKit
import Foundation
import PushKit
import UIKit

/// Native PushKit intake — the iOS twin of CallMessagingService. The
/// registry is created at launch (PoolseCallsAppDelegateSubscriber →
/// `PoolseCallsSetup.registerVoipEarly()`), long before JS, so a VoIP push that
/// wakes a killed app is reported to CallKit natively within PushKit's
/// budget.
///
/// Contract with iOS: EVERY VoIP push reports a call to CallKit
/// synchronously, before `completion()` — stale, duplicate, control or
/// unparseable ones included (reported, then ended `.failed`). Breaking
/// it gets the app killed and, repeated, VoIP delivery revoked.
final class VoipPush: NSObject, PKPushRegistryDelegate {
  static let shared = VoipPush()

  private var registry: PKPushRegistry?
  private let lock = NSLock()
  private var _token: String?

  /// The current VoIP token (hex), readable from any thread.
  var token: String? {
    lock.lock(); defer { lock.unlock() }
    return _token
  }

  /// The bridge's token subscriber (process-level, like CallCore.listener).
  static var tokenListener: ((String) -> Void)?

  /// Idempotent. Main thread.
  func register() {
    guard registry == nil else { return }
    _ = CallKitController.shared // the provider must exist before any push
    let r = PKPushRegistry(queue: .main)
    r.delegate = self
    r.desiredPushTypes = [.voIP]
    registry = r
    if let data = r.pushToken(for: .voIP) { setToken(data) }
  }

  private func setToken(_ data: Data) {
    let hex = data.map { String(format: "%02x", $0) }.joined()
    lock.lock(); _token = hex; lock.unlock()
    VoipPush.tokenListener?(hex)
  }

  // MARK: - PKPushRegistryDelegate

  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    setToken(pushCredentials.token)
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    guard type == .voIP else { return }
    lock.lock(); _token = nil; lock.unlock()
  }

  func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload,
                    for type: PKPushType, completion: @escaping () -> Void) {
    pcTrace("VoIP push received appState=\(UIApplication.shared.applicationState.rawValue)")
    if type == .voIP { handle(payload.dictionaryPayload) }
    completion()
  }

  // MARK: - handling

  private func handle(_ raw: [AnyHashable: Any]) {
    let ck = CallKitController.shared
    let p = VoipPayload(raw)
    let core = CallCore.getOrNull()

    switch p.event {
    case "ring_ended", "finished":
      // A control push on the VoIP channel still has to report a call.
      ck.reportAndFail(callId: p.callId, title: p.title)
      guard let core = core, let callId = p.callId else { return }
      if p.event == "ring_ended" { core.onRingEnded(callId: callId, reason: p.reason ?? "finished") }
      else { core.onCallFinished(callId: callId, reason: p.reason) }
    default:
      guard let ring = p.ringContext() else {
        ck.reportAndFail(callId: p.callId, title: p.title)
        return
      }
      guard let core = core, core.isRingLive(ring) else {
        ck.reportAndFail(callId: ring.callId, title: p.title)
        return
      }
      ck.reportIncoming(ring: ring)
      core.onRing(ring)
      // A ring the machine did not take (busy, superseded) must not stay
      // on the CallKit screen: reconcile once the ring is processed.
      core.reconcileCallKitSoon()
    }
  }
}

/// Lenient VoIP payload reader: top-level keys, or nested under `data` /
/// `payload` / `call`; strings, numbers or bools for any field.
struct VoipPayload {
  private let fields: [String: Any]

  init(_ raw: [AnyHashable: Any]) {
    var out: [String: Any] = [:]
    for nest in ["data", "payload", "call"] {
      if let inner = raw[nest] as? [AnyHashable: Any] {
        for (k, v) in inner { if let k = k as? String { out[k] = v } }
      } else if let s = raw[nest] as? String, let d = s.data(using: .utf8),
                let inner = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
        for (k, v) in inner { out[k] = v }
      }
    }
    for (k, v) in raw { if let k = k as? String, !(v is [AnyHashable: Any]) { out[k] = v } }
    fields = out
  }

  func string(_ key: String) -> String? {
    switch fields[key] {
    case let s as String: return s.isEmpty ? nil : s
    case let n as NSNumber: return n.stringValue
    default: return nil
    }
  }

  func int64(_ key: String) -> Int64? {
    switch fields[key] {
    case let n as NSNumber: return n.int64Value
    case let s as String: return Int64(s) ?? Double(s).map { Int64($0) }
    default: return nil
    }
  }

  func bool(_ key: String) -> Bool? {
    switch fields[key] {
    case let n as NSNumber: return n.boolValue
    case let s as String: return ["1", "true", "yes"].contains(s.lowercased())
    default: return nil
    }
  }

  var callId: String? { string("call_id") }
  var event: String? { string("event") }
  var reason: String? { string("reason") }
  var title: String? { string("conversation_name") ?? string("caller_name") }

  var media: String {
    if let m = string("media")?.lowercased(), m == "video" || m == "audio" { return m }
    return bool("has_video") == true ? "video" : "audio"
  }

  /// Epoch ms; a seconds value (< 1e12) is scaled. Missing: sent_at (or
  /// now) + 60 s — the server's ring_ended(timeout) is the real cut-off.
  private var deadlineMs: Int64 {
    func ms(_ v: Int64) -> Int64 { v < 1_000_000_000_000 ? v * 1000 : v }
    if let d = int64("ring_deadline"), d > 0 { return ms(d) }
    let base = int64("sent_at").map(ms) ?? Int64(Date().timeIntervalSince1970 * 1000)
    return base + 60_000
  }

  func ringContext() -> RingContext? {
    guard let callId = callId, let conversationId = string("conversation_id"), let grant = string("grant") else { return nil }
    return RingContext(
      callId: callId,
      conversationId: conversationId,
      conversationName: string("conversation_name"),
      callerName: string("caller_name"),
      media: media,
      grant: grant,
      ringDeadlineEpochMs: deadlineMs
    )
  }
}
