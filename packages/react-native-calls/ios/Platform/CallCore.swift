import AVFoundation
import CallKit
import Foundation
import UIKit

/// The host-supplied configuration, persisted so a PushKit cold wake
/// (no JS, no configure call) rebuilds the same core from disk.
struct CallCoreConfig {
  var apiBaseUrl: String
  var ringback: String?
  /// `production` | `sandbox` — the APNs environment the VoIP token
  /// belongs to. Not reliably readable at runtime, so the host says it.
  var apnsEnvironment: String?
}

/// The composition root and the single native entry point — CallCore.kt
/// for iOS. PushKit, CallKit's provider actions and the React Native
/// bridge all come through here: one runtime, one answer/decline path.
///
/// It also owns what the pure machine does not carry but a truthful
/// snapshot needs (roster, conversation name, self mute/camera, audio
/// route), and reconciles CallKit against every final snapshot.
///
/// Main thread only, except `snapshot()` / `peek()`.
final class CallCore {
  // MARK: statics

  private static let defaults = UserDefaults(suiteName: "dev.poolse.callcore") ?? .standard
  private static let configLock = NSLock()
  private static var _config: CallCoreConfig?
  private static var instance: CallCore?

  static var config: CallCoreConfig? {
    configLock.lock(); defer { configLock.unlock() }
    return _config
  }

  /// The bridge's snapshot subscriber; process-level so JS may subscribe before configure.
  static var listener: (([String: Any]?) -> Void)?

  /// Configure and PERSIST (see CallCore.kt). Re-configuring swaps in place:
  /// HTTP and the ringback read the config per use.
  static func configure(apiBaseUrl: String, ringback: String?, apnsEnvironment: String?) {
    let trimmed = apiBaseUrl.hasSuffix("/") ? String(apiBaseUrl.dropLast()) : apiBaseUrl
    defaults.set(trimmed, forKey: "apiBaseUrl")
    defaults.set(ringback, forKey: "ringback")
    defaults.set(apnsEnvironment, forKey: "apnsEnvironment")
    writeConfigFile(apiBaseUrl: trimmed, ringback: ringback, apnsEnvironment: apnsEnvironment)
    configLock.lock()
    _config = CallCoreConfig(apiBaseUrl: trimmed, ringback: ringback, apnsEnvironment: apnsEnvironment)
    configLock.unlock()
  }

  /// The APNs environment last configured (persisted), if any.
  static var apnsEnvironment: String? {
    config?.apnsEnvironment ?? defaults.string(forKey: "apnsEnvironment") ?? readConfigFile()?.apnsEnvironment
  }

  private static func restoreConfig() {
    guard config == nil else { return }
    let restored: CallCoreConfig
    if let url = defaults.string(forKey: "apiBaseUrl") {
      restored = CallCoreConfig(apiBaseUrl: url,
                                ringback: defaults.string(forKey: "ringback"),
                                apnsEnvironment: defaults.string(forKey: "apnsEnvironment"))
    } else if let fromFile = readConfigFile() {
      // Locked since reboot: UserDefaults is unreadable before first
      // unlock, the unprotected file is not.
      restored = fromFile
    } else {
      return
    }
    configLock.lock()
    _config = restored
    configLock.unlock()
  }

  // MARK: config file (readable before first unlock)

  /// Application Support/dev.poolse.callcore/config.json, written with
  /// FileProtectionType.none so a PushKit wake while the device has been
  /// locked since reboot can still rebuild the core. Holds no secrets —
  /// only the API origin, a sound name and the APNs environment.
  private static var configFileURL: URL? {
    guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
    return base.appendingPathComponent("dev.poolse.callcore", isDirectory: true).appendingPathComponent("config.json")
  }

  private static func writeConfigFile(apiBaseUrl: String, ringback: String?, apnsEnvironment: String?) {
    guard let url = configFileURL else { return }
    var obj: [String: Any] = ["apiBaseUrl": apiBaseUrl]
    if let ringback = ringback { obj["ringback"] = ringback }
    if let apnsEnvironment = apnsEnvironment { obj["apnsEnvironment"] = apnsEnvironment }
    do {
      let fm = FileManager.default
      let dir = url.deletingLastPathComponent()
      try fm.createDirectory(at: dir, withIntermediateDirectories: true,
                             attributes: [.protectionKey: FileProtectionType.none])
      let data = try JSONSerialization.data(withJSONObject: obj)
      try data.write(to: url, options: [.atomic, .noFileProtection])
      try? fm.setAttributes([.protectionKey: FileProtectionType.none], ofItemAtPath: url.path)
    } catch {
      NSLog("[PoolseCalls] config file write failed: %@", "\(error)")
    }
  }

  private static func readConfigFile() -> CallCoreConfig? {
    guard let url = configFileURL, let data = try? Data(contentsOf: url),
          let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let api = obj["apiBaseUrl"] as? String, !api.isEmpty else { return nil }
    return CallCoreConfig(apiBaseUrl: api, ringback: obj["ringback"] as? String,
                          apnsEnvironment: obj["apnsEnvironment"] as? String)
  }

  /// The core, or nil if this install was never configured. Main thread.
  static func getOrNull() -> CallCore? {
    if let i = instance { return i }
    restoreConfig()
    guard config != nil else { return nil }
    let core = CallCore()
    instance = core
    return core
  }

  /// The live core if one exists — never creates.
  static func peek() -> CallCore? { instance }

  // MARK: parts

  private let callKit = CallKitController.shared
  private var mediaPort: LiveKitMediaPort!
  private var runtime: CallCoreRuntime!
  private var ringback: Ringback!
  private var surfaceAdapter: SurfaceAdapter!
  private var eventsAdapter: EventsAdapter!

  // Snapshot extras (main thread).
  private var extrasCallId: String?
  private var extrasMedia: String?
  private var roster: [SnapshotParticipant] = []
  private var conversationName: String?
  private var mutedSelf = false
  private var cameraOn = false
  private var cameraFacing: String?
  private var audioRoute: String?

  /// ring_ended reasons seen per call — the CallKit end reason.
  private var ringEndReasons: [String: String] = [:]
  /// The user ended from our UI (JS): end CallKit with a transaction.
  private var localEnd = false

  private let snapshotLock = NSLock()
  private var lastSnapshot: [String: Any]?

  private init() {
    ringback = Ringback(resourceName: { CallCore.config?.ringback })
    eventsAdapter = EventsAdapter()
    mediaPort = LiveKitMediaPort(events: eventsAdapter)
    surfaceAdapter = SurfaceAdapter()
    runtime = CallCoreRuntime(
      http: CallHttpClient(baseUrl: { CallCore.config?.apiBaseUrl ?? "" }),
      media: mediaPort,
      surface: surfaceAdapter,
      session: surfaceAdapter,
      timers: MainQueueTimerPort(),
      sink: BlockSnapshotSink { [weak self] state in self?.onState(state) }
    )
    eventsAdapter.core = self
    surfaceAdapter.core = self
    callKit.actions = self
  }

  // MARK: - native entry points

  func onRing(_ ring: RingContext) { runtime.onRing(ring) }

  func onRingEnded(callId: String, reason: String) {
    onMain { [self] in
      ringEndReasons[callId] = reason
      runtime.onRingEnded(callId: callId, reason: reason)
      reconcileCallKitSoon()
    }
  }

  func onCallFinished(callId: String, reason: String?) {
    onMain { [self] in
      runtime.onCallFinished(callId: callId, reason: reason)
      reconcileCallKitSoon()
    }
  }

  /// False once this ring is resolved here or past its deadline (+ clock slack).
  func isRingLive(_ ring: RingContext) -> Bool {
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    return !runtime.isResolved(ring.callId) && ring.ringDeadlineEpochMs + CallCoreRuntime.CLOCK_SLACK_MS > now
  }

  /// Reconcile CallKit after everything queued so far has run.
  func reconcileCallKitSoon() {
    runtime.post { [weak self] in
      guard let self = self else { return }
      self.reconcileCallKit(self.runtime.currentState())
    }
  }

  // MARK: - bridge-driven actions (any thread)

  func answer() { runtime.answer() }

  func decline() {
    onMain { [self] in
      localEnd = true
      runtime.decline()
    }
  }

  func hangUp() {
    onMain { [self] in
      localEnd = true
      runtime.hangUp()
    }
  }

  func place(conversationId: String, media: String, sessionToken: String) {
    onMain { [self] in
      localEnd = false
      runtime.place(conversationId: conversationId, media: media, sessionToken: sessionToken)
    }
  }

  func join(callId: String, conversationId: String?, sessionToken: String) {
    onMain { [self] in
      localEnd = false
      runtime.join(callId: callId, conversationId: conversationId, sessionToken: sessionToken)
    }
  }

  func setMuted(_ muted: Bool) {
    onMain { [self] in
      applyMuted(muted)
      if let id = runtime.currentState().callId { callKit.requestMute(callId: id, muted: muted) }
    }
  }

  private func applyMuted(_ muted: Bool) {
    mutedSelf = muted
    runtime.setMuted(muted)
    runtime.reemit()
  }

  /// Not optimistic: cameraOn flips when the media adapter reports it published.
  func setCamera(_ on: Bool) { runtime.setCamera(on) }

  func switchCamera() { runtime.switchCamera() }

  func setSpeaker(_ on: Bool) {
    onMain { [self] in
      audioRoute = on ? "speaker" : "earpiece" // optimistic; the adapter reports the real one
      runtime.setSpeaker(on)
      runtime.reemit()
    }
  }

  /// A video slot for the native view. Main thread.
  func createVideoSurface() -> LiveKitVideoSurface { mediaPort.createVideoSurface() }

  /// The contract Snapshot (nil = idle), safe from any thread.
  func snapshot() -> [String: Any]? {
    snapshotLock.lock(); defer { snapshotLock.unlock() }
    return lastSnapshot
  }

  private func onMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread { block() } else { DispatchQueue.main.async(execute: block) }
  }

  // MARK: - snapshot assembly (main)

  fileprivate func onState(_ state: MachineState) {
    if state.phase == .idle {
      if extrasCallId != nil { mediaPort.leave() }
      resetExtras(nil, nil)
    } else if state.callId != extrasCallId {
      if extrasCallId?.hasPrefix("pending:") == true {
        if let old = extrasCallId, let new = state.callId { callKit.rename(from: old, to: new) }
        extrasCallId = state.callId
      } else {
        resetExtras(state.callId, state.media)
      }
    }
    if state.phase != .idle && state.media != extrasMedia {
      if extrasMedia != nil { audioRoute = nil }
      extrasMedia = state.media
    }
    if let name = runtime.conversationName { conversationName = name }

    let snap = state.toSnapshot(
      conversationName: conversationName,
      participants: roster,
      audioRoute: audioRoute ?? (state.media == "video" ? "speaker" : "earpiece"),
      mutedSelf: mutedSelf,
      cameraOn: cameraOn,
      cameraFacing: cameraFacing
    )
    snapshotLock.lock(); lastSnapshot = snap; snapshotLock.unlock()
    reconcileCallKit(state)
    reconcileDevice(state)
    CallCore.listener?(snap)
  }

  private func resetExtras(_ callId: String?, _ media: String?) {
    extrasCallId = callId
    extrasMedia = media
    roster = []
    conversationName = nil
    mutedSelf = false
    cameraOn = false
    cameraFacing = nil
    audioRoute = nil
  }

  /// CallKit follows the FINAL state of each dispatch.
  private func reconcileCallKit(_ state: MachineState) {
    let terminal = state.phase == .idle || state.phase == .ended
    for t in callKit.liveCalls {
      let isCurrent = !terminal && t.callId == state.callId
      if isCurrent {
        switch state.phase {
        case .connecting, .active, .reconnecting, .ringingOut:
          // Answered from the app's own UI: tell CallKit (audio follows).
          if !t.outgoing && !t.answered && state.direction == .incoming { callKit.requestAnswer(callId: t.callId) }
          if t.outgoing && state.phase == .active { callKit.reportConnected(callId: t.callId) }
          callKit.updateTitle(callId: t.callId, title: conversationName, video: state.media == "video")
        default:
          break
        }
        continue
      }
      // Not the call the machine is in (ended, busy-declined, superseded).
      // Terminal: whatever CallKit still shows is the call that just ended.
      let reason = endReason(for: t, state: state, current: terminal || t.callId == state.callId)
      callKit.end(t, reason: reason)
    }
    if terminal {
      localEnd = false
      if let id = state.callId { ringEndReasons.removeValue(forKey: id) }
      if ringEndReasons.count > 16 { ringEndReasons.removeAll() }
    }
  }

  /// nil = ended locally (end transaction); else how it ended remotely.
  private func endReason(for t: CallKitController.Tracked, state: MachineState, current: Bool) -> CXCallEndedReason? {
    if current && localEnd && state.reason != .failed && state.reason != .connectionLost { return nil }
    if !t.answered && !t.outgoing {
      switch ringEndReasons[t.callId] {
      case "answered_elsewhere": return .answeredElsewhere
      case "declined": return .declinedElsewhere
      case "timeout": return .unanswered
      case "cancelled", "finished": return .remoteEnded
      default: break
      }
      if !current { return .unanswered } // busy-declined / never taken
    }
    guard current else { return .remoteEnded }
    switch state.reason {
    case .noAnswer?, .busyAll?: return .unanswered
    case .connectionLost?, .failed?: return .failed
    case .left?: return localEnd ? nil : .remoteEnded
    default: return .remoteEnded
    }
  }

  /// Screen off at the ear: only for an audio call on the earpiece.
  private func reconcileDevice(_ state: MachineState) {
    let inCall = state.phase == .active || state.phase == .reconnecting ||
      state.phase == .ringingOut || state.phase == .connecting
    let route = audioRoute ?? (state.media == "video" ? "speaker" : "earpiece")
    let want = inCall && state.media == "audio" && route == "earpiece"
    if UIDevice.current.isProximityMonitoringEnabled != want { UIDevice.current.isProximityMonitoringEnabled = want }
  }

  // MARK: - ports' callbacks

  fileprivate func sessionStart(callId: String, media: String) {
    guard callKit.tracked(callId: callId) == nil else { return } // an answered incoming call
    let state = runtime.currentState()
    callKit.startOutgoing(callId: callId, handle: state.conversationId ?? callId, title: runtime.conversationName,
                          video: media == "video") { [weak self] in
      // CallKit refused: the call goes on without the system UI.
      self?.mediaPort.activateAudioWithoutCallKit(media: media)
    }
  }

  fileprivate func showRing(_ ring: RingContext) {
    // Usually already reported by the push path; idempotent.
    callKit.reportIncoming(ring: ring)
  }

  fileprivate var ringbackPlayer: Ringback { ringback }

  // MediaEvents → runtime
  fileprivate func mediaConnected() { runtime.onMediaConnected() }
  fileprivate func mediaFailed() { runtime.onMediaFailed() }
  fileprivate func mediaLost() { runtime.onMediaLost() }
  fileprivate func mediaReconnecting() { runtime.onMediaReconnecting() }
  fileprivate func mediaRecovered() { runtime.onMediaRecovered() }
  fileprivate func remoteJoined() { runtime.onRemoteJoined() }
  fileprivate func participants(_ p: [SnapshotParticipant]) {
    runtime.post { [weak self] in self?.roster = p }
    runtime.reemit()
  }
  fileprivate func route(_ r: String) {
    runtime.post { [weak self] in self?.audioRoute = r }
    runtime.reemit()
  }
  fileprivate func localCamera(on: Bool, facing: String?) {
    runtime.post { [weak self] in self?.cameraOn = on; self?.cameraFacing = facing }
    runtime.reemit()
  }
}

// MARK: - CallKit actions

extension CallCore: CallKitActions {
  func callKitAnswer(callId: String) {
    let s = runtime.currentState()
    guard s.callId == callId, s.phase == .ringingIn else { return }
    runtime.answer()
  }

  func callKitEnd(callId: String) {
    let s = runtime.currentState()
    guard s.callId == callId || (s.callId?.hasPrefix("pending:") == true) else { return }
    localEnd = true
    if s.phase == .ringingIn { runtime.decline() } else { runtime.hangUp() }
  }

  func callKitSetMuted(callId: String, muted: Bool) {
    guard muted != mutedSelf else { return }
    applyMuted(muted)
  }

  func callKitAudioActivated(_ session: AVAudioSession) {
    mediaPort.audioActivated(session, media: runtime.currentState().media)
    ringback.sessionActivated()
  }

  func callKitAudioDeactivated(_ session: AVAudioSession) {
    ringback.stop()
    mediaPort.audioDeactivated()
  }

  func callKitReset() {
    let s = runtime.currentState()
    guard s.phase != .idle && s.phase != .ended else { return }
    localEnd = true
    if s.phase == .ringingIn { runtime.decline() } else { runtime.hangUp() }
  }
}

// MARK: - port adapters

/// RingSurfacePort + CallSessionPort: CallKit. The ringtone is CallKit's;
/// dismissal and session end are reconciled from the final state.
private final class SurfaceAdapter: RingSurfacePort, CallSessionPort {
  weak var core: CallCore?

  func show(ring: RingContext) { core?.showRing(ring) }
  func dismiss(callId: String) {}
  func ringtoneStart() {}
  func ringtoneStop() {}
  func ringbackStart() { core?.ringbackPlayer.start() }
  func ringbackStop() { core?.ringbackPlayer.stop() }

  func start(callId: String, media: String) { core?.sessionStart(callId: callId, media: media) }
  func stop() { core?.ringbackPlayer.stop() }
}

private final class EventsAdapter: MediaEvents {
  weak var core: CallCore?

  func onConnected() { core?.mediaConnected() }
  func onFailed() { core?.mediaFailed() }
  func onLost() { core?.mediaLost() }
  func onReconnecting() { core?.mediaReconnecting() }
  func onRecovered() { core?.mediaRecovered() }
  func onRemoteJoined() { core?.remoteJoined() }
  func onParticipants(_ participants: [SnapshotParticipant]) { core?.participants(participants) }
  func onAudioRoute(_ route: String) { core?.route(route) }
  func onLocalCamera(on: Bool, facing: String?) { core?.localCamera(on: on, facing: facing) }
}

/// Host-facing entry points.
@objc(PoolseCalls)
public final class PoolseCallsSetup: NSObject {
  /// Create the PushKit registry (and the CallKit provider, and the core
  /// if this install was ever configured). Idempotent; main thread.
  ///
  /// Called automatically from `PoolseCallsAppDelegateSubscriber`'s
  /// didFinishLaunching (registered through expo-module.config.json), so
  /// an Expo host needs NO AppDelegate edit. A non-Expo host calls this
  /// from its own `application(_:didFinishLaunchingWithOptions:)`.
  @objc public static func registerVoipEarly() {
    if !Thread.isMainThread {
      DispatchQueue.main.async { registerVoipEarly() }
      return
    }
    _ = CallKitController.shared
    _ = CallCore.getOrNull()
    VoipPush.shared.register()
  }
}
