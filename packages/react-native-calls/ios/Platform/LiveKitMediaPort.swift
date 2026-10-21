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
      pcTrace("connected; publishing mic muted=\(muted) audioActive=\(activeNow)")
      do { try await r.localParticipant.setMicrophone(enabled: !muted) } catch {
        NSLog("[PoolseCalls] microphone publish failed: %@", "\(error)")
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
      if camera { await self.enableCamera(r, true) }
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
    if !r.remoteParticipants.isEmpty { events?.onRemoteJoined() }
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
    outputWanted = nil
  }

  private func detach() {
    guard let r = room else { return }
    if let obs = observer { r.remove(delegate: obs) }
    room = nil
    observer = nil
    connectedRoom = nil
    refreshVideo()
    Task { await r.disconnect() }
    events?.onLocalCamera(on: false, facing: nil)
  }

  func setMuted(_ muted: Bool) {
    mutedWanted = muted
    guard let r = room, connectedRoom == ObjectIdentifier(r) else { return }
    Task { _ = try? await r.localParticipant.setMicrophone(enabled: !muted) }
  }

  func setCamera(_ on: Bool) {
    cameraWanted = on
    guard let r = room, connectedRoom == ObjectIdentifier(r) else { return }
    Task { [weak self] in
      await self?.enableCamera(r, on)
      await MainActor.run {
        guard let self = self, self.room === r else { return }
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

  func createVideoSurface() -> LiveKitVideoSurface {
    let s = LiveKitVideoSurface(port: self)
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
          let p = r.remoteParticipants.values.first(where: { $0.identity?.stringValue == id }) else { return nil }
    return remoteCamera(p)
  }

  private func remoteCamera(_ p: RemoteParticipant) -> VideoTrack? {
    guard let pub = p.trackPublications.values.first(where: { $0.source == .camera }) as? RemoteTrackPublication,
          pub.isSubscribed, !pub.isMuted else { return nil }
    return pub.track as? VideoTrack
  }

  /// `front` | `back` of the published local camera, or nil when none.
  func cameraFacing() -> String? {
    guard let r = room, let track = localCameraTrack(r) else { return nil }
    return (track.capturer as? CameraCapturer)?.position == .back ? "back" : "front"
  }

  private func reportLocalCamera(_ r: Room) {
    guard room === r else { return }
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
      events?.onLost()
    case .participantJoined:
      events?.onRemoteJoined()
      emit(r)
      refreshVideo()
    case .tracksChanged:
      emit(r)
      reportLocalCamera(r)
      refreshVideo()
    case .rosterChanged:
      emit(r)
    }
  }

  /// The REMOTE roster — the local participant is never included.
  private func emit(_ r: Room) {
    let roster = r.remoteParticipants.values.map { p -> SnapshotParticipant in
      let identity = p.identity?.stringValue ?? ""
      return SnapshotParticipant(
        userId: identity,
        externalId: externalId(p) ?? identity,
        speaking: p.isSpeaking,
        muted: !p.isMicrophoneEnabled(),
        cameraOn: remoteCamera(p) != nil
      )
    }
    events?.onParticipants(roster)
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
  enum Kind { case connected, reconnecting, reconnected, disconnected, participantJoined, tracksChanged, rosterChanged }

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
}
