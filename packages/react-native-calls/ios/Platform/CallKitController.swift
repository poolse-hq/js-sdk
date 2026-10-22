import AVFoundation
import CallKit
import Foundation
import UIKit

/// What CallKit's provider actions mean to the call core. Implemented by
/// `CallCore`; absent (never configured) the controller only keeps
/// CallKit consistent and fails what it cannot honour.
protocol CallKitActions: AnyObject {
  func callKitAnswer(callId: String)
  func callKitEnd(callId: String)
  func callKitSetMuted(callId: String, muted: Bool)
  func callKitAudioActivated(_ session: AVAudioSession)
  func callKitAudioDeactivated(_ session: AVAudioSession)
  func callKitReset()
  /// "Hold & Accept" on the call-waiting screen: true if `callId` is the
  /// current call with another waiting (it will be ENDED, not held).
  func callKitHoldForWaiting(callId: String) -> Bool
}

/// The iOS ring surface + call session: one CXProvider for the process.
///
/// CallKit is the source of truth for the system UI only; the call core
/// is the source of truth for the call. Every provider action is
/// forwarded to the core, and `CallCore` reconciles CallKit against each
/// final snapshot (answer started from JS, outgoing connected, every
/// terminal path) — so whatever ends a call, CallKit is told exactly once
/// with the right reason.
///
/// Main thread only (the provider delegate queue is main, PushKit's queue
/// is main, the runtime runs on main).
final class CallKitController: NSObject, CXProviderDelegate {
  static let shared = CallKitController()

  final class Tracked {
    let uuid: UUID
    var callId: String
    let outgoing: Bool
    var hasVideo: Bool
    var title: String?
    /// Answered (incoming) — by the CallKit UI or a request we made.
    var answered = false
    /// CallKit has been told it ended (or is being told).
    var ended = false
    var connectedReported = false

    init(uuid: UUID, callId: String, outgoing: Bool, hasVideo: Bool, title: String?) {
      self.uuid = uuid
      self.callId = callId
      self.outgoing = outgoing
      self.hasVideo = hasVideo
      self.title = title
    }
  }

  let provider: CXProvider
  private let controller = CXCallController()
  private var calls: [UUID: Tracked] = [:]

  weak var actions: CallKitActions?

  private override init() {
    // init(localizedName:) is deprecated (iOS 14 reads the bundle's
    // display name) but still honoured; the label is the product's.
    let config = CXProviderConfiguration(localizedName: "Loop")
    config.supportsVideo = true
    // Two groups: room for a second call to ring beside the live one, so
    // iOS presents its call-waiting screen (End & Accept / Decline). With
    // one, a second call rang as a plain Accept/Decline that silently
    // ended the first. There is never a second call in progress — Loop
    // cannot hold: answering one ends the other (`callKitHoldForWaiting`).
    config.maximumCallGroups = 2
    config.maximumCallsPerCallGroup = 1
    config.supportedHandleTypes = [.generic]
    config.includesCallsInRecents = false
    if let icon = UIImage(named: "CallKitIcon")?.pngData() { config.iconTemplateImageData = icon }
    provider = CXProvider(configuration: config)
    super.init()
    provider.setDelegate(self, queue: nil) // nil = main queue
  }

  // MARK: - lookup

  func tracked(callId: String) -> Tracked? {
    calls.values.first { $0.callId == callId && !$0.ended }
  }

  var liveCalls: [Tracked] { calls.values.filter { !$0.ended } }

  // MARK: - incoming

  /// Report a live ring. MUST run synchronously inside PushKit's
  /// didReceiveIncomingPush. A ring already reported (push redelivery,
  /// or the runtime's SHOW_RING after the push path) is re-reported with
  /// the SAME UUID: CallKit rejects it as a duplicate and nothing changes,
  /// which still satisfies PushKit's "report a call for every push".
  /// Put the shared session in the call's category BEFORE CallKit activates
  /// it — at ring time, in the answer action, in the start action (Apple's
  /// CallKit sample does the same). Setting the category does not activate
  /// anything. Without it the session is still the default
  /// SoloAmbientSound when CallKit activates it, and with the phone locked
  /// and the app in the background iOS REFUSES that activation (seen in a
  /// device log as an activate "early exit due to failure", -16980): no
  /// didActivate, so no audio at all on a call answered with the app closed.
  static func prepareSessionForCall(video: Bool) {
    let s = AVAudioSession.sharedInstance()
    let mode: AVAudioSession.Mode = video ? .videoChat : .voiceChat
    guard s.category != .playAndRecord || s.mode != mode else { return }
    do {
      try s.setCategory(.playAndRecord, mode: mode, options: [.allowBluetooth, .allowBluetoothA2DP])
    } catch {
      NSLog("[PoolseCalls] pre-activation category failed: %@", "\(error)")
    }
  }

  func reportIncoming(ring: RingContext) {
    let hasVideo = ring.media == "video"
    let title = ring.conversationName ?? ring.callerName
    if let existing = calls.values.first(where: { $0.callId == ring.callId && !$0.ended }) {
      provider.reportNewIncomingCall(with: existing.uuid, update: update(title: title, handle: ring.conversationId, video: hasVideo)) { _ in }
      return
    }
    let t = Tracked(uuid: UUID(), callId: ring.callId, outgoing: false, hasVideo: hasVideo, title: title)
    // A call waiting beside a live one must not touch the live call's
    // session (a voice ring switched a video call's mode, and its route).
    let beside = !liveCalls.isEmpty
    calls[t.uuid] = t
    pcTrace("CallKit report incoming \(ring.callId) beside=\(beside) live=\(liveCalls.count)")
    if !beside { Self.prepareSessionForCall(video: hasVideo) }
    provider.reportNewIncomingCall(with: t.uuid, update: update(title: title, handle: ring.conversationId, video: hasVideo)) { [weak self] error in
      guard let error = error else { return }
      pcTrace("CallKit refused incoming \(ring.callId): \(error.localizedDescription)")
      NSLog("[PoolseCalls] CallKit refused incoming call %@: %@", ring.callId, error.localizedDescription)
      // Refused (DND, blocked, busy group): CallKit holds nothing for it.
      // End the ring in the core too — silently (no decline is sent), so
      // the engine is not left RINGING_IN with no UI, counting as busy.
      DispatchQueue.main.async {
        t.ended = true
        self?.calls.removeValue(forKey: t.uuid)
        // A refused call-waiting report: the caller would ring on into
        // a void — turn it away as busy instead.
        if let core = CallCore.peek(), core.isWaiting(ring.callId) {
          core.declineWaiting(callId: ring.callId)
        } else {
          CallCore.peek()?.onRingEnded(callId: ring.callId, reason: "cancelled")
        }
      }
    }
  }

  /// A push that must not ring (stale, duplicate of a resolved call,
  /// unparseable, a control event): report it — iOS kills an app that
  /// does not — then end it at once. A push for a call CallKit is still
  /// showing reuses its UUID, so the live call is untouched.
  func reportAndFail(callId: String?, title: String?) {
    if let callId = callId, let existing = calls.values.first(where: { $0.callId == callId && !$0.ended }) {
      provider.reportNewIncomingCall(with: existing.uuid, update: update(title: existing.title, handle: callId, video: existing.hasVideo)) { _ in }
      return
    }
    let uuid = UUID()
    provider.reportNewIncomingCall(with: uuid, update: update(title: title, handle: callId ?? "loop", video: false)) { [weak self] error in
      if error == nil { self?.provider.reportCall(with: uuid, endedAt: nil, reason: .failed) }
    }
  }

  // MARK: - outgoing

  /// Start an outgoing (placed or joined) call in CallKit. CallKit then
  /// activates the audio session for it. `onFailure` runs if CallKit
  /// refuses the transaction (the call proceeds without CallKit).
  func startOutgoing(callId: String, handle: String, title: String?, video: Bool, onFailure: @escaping () -> Void) {
    if tracked(callId: callId) != nil { return }
    let t = Tracked(uuid: UUID(), callId: callId, outgoing: true, hasVideo: video, title: title)
    calls[t.uuid] = t
    let action = CXStartCallAction(call: t.uuid, handle: CXHandle(type: .generic, value: handle))
    action.isVideo = video
    action.contactIdentifier = title
    controller.request(CXTransaction(action: action)) { [weak self] error in
      DispatchQueue.main.async {
        guard let error = error else {
          if let title = t.title { self?.provider.reportCall(with: t.uuid, updated: self?.update(title: title, handle: handle, video: video) ?? CXCallUpdate()) }
          return
        }
        NSLog("[PoolseCalls] CallKit start refused: %@", error.localizedDescription)
        t.ended = true
        self?.calls.removeValue(forKey: t.uuid)
        onFailure()
      }
    }
  }

  /// `pending:<conversation>` → the server-minted id: the same call.
  func rename(from old: String, to new: String) {
    tracked(callId: old)?.callId = new
  }

  func reportConnected(callId: String) {
    guard let t = tracked(callId: callId), t.outgoing, !t.connectedReported else { return }
    t.connectedReported = true
    provider.reportOutgoingCall(with: t.uuid, connectedAt: nil)
  }

  func updateTitle(callId: String, title: String?, video: Bool) {
    guard let t = tracked(callId: callId), let title = title, title != t.title || video != t.hasVideo else { return }
    t.title = title
    t.hasVideo = video
    provider.reportCall(with: t.uuid, updated: update(title: title, handle: nil, video: video))
  }

  // MARK: - requests from the app (JS buttons)

  /// The app answered from its own UI: tell CallKit (it activates audio).
  func requestAnswer(callId: String) {
    guard let t = tracked(callId: callId), !t.outgoing, !t.answered else { return }
    t.answered = true
    controller.request(CXTransaction(action: CXAnswerCallAction(call: t.uuid))) { error in
      if let error = error { NSLog("[PoolseCalls] CallKit answer refused: %@", error.localizedDescription) }
    }
  }

  func requestMute(callId: String, muted: Bool) {
    guard let t = tracked(callId: callId) else { return }
    controller.request(CXTransaction(action: CXSetMutedCallAction(call: t.uuid, muted: muted))) { _ in }
  }

  /// End a call in CallKit. `reason` nil = ended locally (a user action
  /// in our UI) → an end transaction; otherwise the call ended remotely
  /// or failed → reported with that reason.
  func end(_ t: Tracked, reason: CXCallEndedReason?) {
    guard !t.ended else { return }
    t.ended = true
    if let reason = reason {
      provider.reportCall(with: t.uuid, endedAt: nil, reason: reason)
      calls.removeValue(forKey: t.uuid)
    } else {
      controller.request(CXTransaction(action: CXEndCallAction(call: t.uuid))) { [weak self] error in
        DispatchQueue.main.async {
          if error != nil { self?.provider.reportCall(with: t.uuid, endedAt: nil, reason: .remoteEnded) }
          self?.calls.removeValue(forKey: t.uuid)
        }
      }
    }
  }

  private func update(title: String?, handle: String?, video: Bool) -> CXCallUpdate {
    let u = CXCallUpdate()
    if let handle = handle { u.remoteHandle = CXHandle(type: .generic, value: handle) }
    u.localizedCallerName = title ?? "Loop"
    u.hasVideo = video
    u.supportsHolding = false
    u.supportsGrouping = false
    u.supportsUngrouping = false
    u.supportsDTMF = false
    return u
  }

  // MARK: - CXProviderDelegate

  func providerDidReset(_ provider: CXProvider) {
    for t in calls.values { t.ended = true }
    calls.removeAll()
    actions?.callKitReset()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    let found = calls[action.callUUID]
    pcTrace("CallKit answer action \(found?.callId ?? "unknown") live=\(liveCalls.count)")
    guard let t = found, !t.ended else { action.fail(); return }
    let fromUs = t.answered
    t.answered = true
    // Before fulfil: CallKit activates the session right after.
    Self.prepareSessionForCall(video: t.hasVideo)
    if !fromUs {
      guard let actions = actions else { action.fail(); return }
      actions.callKitAnswer(callId: t.callId)
    }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    pcTrace("CallKit end action \(calls[action.callUUID]?.callId ?? "unknown") live=\(liveCalls.count)")
    guard let t = calls[action.callUUID] else { action.fulfill(); return }
    let fromUs = t.ended
    t.ended = true
    calls.removeValue(forKey: t.uuid)
    if !fromUs { actions?.callKitEnd(callId: t.callId) }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    guard let t = calls[action.callUUID] else { action.fail(); return }
    Self.prepareSessionForCall(video: t.hasVideo)
    provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: nil)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    if let t = calls[action.callUUID] { actions?.callKitSetMuted(callId: t.callId, muted: action.isMuted) }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
    let t = calls[action.callUUID]
    pcTrace("CallKit held action \(t?.callId ?? "unknown") onHold=\(action.isOnHold)")
    // No hold, one call at a time. "Hold & Accept" on the call-waiting
    // screen holds this call and answers the other: here the answer that
    // follows ENDS this one (end-and-answer), so the hold is honoured as
    // that. Already gone (the answer came first and ended it): nothing to do.
    guard let t = t else { action.fulfill(); return }
    if action.isOnHold, actions?.callKitHoldForWaiting(callId: t.callId) == true {
      action.fulfill()
    } else {
      action.fail()
    }
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    pcTrace("CallKit didActivate \(pcSessionDescription(audioSession))")
    actions?.callKitAudioActivated(audioSession)
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    pcTrace("CallKit didDeactivate")
    actions?.callKitAudioDeactivated(audioSession)
  }
}
