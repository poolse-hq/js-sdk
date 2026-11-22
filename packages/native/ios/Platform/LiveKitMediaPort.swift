import AVFoundation
import os
import Foundation
#if canImport(LiveKitClient)
import LiveKitClient // CocoaPods module name
#else
import LiveKit // SwiftPM module name
#endif
import UIKit

/// Media-level signals the SFU adapter reports back to the core
/// (CallCore.kt's MediaEvents). Delivered on the main thread.
protocol MediaEvents: AnyObject {
  func onConnected()
  func onFailed()
  /// Unexpected disconnect — the SFU gave up; the core asks the server and rejoins.
  func onLost()
  /// The SFU is resuming the session itself; only reflected in the UI.
  func onReconnecting()
  func onRecovered()
  func onRemoteJoined()
  /// The REMOTE roster (the local participant excluded).
  func onParticipants(_ participants: [SnapshotParticipant])
  /// `earpiece` | `speaker` | `bluetooth` | `headset`.
  func onAudioRoute(_ route: String)
  /// Every output call audio can play through right now, and the one it does.
  func onAudioOutputs(_ outputs: [AudioOutput], selectedId: String?)
  /// The local camera track is (not) published + enabled; facing `front` | `back`.
  func onLocalCamera(on: Bool, facing: String?)
  /// Our shared screen is (not) published.
  func onLocalScreen(_ on: Bool)
  /// Our own link to the SFU (`good` | `poor` | `lost` | `unknown`), and
  /// whether incoming video is paused to keep the audio going.
  func onNetwork(quality: String, videoPaused: Bool)
  /// Whether the server lets us publish (false: recording consent not
  /// given yet, docs/RECORDING.md §5). Sent on every change.
  func onCanPublish(_ allowed: Bool)
  /// The SFU replaced us with the same user joining from another device
  /// ("move call to this device", CALL_CONTRACT.md §9). Sent just before `onLost`.
  func onMovedElsewhere()
}

/// Step-by-step trace of the audio path, in the device log as
/// "[PoolseCalls] trace …" — the order of activation, engine availability,
/// connect and publish is what cold-answer audio failures hinge on.
///
/// os_log with a PUBLIC argument: NSLog's text is redacted to "<private>"
/// on release builds, which made the first device trace unreadable.
func pcTrace(_ message: @autoclosure () -> String) {
  os_log("[PoolseCalls] trace %{public}@", log: pcLog, type: .default, message())
}

let pcLog = OSLog(subsystem: "dev.poolse.callcore", category: "calls")

func pcSessionDescription(_ s: AVAudioSession = .sharedInstance()) -> String {
  let outs = s.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ",")
  let ins = s.currentRoute.inputs.map { $0.portType.rawValue }.joined(separator: ",")
  return "category=\(s.category.rawValue) mode=\(s.mode.rawValue) in=[\(ins)] out=[\(outs)] " +
    "otherAudio=\(s.isOtherAudioPlaying) inputAvailable=\(s.isInputAvailable) " +
    "record=\(s.recordPermission.rawValue)"
}

/// The shipped MediaPort over LiveKit's Swift SDK — LiveKitMediaPort.kt
/// for iOS. Joins with the server-minted token, publishes the mic (and
/// the camera for video), tracks the roster and reports room transitions.
///
/// Audio is CallKit's: LiveKit's automatic AVAudioSession handling is off
/// and its engine is only available between CallKit's didActivate and
/// didDeactivate (LiveKit's documented CallKit integration).
///
/// Threading: every method is called on main; LiveKit's delegate
/// callbacks hop to main; async work re-checks that the room it captured
/// is still the current one.
final class LiveKitMediaPort: NSObject, MediaPort {
  private weak var events: MediaEvents?

  private(set) var room: Room?
  private var observer: RoomObserver?
  private var media = "audio"
  /// Speaker unless a headset is in: a video call, or a room (a drop-in
  /// room is held like a meeting, not to the ear).
  private var loud = false
  private var connectedRoom: ObjectIdentifier?

  /// Where the user asked the audio to go, for the CURRENT call.
  enum OutputChoice: Equatable {
    case speaker
    /// The best private route: Bluetooth, then wired, then the earpiece.
    case privateRoute
    /// The phone itself: earpiece (or wired headphones, which replace it).
    case builtIn
    /// One external input/output pair, by AVAudioSessionPortDescription uid.
    case port(String)
  }

  /// The user's output choice; nil = automatic (see `resolvedChoice`).
  private var outputWanted: OutputChoice?
  /// The user's choices for the CURRENT call; survive a rejoin.
  private var mutedWanted = false
  private var cameraWanted: Bool?
  private var joinedCallId: String?
  /// The server lets us publish. False while it holds our media back for
  /// consent: the mic/camera choices above are kept, nothing is published
  /// (LiveKit unpublished what was live), and they come back as they were
  /// once permission returns.
  private var canPublish = true

  /// Our own link to the SFU, as last reported.
  private var localQuality = "unknown"
  /// Incoming video is switched off to keep the audio going (see
  /// `qualityChanged`). Survives a rejoin of the same call, like mute.
  private var videoPaused = false
  private var pauseWork: DispatchWorkItem?
  private var resumeWork: DispatchWorkItem?
  /// Weak this long before video is paused; good this long before it is back.
  private static let pauseVideoAfter: TimeInterval = 6
  private static let resumeVideoAfter: TimeInterval = 10

  /// Capture processing (CL7); per process, not per call.
  private(set) var noiseSuppression = true
  private(set) var backgroundBlur = false
  /// The capturer holds its processor weakly: this keeps it alive.
  private var blurProcessor: BackgroundBlurVideoProcessor?

  private let surfaces = NSHashTable<LiveKitVideoSurface>.weakObjects()
  private var audioPrepared = false
  private var audioActive = false
  /// Asks CallKit to (re)try activating the audio session — set by
  /// CallCore. Used when a room is live but activation never arrived.
  var requestAudioActivation: (() -> Void)?

  init(events: MediaEvents) {
    self.events = events
    super.init()
    NotificationCenter.default.addObserver(self, selector: #selector(routeChanged),
                                           name: AVAudioSession.routeChangeNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(interrupted),
                                           name: AVAudioSession.interruptionNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(mediaServicesReset),
                                           name: AVAudioSession.mediaServicesWereResetNotification,
                                           object: nil)
  }

  // MARK: - audio session (CallKit-driven)

  /// Before any room exists: LiveKit must not configure the session nor
  /// start its engine outside CallKit's activation window.
  ///
  /// Called at app LAUNCH (CallCore.init, from the app-delegate
  /// subscriber), as LiveKit's CallKit integration requires — before any
  /// audio session can be activated. Doing it inside didActivate meant a
  /// call answered with the app closed created and reconfigured LiveKit's
  /// audio manager mid-activation, and came up with no audio.
  func prepareAudio() {
    guard !audioPrepared else { return }
    audioPrepared = true
    pcTrace("prepareAudio (automatic config off, engine .none)")
    AudioManager.shared.audioSession.isAutomaticConfigurationEnabled = false
    do { try AudioManager.shared.setEngineAvailability(.none) } catch {
      NSLog("[PoolseCalls] setEngineAvailability(.none) failed: %@", "\(error)")
    }
  }

  /// CallKit activated the session (or, without CallKit, we did).
  func audioActivated(_ session: AVAudioSession, media: String) {
    pcTrace("audioActivated media=\(media) room=\(room != nil) connected=\(connectedRoom != nil) \(pcSessionDescription(session))")
    prepareAudio()
    audioActive = true
    if media != self.media && room == nil { self.media = media }
    reassertAudio(session)
  }

  /// Connected with a live mic but CallKit never activated the session
  /// (iOS refused the activation): nudge CallKit to retry — a transaction
  /// on the call makes it attempt activation again (in the device log a
  /// mute toggle did exactly that, and audio came up). Three tries, then
  /// activate the session ourselves as a last resort.
  private func ensureAudioActivated(_ r: Room, attempt: Int) {
    guard room === r, !audioActive else { return }
    let delays: [Double] = [1.2, 2.5, 4.0]
    guard attempt <= delays.count else { return }
    if attempt == delays.count {
      pcTrace("audio never activated by CallKit; activating ourselves")
      activateAudioWithoutCallKit(media: media)
      return
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + delays[attempt]) { [weak self] in
      guard let self = self, self.room === r, !self.audioActive else { return }
      pcTrace("audio not active \(attempt + 1)x after connect; nudging CallKit")
      CallKitController.prepareSessionForCall(video: self.media == "video")
      self.requestAudioActivation?()
      self.ensureAudioActivated(r, attempt: attempt + 1)
    }
  }

  /// Put the call's audio back the way the call needs it: play-and-record
  /// in the voice/video chat mode, LiveKit's engine available, the chosen
  /// route. Idempotent — only touches what differs — so it is safe to run
  /// whenever anything may have changed the session behind the call's
  /// back (another audio library reconfiguring it as JS boots mid-call,
  /// an interruption, a media-services reset). Only while CallKit (or the
  /// no-CallKit fallback) holds the session active.
  func reassertAudio(_ session: AVAudioSession = .sharedInstance()) {
    guard audioActive else { return }
    pcTrace("reassertAudio before: \(pcSessionDescription(session))")
    let mode: AVAudioSession.Mode = media == "video" && resolvedChoice(session) == .speaker ? .videoChat : .voiceChat
    if session.category != .playAndRecord || session.mode != mode {
      do {
        try session.setCategory(.playAndRecord, mode: mode,
                                options: [.allowBluetooth, .allowBluetoothA2DP])
      } catch {
        NSLog("[PoolseCalls] audio session category failed: %@", "\(error)")
      }
    }
    do { try AudioManager.shared.setEngineAvailability(.default) } catch {
      NSLog("[PoolseCalls] setEngineAvailability(.default) failed: %@", "\(error)")
    }
    applyRoute()
  }

  func audioDeactivated() {
    pcTrace("audioDeactivated")
    audioActive = false
    guard audioPrepared else { return }
    do { try AudioManager.shared.setEngineAvailability(.none) } catch {
      NSLog("[PoolseCalls] setEngineAvailability(.none) failed: %@", "\(error)")
    }
  }

  /// No CallKit call holds the session (CallKit refused the outgoing
  /// transaction): activate it ourselves so the call still has audio.
  func activateAudioWithoutCallKit(media: String) {
    let s = AVAudioSession.sharedInstance()
    do { try s.setActive(true) } catch { NSLog("[PoolseCalls] session activate failed: %@", "\(error)") }
    audioActivated(s, media: media)
  }

  // MARK: - MediaPort

  func join(bundle: CallSessionBundle) {
    pcTrace("join call=\(bundle.callId) media=\(bundle.media) audioActive=\(audioActive)")
    prepareAudio()
    if let joined = joinedCallId, joined != bundle.callId { resetWanted() }
    joinedCallId = bundle.callId
    detach()
    media = bundle.media
    let wantsVideo = bundle.media == "video"
    loud = wantsVideo || bundle.kind == "room"

    // A 1:1/small call: never let the SFU pause a subscribed camera for
    // "not visible" — a view that mounts late would stay black.
    let r = Room(roomOptions: RoomOptions(adaptiveStream: false, dynacast: false))
    let obs = RoomObserver(port: self, room: r)
    r.add(delegate: obs)
    room = r
    observer = obs
    refreshVideo()

    let url = bundle.livekitUrl
    let token = bundle.livekitToken
    Task { [weak self] in
      do {
        try await r.connect(url: url, token: token, connectOptions: ConnectOptions(autoSubscribe: true))
      } catch {
        NSLog("[PoolseCalls] LiveKit connect failed: %@", "\(error)")
        await MainActor.run {
          guard let self = self, self.room === r else { return }
          self.room = nil
          self.observer = nil
          self.refreshVideo()
          self.events?.onFailed()
        }
        await r.disconnect()
        return
      }
      let proceed: Bool = await MainActor.run {
        guard let self = self, self.room === r else { return false }
        self.markConnected(r)
        return true
      }
      guard proceed, let self = self else {
        if !proceed { await r.disconnect() }
        return
      }
      let muted = await MainActor.run { self.mutedWanted }
      let activeNow = await MainActor.run { self.audioActive }
      // The token may say listen-only (consent required, not yet given):
      // publish nothing then — the permission update brings it back.
      let allowed = await MainActor.run { self.updateCanPublish(r) }
      pcTrace("connected; publishing mic muted=\(muted) audioActive=\(activeNow) canPublish=\(allowed)")
      if allowed {
        do { try await r.localParticipant.setMicrophone(enabled: !muted) } catch {
          NSLog("[PoolseCalls] microphone publish failed: %@", "\(error)")
        }
      }
      // Connected and publishing: make sure nothing changed the session
      pcTrace("mic published enabled=\(r.localParticipant.isMicrophoneEnabled()) \(pcSessionDescription())")
      // while we connected (a cold answer boots JS in exactly this window),
      // then make sure the engine is actually carrying the mic.
      await MainActor.run {
        self.reassertAudio()
        self.ensureAudioActivated(r, attempt: 0)
      }
      let camera = await MainActor.run { self.cameraWanted ?? wantsVideo }
      if camera && allowed { await self.enableCamera(r, true) }
      await MainActor.run {
        self.reportLocalCamera(r)
        self.refreshVideo()
      }
    }
  }

  /// Connected (once per room): the core moves on; anyone already in is "joined".
  private func markConnected(_ r: Room) {
    guard room === r, connectedRoom != ObjectIdentifier(r) else { return }
    connectedRoom = ObjectIdentifier(r)
    if outputWanted != nil { applyRoute() }
    events?.onConnected()
    if !people(r).isEmpty { events?.onRemoteJoined() }
    emit(r)
    refreshVideo()
  }

  private func cameraGranted() -> Bool {
    AVCaptureDevice.authorizationStatus(for: .video) == .authorized
  }

  /// Without the camera grant a video call joins audio-only; a later
  /// setCamera(true) after the user grants it publishes then.
  private func enableCamera(_ r: Room, _ on: Bool) async {
    if on && !cameraGranted() {
      NSLog("[PoolseCalls] camera not authorized: staying audio-only")
      return
    }
    do {
      try await r.localParticipant.setCamera(enabled: on, captureOptions: on ? CameraCaptureOptions(position: .front) : nil)
    } catch {
      NSLog("[PoolseCalls] camera %@ failed: %@", on ? "publish" : "unpublish", "\(error)")
    }
  }

  func leave() {
    detach()
    resetWanted()
    joinedCallId = nil
  }

  private func resetWanted() {
    mutedWanted = false
    cameraWanted = nil
    canPublish = true
    outputWanted = nil
    pauseWork?.cancel()
    resumeWork?.cancel()
    pauseWork = nil
    resumeWork = nil
    videoPaused = false
    localQuality = "unknown"
    reportNetwork()
  }

  private func detach() {
    guard let r = room else { return }
    if let obs = observer { r.remove(delegate: obs) }
    room = nil
    observer = nil
    connectedRoom = nil
    // Their timers belong to that room; the next one starts its own.
    pauseWork?.cancel()
    resumeWork?.cancel()
    pauseWork = nil
    resumeWork = nil
    refreshVideo()
    Task { await r.disconnect() }
    events?.onLocalCamera(on: false, facing: nil)
    // The broadcast is its own process: end it with the call, or the
    // red status-bar pill would keep recording into nothing.
    if BroadcastManager.shared.isBroadcasting { BroadcastManager.shared.requestStop() }
    events?.onLocalScreen(false)
  }

  // MARK: - screen sharing

  /// Sharing the screen needs the app's broadcast upload extension (the
  /// config plugin's `screenShare` option) and the app group it shares
  /// with the app; without them iOS can only record the app itself,
  /// which is not what anyone means by sharing.
  static var screenShareSupported: Bool { ScreenShareCaptureOptions.defaultToBroadcastExtension }

  /// On: shows the system's broadcast picker. LiveKit publishes the
  /// screen once the user taps Start Broadcast (and unpublishes when the
  /// broadcast ends, from here or from the status bar), so the snapshot
  /// follows the real state rather than the request.
  func setScreenShare(_ on: Bool) {
    guard let r = room, connectedRoom == ObjectIdentifier(r), canPublish || !on else { return }
    if !on, BroadcastManager.shared.isBroadcasting { BroadcastManager.shared.requestStop() }
    Task { [weak self] in
      do { _ = try await r.localParticipant.setScreenShare(enabled: on) } catch {
        NSLog("[PoolseCalls] setScreenShare failed: %@", "\(error)")
      }
      await MainActor.run {
        guard let self = self, self.room === r else { return }
        self.reportLocalScreen(r)
      }
    }
  }

  private func reportLocalScreen(_ r: Room) {
    guard room === r else { return }
    events?.onLocalScreen(screenTrack(participantId: nil, local: true) != nil)
  }

  func setMuted(_ muted: Bool) {
    mutedWanted = muted
    // Not allowed to publish: only remembered, applied on republish.
    guard let r = room, connectedRoom == ObjectIdentifier(r), canPublish else { return }
    Task { _ = try? await r.localParticipant.setMicrophone(enabled: !muted) }
  }

  func setCamera(_ on: Bool) {
    cameraWanted = on
    guard let r = room, connectedRoom == ObjectIdentifier(r), canPublish else { return }
    Task { [weak self] in
      await self?.enableCamera(r, on)
      await MainActor.run {
        guard let self = self, self.room === r else { return }
        self.reportLocalCamera(r)
        self.refreshVideo()
      }
    }
  }

  // MARK: - publish permission (recording consent)

  /// Reads the local participant's permission; reports a change. Returns it.
  @discardableResult
  private func updateCanPublish(_ r: Room) -> Bool {
    guard room === r else { return canPublish }
    let now = r.localParticipant.permissions.canPublish
    if now != canPublish {
      canPublish = now
      pcTrace("canPublish=\(now)")
      events?.onCanPublish(now)
    }
    return now
  }

  /// The server changed what we may do. Revoked: LiveKit has unpublished
  /// our tracks itself — nothing to do but say so. Back: publish the mic
  /// and camera the way the user last had them.
  fileprivate func permissionsChanged(_ r: Room) {
    guard room === r, connectedRoom == ObjectIdentifier(r) else { return }
    let was = canPublish
    if updateCanPublish(r) && !was { republish() }
  }

  /// Mic and camera as the user last had them — after consent (the app
  /// calls this from its consent prompt; the permission update does it
  /// too). A no-op while the server still says listen-only.
  func republish() {
    guard let r = room, connectedRoom == ObjectIdentifier(r), updateCanPublish(r) else { return }
    let muted = mutedWanted
    let camera = cameraWanted ?? (media == "video")
    pcTrace("republish muted=\(muted) camera=\(camera)")
    Task { [weak self] in
      if r.localParticipant.isMicrophoneEnabled() != !muted {
        do { try await r.localParticipant.setMicrophone(enabled: !muted) } catch {
          NSLog("[PoolseCalls] microphone republish failed: %@", "\(error)")
        }
      }
      guard let self = self else { return }
      let cameraLive = await MainActor.run { self.room === r && self.localCameraTrack(r) != nil }
      if camera && !cameraLive { await self.enableCamera(r, true) }
      await MainActor.run {
        guard self.room === r else { return }
        self.reportLocalCamera(r)
        self.refreshVideo()
      }
    }
  }

  func switchCamera() {
    guard let r = room, let track = localCameraTrack(r), let capturer = track.capturer as? CameraCapturer else { return }
    Task { [weak self] in
      do { _ = try await capturer.switchCameraPosition() } catch {
        NSLog("[PoolseCalls] switchCamera failed: %@", "\(error)")
      }
      await MainActor.run {
        guard let self = self, self.room === r else { return }
        self.reportLocalCamera(r)
        self.refreshVideo()
      }
    }
  }

  func setSpeaker(_ on: Bool) {
    outputWanted = on ? .speaker : .privateRoute
    applyRoute()
  }

  /// An id from the snapshot's `audioOutputs`: `speaker`, `earpiece`,
  /// `wired`, or `port:<uid>`. An id that is no longer connected is ignored.
  func setAudioOutput(_ id: String) {
    switch id {
    case "speaker": outputWanted = .speaker
    case "earpiece", "wired": outputWanted = .builtIn
    default:
      guard id.hasPrefix("port:") else { return }
      let uid = String(id.dropFirst("port:".count))
      // An output with no matching input (an A2DP-only speaker) cannot be
      // chosen through the session; the system's own route wins there.
      outputWanted = selectablePort(uid) != nil ? .port(uid) : .privateRoute
    }
    applyRoute()
  }

  // MARK: - audio routing

  private static let externalInputs: Set<AVAudioSession.Port> =
    [.bluetoothHFP, .bluetoothLE, .carAudio, .usbAudio, .headsetMic]
  private static let externalOutputs: Set<AVAudioSession.Port> =
    [.bluetoothHFP, .bluetoothA2DP, .bluetoothLE, .carAudio, .usbAudio, .headphones, .airPlay, .lineOut, .HDMI]

  private func selectablePort(_ uid: String, _ s: AVAudioSession = .sharedInstance()) -> AVAudioSessionPortDescription? {
    s.availableInputs?.first { $0.uid == uid && Self.externalInputs.contains($0.portType) }
  }

  /// A headset, Bluetooth device or car is connected — something the
  /// user put on or plugged in, which should carry the call by default.
  private func externalConnected(_ s: AVAudioSession) -> Bool {
    (s.availableInputs ?? []).contains { Self.externalInputs.contains($0.portType) && $0.portType != .usbAudio }
      || s.currentRoute.outputs.contains { Self.externalOutputs.contains($0.portType) }
  }

  /// What the call should do now. Automatic: a voice call is held to the
  /// ear and a video call uses the loudspeaker — unless a headset or
  /// Bluetooth device is connected, which wins either way (FaceTime does
  /// the same; forcing the speaker over AirPods was a bug).
  private func resolvedChoice(_ s: AVAudioSession = .sharedInstance()) -> OutputChoice {
    if let wanted = outputWanted { return wanted }
    return loud && !externalConnected(s) ? .speaker : .privateRoute
  }

  private func applyRoute() {
    guard audioActive else { return }
    let s = AVAudioSession.sharedInstance()
    if case .port(let uid) = outputWanted, selectablePort(uid, s) == nil { outputWanted = nil }
    let choice = resolvedChoice(s)
    do {
      switch choice {
      case .speaker:
        try s.overrideOutputAudioPort(.speaker)
      case .privateRoute:
        try leaveSpeaker(s)
        if s.preferredInput != nil { try s.setPreferredInput(nil) }
      case .builtIn:
        try leaveSpeaker(s)
        let mic = s.availableInputs?.first { $0.portType == .builtInMic }
        if let mic = mic, s.preferredInput?.uid != mic.uid { try s.setPreferredInput(mic) }
      case .port(let uid):
        try leaveSpeaker(s)
        if let port = selectablePort(uid, s), s.preferredInput?.uid != uid { try s.setPreferredInput(port) }
      }
    } catch {
      NSLog("[PoolseCalls] audio route failed: %@", "\(error)")
    }
    reportRoute()
  }

  /// .videoChat forces the speaker; every private route needs .voiceChat.
  private func leaveSpeaker(_ s: AVAudioSession) throws {
    if s.mode == .videoChat { try s.setMode(.voiceChat) }
    try s.overrideOutputAudioPort(.none)
  }

  private func kind(of port: AVAudioSession.Port) -> String {
    switch port {
    case .builtInSpeaker: return "speaker"
    case .builtInReceiver: return "earpiece"
    case .bluetoothHFP, .bluetoothA2DP, .bluetoothLE, .carAudio, .airPlay: return "bluetooth"
    default: return "headset"
    }
  }

  private func currentRoute() -> String {
    guard let port = AVAudioSession.sharedInstance().currentRoute.outputs.first?.portType else {
      return loud ? "speaker" : "earpiece"
    }
    return kind(of: port)
  }

  /// Every output the user can pick, and the one playing now.
  ///
  /// iOS lists inputs, not outputs: a headset or Bluetooth device is
  /// selectable through its microphone (its input and output share the
  /// uid), while the earpiece and speaker are always there on a phone.
  /// Wired headphones replace the earpiece rather than sitting beside it.
  private func outputs() -> ([AudioOutput], String?) {
    let s = AVAudioSession.sharedInstance()
    let inputs = s.availableInputs ?? []
    let current = s.currentRoute.outputs.first
    var list: [AudioOutput] = []

    let wiredOut = s.currentRoute.outputs.first { $0.portType == .headphones }
    if inputs.contains(where: { $0.portType == .headsetMic }) || wiredOut != nil {
      list.append(AudioOutput(id: "wired", kind: "headset", name: "Headphones"))
    } else if UIDevice.current.userInterfaceIdiom == .phone {
      list.append(AudioOutput(id: "earpiece", kind: "earpiece", name: UIDevice.current.model))
    }
    list.append(AudioOutput(id: "speaker", kind: "speaker", name: "Speaker"))
    for p in inputs where Self.externalInputs.contains(p.portType) && p.portType != .headsetMic {
      list.append(AudioOutput(id: "port:\(p.uid)", kind: p.portType == .usbAudio ? "headset" : "bluetooth", name: p.portName))
    }
    // Playing through something with no microphone (an A2DP speaker,
    // AirPlay): show it so the selection is truthful, even though only
    // the system picker can choose it.
    if let c = current, Self.externalOutputs.contains(c.portType), c.portType != .headphones,
       !list.contains(where: { $0.id == "port:\(c.uid)" || $0.name == c.portName }) {
      list.append(AudioOutput(id: "port:\(c.uid)", kind: kind(of: c.portType), name: c.portName))
    }

    let selected: String? = current.map { c in
      switch c.portType {
      case .builtInSpeaker: return "speaker"
      case .builtInReceiver: return "earpiece"
      case .headphones: return "wired"
      default:
        return list.first { $0.id == "port:\(c.uid)" }?.id
          ?? list.first { $0.name == c.portName }?.id
          ?? "port:\(c.uid)"
      }
    }
    return (list, selected)
  }

  private func reportRoute() {
    guard joinedCallId != nil || audioActive else { return }
    events?.onAudioRoute(currentRoute())
    let (list, selected) = outputs()
    events?.onAudioOutputs(list, selectedId: selected)
  }

  /// An interruption (another app's audio, Siri) ended: the session may
  /// have been reconfigured; restore the call's.
  @objc private func interrupted(_ note: Notification) {
    pcTrace("interruption \(note.userInfo ?? [:])")
    guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
    DispatchQueue.main.async { [weak self] in self?.reassertAudio() }
  }

  @objc private func mediaServicesReset(_ note: Notification) {
    pcTrace("mediaServicesWereReset")
    DispatchQueue.main.async { [weak self] in self?.reassertAudio() }
  }

  @objc private func routeChanged(_ note: Notification) {
    let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt)
      .flatMap(AVAudioSession.RouteChangeReason.init(rawValue:))
    pcTrace("routeChange reason=\(reason.map { String($0.rawValue) } ?? "?") \(pcSessionDescription())")
    DispatchQueue.main.async { [weak self] in
      guard let self = self, self.audioActive else { return }
      // Something reconfigured the shared session mid-call: put it back.
      if reason == .categoryChange {
        self.reassertAudio()
        return
      }
      switch reason {
      case .newDeviceAvailable:
        // Putting on a headset or AirPods mid-call moves the call to it,
        // whatever was picked before — as the Phone app does.
        self.outputWanted = nil
        self.applyRoute()
      case .oldDeviceUnavailable:
        // A device went away. If it was the chosen one, applyRoute drops
        // the choice and falls back to automatic — speaker for video,
        // earpiece for voice; any other choice stands.
        self.applyRoute()
      default:
        // The override is cleared by any route change: put the speaker
        // back (or take it away) if that is not what the call wants.
        let onSpeaker = self.currentRoute() == "speaker"
        if (self.resolvedChoice() == .speaker) != onSpeaker && reason != .override {
          self.applyRoute()
        } else {
          self.reportRoute()
        }
      }
    }
  }

  // MARK: - video

  func createVideoSurface(renderMode: VideoView.RenderMode = .auto) -> LiveKitVideoSurface {
    let s = LiveKitVideoSurface(port: self, renderMode: renderMode)
    surfaces.add(s)
    return s
  }

  func unregister(_ s: LiveKitVideoSurface) { surfaces.remove(s) }

  private func refreshVideo() {
    for s in surfaces.allObjects { s.rebind() }
  }

  private func localCameraTrack(_ r: Room) -> LocalVideoTrack? {
    guard let pub = r.localParticipant.trackPublications.values.first(where: { $0.source == .camera }), !pub.isMuted else { return nil }
    return pub.track as? LocalVideoTrack
  }

  /// The local camera, or a remote's — only once published, SUBSCRIBED and unmuted.
  func cameraTrack(participantId: String?, local: Bool) -> VideoTrack? {
    guard let r = room else { return nil }
    if local { return localCameraTrack(r) }
    guard let id = participantId,
          let p = people(r).first(where: { $0.identity?.stringValue == id }) else { return nil }
    return remoteCamera(p)
  }

  private func remoteCamera(_ p: RemoteParticipant) -> VideoTrack? {
    // Paused: no picture to draw — the avatar shows, with the reason.
    guard !videoPaused, let pub = p.trackPublications.values.first(where: { $0.source == .camera }) as? RemoteTrackPublication,
          pub.isSubscribed, !pub.isMuted else { return nil }
    return pub.track as? VideoTrack
  }

  /// A participant's shared screen (with [local], our own), once
  /// published, subscribed and unmuted. Not paused with the cameras on a
  /// weak link: the shared screen is usually what the call is about.
  func screenTrack(participantId: String?, local: Bool) -> VideoTrack? {
    guard let r = room else { return nil }
    if local {
      guard let pub = r.localParticipant.trackPublications.values.first(where: { $0.source == .screenShareVideo }),
            !pub.isMuted else { return nil }
      return pub.track as? VideoTrack
    }
    guard let id = participantId,
          let p = people(r).first(where: { $0.identity?.stringValue == id }) else { return nil }
    return remoteScreen(p)
  }

  private func remoteScreen(_ p: RemoteParticipant) -> VideoTrack? {
    guard let pub = p.trackPublications.values.first(where: { $0.source == .screenShareVideo }) as? RemoteTrackPublication,
          pub.isSubscribed, !pub.isMuted else { return nil }
    return pub.track as? VideoTrack
  }

  /// `front` | `back` of the published local camera, or nil when none.
  func cameraFacing() -> String? {
    guard let r = room, let track = localCameraTrack(r) else { return nil }
    return (track.capturer as? CameraCapturer)?.position == .back ? "back" : "front"
  }

  // MARK: - capture processing (CL7)

  /// Apple's voice processing (VPIO) does echo cancellation, gain control
  /// and noise suppression as one unit, so "off" bypasses all of it —
  /// meant for headphones (music, an instrument). Valid mid-call.
  func setNoiseSuppression(_ on: Bool) {
    noiseSuppression = on
    AudioManager.shared.isVoiceProcessingBypassed = !on
  }

  /// Blur behind the person on the published camera (Vision person
  /// segmentation, LiveKit's BackgroundBlurVideoProcessor). Survives a
  /// camera flip and republish: re-applied whenever the camera is reported.
  func setBackgroundBlur(_ on: Bool) {
    backgroundBlur = on
    if let r = room { applyBlur(r) }
  }

  private func applyBlur(_ r: Room) {
    guard let track = localCameraTrack(r) else { return }
    if backgroundBlur {
      if blurProcessor == nil { blurProcessor = BackgroundBlurVideoProcessor() }
      if track.capturer.processor !== blurProcessor { track.capturer.processor = blurProcessor }
    } else if track.capturer.processor != nil {
      track.capturer.processor = nil
    }
  }

  private func reportLocalCamera(_ r: Room) {
    guard room === r else { return }
    applyBlur(r)
    let on = localCameraTrack(r) != nil
    events?.onLocalCamera(on: on, facing: on ? cameraFacing() : nil)
  }

  // MARK: - room events (main thread, via RoomObserver)

  fileprivate func roomEvent(_ r: Room, _ kind: RoomObserver.Kind) {
    guard room === r else { return }
    switch kind {
    case .connected:
      markConnected(r)
    case .reconnecting:
      events?.onReconnecting()
    case .reconnected:
      events?.onRecovered()
    case .disconnected:
      // The same user joined from another device: LiveKit replaces the
      // older participant (one identity per user). The reconnect that
      // follows is refused, and the call ends as moved.
      if r.disconnectError?.type == .duplicateIdentity { events?.onMovedElsewhere() }
      events?.onLost()
    case .participantJoined:
      // The transcript assistant or the recorder joining is nobody answering.
      if !people(r).isEmpty { events?.onRemoteJoined() }
      emit(r)
      refreshVideo()
    case .tracksChanged:
      if videoPaused { applyVideoPause(r) }
      emit(r)
      reportLocalCamera(r)
      reportLocalScreen(r)
      refreshVideo()
    case .rosterChanged:
      emit(r)
    case .quality:
      qualityChanged(r)
      emit(r)
    case .permissions:
      permissionsChanged(r)
    }
  }

  // MARK: - connection quality

  static func wire(_ q: ConnectionQuality) -> String {
    switch q {
    case .excellent, .good: return "good"
    case .poor: return "poor"
    case .lost: return "lost"
    default: return "unknown"
    }
  }

  /// Our link went weak or came back. Weak for a while on a call with
  /// video coming in: switch that video off so the audio keeps going —
  /// the way FaceTime falls back — and bring it back once the link has
  /// been good for a while. Brief dips change nothing.
  private func qualityChanged(_ r: Room) {
    guard room === r else { return }
    let q = Self.wire(r.localParticipant.connectionQuality)
    if q == "poor" || q == "lost" {
      resumeWork?.cancel()
      resumeWork = nil
      if !videoPaused && pauseWork == nil && hasRemoteVideo(r) {
        let w = DispatchWorkItem { [weak self, weak r] in
          guard let self = self, let r = r, self.room === r else { return }
          self.pauseWork = nil
          self.setVideoPaused(r, true)
        }
        pauseWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.pauseVideoAfter, execute: w)
      }
    } else if q == "good" {
      pauseWork?.cancel()
      pauseWork = nil
      if videoPaused && resumeWork == nil {
        let w = DispatchWorkItem { [weak self, weak r] in
          guard let self = self, let r = r, self.room === r else { return }
          self.resumeWork = nil
          self.setVideoPaused(r, false)
        }
        resumeWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.resumeVideoAfter, execute: w)
      }
    }
    if q != localQuality {
      localQuality = q
      reportNetwork()
    }
  }

  private func hasRemoteVideo(_ r: Room) -> Bool {
    people(r).contains { p in p.trackPublications.values.contains { $0.source == .camera } }
  }

  private func setVideoPaused(_ r: Room, _ paused: Bool) {
    pcTrace("incoming video \(paused ? "paused" : "resumed") quality=\(localQuality)")
    videoPaused = paused
    applyVideoPause(r)
    refreshVideo()
    emit(r)
    reportNetwork()
  }

  /// Every remote camera on or off to match `videoPaused` — including
  /// one published after the pause began.
  private func applyVideoPause(_ r: Room) {
    let enabled = !videoPaused
    for p in r.remoteParticipants.values {
      for case let pub as RemoteTrackPublication in p.trackPublications.values
      where pub.source == .camera && pub.isEnabled != enabled {
        Task { try? await pub.set(enabled: enabled) }
      }
    }
  }

  private func reportNetwork() {
    events?.onNetwork(quality: localQuality, videoPaused: videoPaused)
  }

  /// The remote PEOPLE: poolse's transcript assistant and LiveKit Egress's
  /// recorder are in the room but are not someone in the call — never in
  /// the roster, the count that ends a call left alone, or a video tile.
  /// Agents are listed separately (`agents`). Phone (SIP) participants are people.
  private func people(_ r: Room) -> [RemoteParticipant] {
    r.remoteParticipants.values.filter { p in
      !ServiceParticipants.isService(identity: p.identity?.stringValue ?? "", kind: Self.kindName(p.kind)) &&
        Self.metadata(p)?["agent"] as? Bool != true
    }
  }

  /// The kinds `ServiceParticipants` tells apart; nil for the rest.
  static func kindName(_ k: Participant.Kind) -> String? {
    if k == .agent { return "agent" }
    if k == .egress { return "egress" }
    if k == .sip { return "sip" }
    return nil
  }

  /// Agents invited into the call (AGENTS_IN_CALLS.md §1): kind AGENT like
  /// poolse's room assistant, but marked `agent: true` in their token
  /// metadata — listed (with the badge), unlike the assistant and recorder.
  private func agents(_ r: Room) -> [(RemoteParticipant, [String: Any])] {
    r.remoteParticipants.values.compactMap { p -> (RemoteParticipant, [String: Any])? in
      guard let m = Self.metadata(p), m["agent"] as? Bool == true else { return nil }
      return (p, m)
    }
  }

  static func metadata(_ p: Participant) -> [String: Any]? {
    guard let m = p.metadata, let d = m.data(using: .utf8) else { return nil }
    return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
  }

  /// The REMOTE roster — the local participant is never included.
  private func emit(_ r: Room) {
    let agentRows = agents(r).map { entry -> SnapshotParticipant in
      let (p, m) = entry
      let identity = p.identity?.stringValue ?? ""
      return SnapshotParticipant(
        userId: identity,
        externalId: externalId(p) ?? identity,
        speaking: p.isSpeaking,
        muted: !p.isMicrophoneEnabled(),
        cameraOn: false,
        connectionQuality: Self.wire(p.connectionQuality),
        screenSharing: false,
        isAgent: true,
        agentLabel: (m["label"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? p.name,
        agentMode: m["mode"] as? String
      )
    }
    let roster = people(r).map { p -> SnapshotParticipant in
      let identity = p.identity?.stringValue ?? ""
      return SnapshotParticipant(
        userId: identity,
        externalId: externalId(p) ?? identity,
        speaking: p.isSpeaking,
        muted: !p.isMicrophoneEnabled(),
        cameraOn: remoteCamera(p) != nil,
        connectionQuality: Self.wire(p.connectionQuality),
        screenSharing: remoteScreen(p) != nil
      )
    }
    events?.onParticipants(roster + agentRows)
  }

  /// The host's own user id, if the server put it in attributes/metadata.
  private func externalId(_ p: Participant) -> String? {
    if let v = p.attributes["external_id"], !v.isEmpty { return v }
    guard let m = p.metadata, let d = m.data(using: .utf8),
          let obj = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
          let v = obj["external_id"] as? String, !v.isEmpty else { return nil }
    return v
  }
}

/// LiveKit's delegate → main-thread room events for the port.
final class RoomObserver: NSObject, RoomDelegate, @unchecked Sendable {
  enum Kind { case connected, reconnecting, reconnected, disconnected, participantJoined, tracksChanged, rosterChanged, quality, permissions }

  private weak var port: LiveKitMediaPort?
  private weak var room: Room?

  init(port: LiveKitMediaPort, room: Room) {
    self.port = port
    self.room = room
  }

  private func send(_ r: Room, _ kind: Kind) {
    DispatchQueue.main.async { [weak self] in self?.port?.roomEvent(r, kind) }
  }

  func roomDidConnect(_ room: Room) { send(room, .connected) }
  func room(_ room: Room, didStartReconnectWithMode reconnectMode: ReconnectMode) { send(room, .reconnecting) }
  func room(_ room: Room, didCompleteReconnectWithMode reconnectMode: ReconnectMode) { send(room, .reconnected) }
  // Our own leave() removes this delegate before disconnecting, so any
  // disconnect seen here is the SFU giving up (or the server removing us).
  func room(_ room: Room, didDisconnectWithError error: LiveKitError?) { send(room, .disconnected) }
  func room(_ room: Room, participantDidConnect participant: RemoteParticipant) { send(room, .participantJoined) }
  func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) { send(room, .tracksChanged) }
  func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) { send(room, .tracksChanged) }
  func room(_ room: Room, participant: RemoteParticipant, didUnsubscribeTrack publication: RemoteTrackPublication) { send(room, .tracksChanged) }
  func room(_ room: Room, participant: RemoteParticipant, didPublishTrack publication: RemoteTrackPublication) { send(room, .tracksChanged) }
  func room(_ room: Room, participant: RemoteParticipant, didUnpublishTrack publication: RemoteTrackPublication) { send(room, .tracksChanged) }
  func room(_ room: Room, participant: LocalParticipant, didPublishTrack publication: LocalTrackPublication) { send(room, .tracksChanged) }
  func room(_ room: Room, participant: LocalParticipant, didUnpublishTrack publication: LocalTrackPublication) { send(room, .tracksChanged) }
  func room(_ room: Room, participant: Participant, trackPublication: TrackPublication, didUpdateIsMuted isMuted: Bool) { send(room, .tracksChanged) }
  func room(_ room: Room, didUpdateSpeakingParticipants participants: [Participant]) { send(room, .rosterChanged) }
  func room(_ room: Room, participant: Participant, didUpdateMetadata metadata: String?) { send(room, .rosterChanged) }
  func room(_ room: Room, participant: Participant, didUpdateAttributes attributes: [String: String]) { send(room, .rosterChanged) }
  func room(_ room: Room, participant: Participant, didUpdateConnectionQuality quality: ConnectionQuality) { send(room, .quality) }
  // Only ever the local participant's (LiveKit's own LocalParticipant sends it).
  func room(_ room: Room, participant: Participant, didUpdatePermissions permissions: ParticipantPermissions) {
    if participant is LocalParticipant { send(room, .permissions) }
  }
}
