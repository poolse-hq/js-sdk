import AVFoundation
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
  /// The local camera track is (not) published + enabled; facing `front` | `back`.
  func onLocalCamera(on: Bool, facing: String?)
}

/// Step-by-step trace of the audio path, in the device log as
/// "[PoolseCalls] trace …" — the order of activation, engine availability,
/// connect and publish is what cold-answer audio failures hinge on.
func pcTrace(_ message: @autoclosure () -> String) {
  NSLog("[PoolseCalls] trace %@", message())
}

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
  private var connectedRoom: ObjectIdentifier?

  /// Speaker forced by the user; nil = the media-type default.
  private var speakerWanted: Bool?
  /// The user's choices for the CURRENT call; survive a rejoin.
  private var mutedWanted = false
  private var cameraWanted: Bool?
  private var joinedCallId: String?

  private let surfaces = NSHashTable<LiveKitVideoSurface>.weakObjects()
  private var audioPrepared = false
  private var audioActive = false
  /// The room whose audio engine has been kicked (once per room).
  private var audioKicked: ObjectIdentifier?

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
    kickAudioIfReady()
  }

  /// Once per call, the first moment the session is active AND the mic is
  /// published (in whichever order they happen): make LiveKit's audio
  /// engine rebuild around the live mic.
  ///
  /// On a call answered with the app closed, the process is brand new and
  /// LiveKit's engine never started for a mic published right after
  /// CallKit made audio available — no capture, no playback, though the
  /// session was correct (video, which needs no audio engine, worked). A
  /// user-side mute → unmute cured it, because toggling the mic makes the
  /// engine re-evaluate and start. This does the same, automatically: an
  /// availability cycle first, then a mic off/on. A deliberate mute is
  /// left alone. The remote hears at most a sub-second blip at connect.
  private func kickAudioIfReady() {
    guard audioActive, let r = room, connectedRoom == ObjectIdentifier(r),
          audioKicked != ObjectIdentifier(r), !mutedWanted else { return }
    guard r.localParticipant.isMicrophoneEnabled() else { return }
    audioKicked = ObjectIdentifier(r)
    pcTrace("kick: cycling engine availability + mic")
    do {
      try AudioManager.shared.setEngineAvailability(.none)
      try AudioManager.shared.setEngineAvailability(.default)
    } catch {
      NSLog("[PoolseCalls] engine availability cycle failed: %@", "\(error)")
    }
    Task { [weak self] in
      try? await Task.sleep(nanoseconds: 250_000_000)
      let still = await MainActor.run { () -> Bool in
        guard let self = self else { return false }
        return self.room === r && self.audioActive && !self.mutedWanted
      }
      guard still else { return }
      do {
        try await r.localParticipant.setMicrophone(enabled: false)
        try await r.localParticipant.setMicrophone(enabled: true)
      } catch {
        NSLog("[PoolseCalls] mic cycle failed: %@", "\(error)")
      }
      pcTrace("kick done enabled=\(r.localParticipant.isMicrophoneEnabled()) \(pcSessionDescription())")
      await MainActor.run { self?.reassertAudio() }
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
    let mode: AVAudioSession.Mode = media == "video" && speakerWanted != false ? .videoChat : .voiceChat
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
        self.kickAudioIfReady()
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
    if speakerWanted != nil { applyRoute() }
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
    speakerWanted = nil
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
    speakerWanted = on
    applyRoute()
  }

  // MARK: - audio routing

  /// A voice call is held to the ear (earpiece, or a headset/Bluetooth
  /// route first); video defaults to the loudspeaker.
  private func applyRoute() {
    guard audioActive else { return }
    let s = AVAudioSession.sharedInstance()
    let want = speakerWanted ?? (media == "video")
    do {
      if want {
        try s.overrideOutputAudioPort(.speaker)
      } else {
        // .videoChat forces the speaker; the private route needs .voiceChat.
        if s.mode == .videoChat { try s.setMode(.voiceChat) }
        try s.overrideOutputAudioPort(.none)
      }
    } catch {
      NSLog("[PoolseCalls] audio route failed: %@", "\(error)")
    }
    reportRoute()
  }

  private func currentRoute() -> String {
    let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
    guard let port = outputs.first?.portType else { return media == "video" ? "speaker" : "earpiece" }
    switch port {
    case .builtInSpeaker: return "speaker"
    case .builtInReceiver: return "earpiece"
    case .bluetoothHFP, .bluetoothA2DP, .bluetoothLE, .carAudio, .airPlay: return "bluetooth"
    case .headphones, .usbAudio, .lineOut, .HDMI: return "headset"
    default: return "headset"
    }
  }

  private func reportRoute() {
    guard joinedCallId != nil || audioActive else { return }
    events?.onAudioRoute(currentRoute())
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
      // A user's speaker choice survives route changes, except that a
      // newly connected headset/Bluetooth device always wins.
      let route = self.currentRoute()
      if let wanted = self.speakerWanted, route == "speaker" || route == "earpiece", (route == "speaker") != wanted {
        self.applyRoute()
        return
      }
      self.reportRoute()
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
