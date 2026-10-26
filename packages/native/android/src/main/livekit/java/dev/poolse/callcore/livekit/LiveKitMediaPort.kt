package dev.poolse.callcore.livekit

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.twilio.audioswitch.AudioDevice
import dev.poolse.callcore.CallSessionBundle
import dev.poolse.callcore.MediaPort
import dev.poolse.callcore.android.AudioOutput
import dev.poolse.callcore.android.CallVideoSource
import dev.poolse.callcore.android.CallVideoSurface
import dev.poolse.callcore.android.MediaEvents
import dev.poolse.callcore.android.MediaParticipant
import io.livekit.android.ConnectOptions
import io.livekit.android.LiveKit
import io.livekit.android.audio.AudioSwitchHandler
import io.livekit.android.events.DisconnectReason
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.participant.ConnectionQuality
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.track.CameraPosition
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.RemoteTrackPublication
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * The shipped [MediaPort], over LiveKit's native Android SDK. Wire it
 * with [factory] in [dev.poolse.callcore.android.CallCoreConfig].
 *
 * This is the one adapter that depends on an external SFU SDK, so it
 * lives in its own source set (`src/main/livekit`) kept off the core
 * library's classpath. Lifecycle and signaling are not its concern — it
 * joins a room with the server-minted token, publishes the mic (and
 * camera for video), routes audio, and reports room transitions back
 * through [MediaEvents]. The runtime decides everything else.
 *
 * Threading: every method is called on the main thread (the runtime's
 * thread) and every coroutine runs on Main.immediate, so [room] is only
 * ever touched on main. Coroutines still re-check that the room they
 * captured is the current one — a join/leave may have replaced it
 * while they were suspended.
 */
class LiveKitMediaPort(
  private val context: Context,
  private val events: MediaEvents,
) : MediaPort, CallVideoSource {

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  @Volatile private var room: Room? = null
  private var eventJob: Job? = null
  private var media: String = "audio"
  // Speaker unless a headset is in: a video call, or a room (a drop-in
  // room is held like a meeting, not to the ear).
  private var loud = false

  /**
   * The user's output choice for the CURRENT call: an output id
   * (`speaker`, `earpiece`, `wired`, `bluetooth`) or [PRIVATE] — the
   * best private route. null = automatic (see [resolve]).
   */
  private var outputWanted: String? = null

  /** The current room's last device list; a newcomer in it takes the call. */
  private var knownDevices: List<AudioDevice>? = null

  /**
   * The user's mute / camera choices for the CURRENT call. They survive
   * a rejoin: /reconnect rebuilds the room, and blindly re-enabling the
   * mic there went live while the UI still showed "muted". Reset only
   * when the call ends ([leave]) or a different call joins.
   */
  private var mutedWanted = false
  private var cameraWanted: Boolean? = null
  private var joinedCallId: String? = null

  /** Our own link to the SFU, as last reported. */
  private var localQuality = "unknown"

  /**
   * Incoming video is switched off to keep the audio going (see
   * [qualityChanged]). Survives a rejoin of the same call, like mute.
   */
  private var videoPaused = false
  private var pauseJob: Job? = null
  private var resumeJob: Job? = null
  /** Remote camera publications this port switched off, by sid. */
  private val pausedSids = mutableSetOf<String>()

  /** Live `<CallVideoView>` slots; rebound whenever what they show may have changed. */
  private val surfaces = linkedSetOf<LiveKitVideoSurface>()

  override fun join(bundle: CallSessionBundle) {
    // Rejoin of the same call keeps the user's choices; so do choices
    // made while this call was still connecting (joinedCallId null). A
    // different call joining without a leave starts clean.
    if (joinedCallId != null && bundle.callId != joinedCallId) resetWanted()
    joinedCallId = bundle.callId
    detach()
    media = bundle.media
    val wantsVideo = bundle.media == "video"
    loud = wantsVideo || bundle.kind == "room"
    val newRoom = LiveKit.create(appContext = context.applicationContext)
    configureAudio(newRoom, loud)
    // A 1:1/small call: never let the SFU pause a subscribed camera for
    // "not visible" — a track whose view mounts late would stay black.
    // (Renderers are still registered with visibility via addRenderer.)
    newRoom.adaptiveStream = false
    newRoom.dynacast = false
    room = newRoom
    refreshVideo() // surfaces re-initialise against the new room's EGL
    eventJob = scope.launch { observe(newRoom) }
    scope.launch {
      val connected = runCatching {
        newRoom.connect(bundle.livekitUrl, bundle.livekitToken, ConnectOptions(autoSubscribe = true))
      }.onFailure {
        Log.w(TAG, "connect failed", it)
        if (room === newRoom) {
          // Don't leave a half-open room (and its audio mode) behind.
          eventJob?.cancel()
          eventJob = null
          room = null
          refreshVideo()
          teardown(newRoom)
          events.onFailed()
        }
      }.isSuccess
      if (!connected || room !== newRoom) return@launch
      // Publishing failures must not fail the call: audio-only is a call.
      runCatching { newRoom.localParticipant.setMicrophoneEnabled(!mutedWanted) }
        .onFailure { Log.w(TAG, "microphone publish failed", it) }
      if (cameraWanted ?: wantsVideo) enableCamera(newRoom, true)
      reportLocalCamera(newRoom)
      refreshVideo()
    }
  }

  private fun cameraGranted() =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
      PackageManager.PERMISSION_GRANTED

  /**
   * Publish / unpublish the camera. Without the CAMERA grant a video
   * call joins audio-only instead of failing; a later setCamera(true)
   * after the user grants it publishes then.
   */
  private suspend fun enableCamera(r: Room, on: Boolean) {
    if (on && !cameraGranted()) {
      Log.i(TAG, "CAMERA not granted: staying audio-only")
      return
    }
    runCatching { r.localParticipant.setCameraEnabled(on) }
      .onFailure { Log.w(TAG, "camera ${if (on) "publish" else "unpublish"} failed", it) }
  }

  /** The call is over for this device: drop the room AND the call's choices. */
  override fun leave() {
    detach()
    resetWanted()
    joinedCallId = null
  }

  private fun resetWanted() {
    mutedWanted = false
    cameraWanted = null
    outputWanted = null
    pauseJob?.cancel()
    resumeJob?.cancel()
    pauseJob = null
    resumeJob = null
    videoPaused = false
    localQuality = "unknown"
    reportNetwork()
  }

  /** Drop the current room only (a rejoin replaces it). */
  private fun detach() {
    eventJob?.cancel()
    eventJob = null
    // Their timers belong to that room; the next one starts its own.
    pauseJob?.cancel()
    resumeJob?.cancel()
    pauseJob = null
    resumeJob = null
    pausedSids.clear()
    val r = room ?: return
    room = null
    // Unbind every view from this room's tracks BEFORE its EGL is released.
    refreshVideo()
    teardown(r)
    events.onLocalCamera(false, null)
  }

  private fun teardown(r: Room) {
    runCatching { r.disconnect() }
    // disconnect() keeps the room's engine, capturer and audio handler
    // alive for a later reconnect; this port never reuses a room, so
    // release it or every call leaks a PeerConnectionFactory.
    runCatching { r.release() }
  }

  override fun setMuted(muted: Boolean) {
    mutedWanted = muted
    val r = room ?: return
    scope.launch { runCatching { r.localParticipant.setMicrophoneEnabled(!muted) } }
  }

  override fun setCamera(on: Boolean) {
    cameraWanted = on
    val r = room ?: return
    scope.launch {
      enableCamera(r, on)
      if (room !== r) return@launch
      reportLocalCamera(r)
      refreshVideo()
    }
  }

  /** Front ↔ back on the published camera track. */
  override fun switchCamera() {
    val r = room ?: return
    val track = localCameraTrack(r) ?: return
    val next = if (track.options.position == CameraPosition.BACK) CameraPosition.FRONT else CameraPosition.BACK
    runCatching { track.switchCamera(null, next) }.onFailure { Log.w(TAG, "switchCamera failed", it) }
    // The capturer switches asynchronously and updates the options when
    // done: report (and re-mirror the self view) once it has.
    scope.launch {
      delay(SWITCH_SETTLE_MS)
      if (room !== r) return@launch
      reportLocalCamera(r)
      refreshVideo()
    }
  }

  // ── video ───────────────────────────────────────────────────────────

  override fun createVideoSurface(context: Context): CallVideoSurface =
    LiveKitVideoSurface(context, this).also { surfaces += it }

  internal fun unregister(surface: LiveKitVideoSurface) { surfaces -= surface }

  internal fun currentRoom(): Room? = room

  private fun refreshVideo() {
    for (s in surfaces.toList()) s.rebind()
  }

  private fun localCameraTrack(r: Room): LocalVideoTrack? =
    r.localParticipant.getTrackPublication(Track.Source.CAMERA)
      ?.takeIf { !it.muted }?.track as? LocalVideoTrack

  /**
   * The camera track a view should show: the local one, or the remote
   * participant's — only once it is published, SUBSCRIBED and unmuted.
   */
  internal fun cameraTrack(participantId: String?, local: Boolean): VideoTrack? {
    val r = room ?: return null
    if (local) return localCameraTrack(r)
    val p = r.remoteParticipants.values.firstOrNull { it.identity?.value == participantId } ?: return null
    return remoteCamera(p)
  }

  private fun remoteCamera(p: Participant): VideoTrack? {
    // Paused: no picture to draw — the avatar shows, with the reason.
    if (videoPaused) return null
    val pub = p.getTrackPublication(Track.Source.CAMERA) as? RemoteTrackPublication ?: return null
    if (!pub.subscribed || pub.muted) return null
    return pub.track as? VideoTrack
  }

  /** `front` | `back` of the published local camera, or null when none. */
  internal fun cameraFacing(): String? {
    val r = room ?: return null
    return when (localCameraTrack(r)?.options?.position) {
      CameraPosition.FRONT -> "front"
      CameraPosition.BACK -> "back"
      null -> null
    }
  }

  private fun reportLocalCamera(r: Room) {
    if (room !== r) return
    val on = localCameraTrack(r) != null
    events.onLocalCamera(on, if (on) cameraFacing() else null)
  }

  override fun setSpeaker(on: Boolean) {
    outputWanted = if (on) SPEAKER else PRIVATE
    val handler = room?.audioHandler as? AudioSwitchHandler ?: return
    applyRoute(handler)
  }

  override fun setAudioOutput(id: String) {
    outputWanted = id
    val handler = room?.audioHandler as? AudioSwitchHandler ?: return
    applyRoute(handler)
  }

  // ── audio routing ───────────────────────────────────────────────────

  /**
   * Seed AudioSwitch's own order (it starts during connect, before any
   * choice is applied): a connected headset or Bluetooth device first,
   * then the earpiece for voice or the speaker for video.
   */
  private fun configureAudio(r: Room, video: Boolean) {
    val handler = r.audioHandler as? AudioSwitchHandler ?: return
    knownDevices = null
    handler.preferredDeviceList = if (video) {
      listOf(
        AudioDevice.BluetoothHeadset::class.java,
        AudioDevice.WiredHeadset::class.java,
        AudioDevice.Speakerphone::class.java,
        AudioDevice.Earpiece::class.java,
      )
    } else {
      listOf(
        AudioDevice.BluetoothHeadset::class.java,
        AudioDevice.WiredHeadset::class.java,
        AudioDevice.Earpiece::class.java,
        AudioDevice.Speakerphone::class.java,
      )
    }
    handler.audioDeviceChangeListener = listener@{ devices, selected ->
      if (room?.audioHandler !== handler) return@listener
      // Putting on a headset or connecting Bluetooth mid-call moves the
      // call to it, whatever was picked before — as the dialer does. The
      // first list of a room is not "new": a choice made while
      // connecting must survive it.
      val known = knownDevices
      if (known != null && devices.any { it.isExternal() && it !in known }) outputWanted = null
      knownDevices = devices
      val target = resolve(devices)
      if (target != null && target != selected) handler.selectDevice(target)
      report(handler, devices, handler.selectedAudioDevice ?: selected)
    }
  }

  private fun applyRoute(handler: AudioSwitchHandler) {
    val devices = handler.availableAudioDevices
    resolve(devices)?.let { if (it != handler.selectedAudioDevice) handler.selectDevice(it) }
    report(handler, devices, handler.selectedAudioDevice)
  }

  /**
   * Where the call should play. A chosen device while it is connected
   * (it is forgotten once it goes); otherwise a connected headset or
   * Bluetooth device, then the speaker for video or the earpiece for
   * voice — never the speaker over earbuds the user put on.
   */
  private fun resolve(devices: List<AudioDevice>): AudioDevice? {
    val wanted = outputWanted
    if (wanted != null && wanted != PRIVATE) {
      devices.firstOrNull { idOf(it) == wanted }?.let { return it }
      outputWanted = null
    }
    val external = devices.firstOrNull { it is AudioDevice.BluetoothHeadset }
      ?: devices.firstOrNull { it is AudioDevice.WiredHeadset }
    val earpiece = devices.firstOrNull { it is AudioDevice.Earpiece }
    val speaker = devices.firstOrNull { it is AudioDevice.Speakerphone }
    return when {
      external != null -> external
      outputWanted == PRIVATE -> earpiece ?: speaker
      loud -> speaker ?: earpiece
      else -> earpiece ?: speaker
    }
  }

  private fun report(handler: AudioSwitchHandler, devices: List<AudioDevice>, selected: AudioDevice?) {
    if (room?.audioHandler !== handler) return
    events.onAudioRoute(routeOf(selected))
    events.onAudioOutputs(
      devices.map { AudioOutput(id = idOf(it), kind = routeOf(it), name = nameOf(it)) },
      selected?.let(::idOf),
    )
  }

  private fun AudioDevice.isExternal() =
    this is AudioDevice.BluetoothHeadset || this is AudioDevice.WiredHeadset

  private fun idOf(d: AudioDevice): String = when (d) {
    is AudioDevice.Speakerphone -> SPEAKER
    is AudioDevice.Earpiece -> "earpiece"
    is AudioDevice.WiredHeadset -> "wired"
    // AudioSwitch carries one Bluetooth device: the active headset.
    is AudioDevice.BluetoothHeadset -> "bluetooth"
  }

  /** The Bluetooth device's own name; plain defaults for the rest. */
  private fun nameOf(d: AudioDevice): String = when (d) {
    is AudioDevice.Speakerphone -> "Speaker"
    is AudioDevice.Earpiece -> "Phone"
    is AudioDevice.WiredHeadset -> "Headphones"
    is AudioDevice.BluetoothHeadset -> d.name.ifBlank { "Bluetooth" }
  }

  private fun routeOf(d: AudioDevice?): String = when (d) {
    is AudioDevice.Speakerphone -> "speaker"
    is AudioDevice.BluetoothHeadset -> "bluetooth"
    is AudioDevice.WiredHeadset -> "headset"
    is AudioDevice.Earpiece -> "earpiece"
    null -> if (loud) "speaker" else "earpiece"
  }

  // ── room events ─────────────────────────────────────────────────────

  private suspend fun observe(room: Room) {
    room.events.collect { event ->
      if (this.room !== room) return@collect
      when (event) {
        is RoomEvent.Connected -> {
          (room.audioHandler as? AudioSwitchHandler)?.let(::applyRoute)
          events.onConnected()
          // Somebody may already be in (a late join, or a callee who
          // answered before our media came up): they will not "connect".
          if (room.remoteParticipants.isNotEmpty()) events.onRemoteJoined()
          emit(room)
          refreshVideo()
        }
        // LiveKit is resuming the SAME session (ICE restart / signal
        // resume). Only reflect it: tearing the room down here fought
        // its own recovery and turned every network blip into a rejoin.
        is RoomEvent.Reconnecting -> events.onReconnecting()
        is RoomEvent.Reconnected -> events.onRecovered()
        // LiveKit gave up (or the server removed us). Our own leave()
        // never gets here — the collector is cancelled first.
        is RoomEvent.Disconnected -> {
          if (event.reason != DisconnectReason.CLIENT_INITIATED) events.onLost()
        }
        is RoomEvent.ParticipantConnected -> { events.onRemoteJoined(); emit(room); refreshVideo() }
        // Anything that can make a camera appear, vanish or freeze:
        // update the roster's cameraOn, the local camera state, and
        // rebind every video view.
        is RoomEvent.ParticipantDisconnected,
        is RoomEvent.TrackSubscribed,
        is RoomEvent.TrackUnsubscribed,
        is RoomEvent.TrackMuted,
        is RoomEvent.TrackUnmuted,
        is RoomEvent.TrackPublished,
        is RoomEvent.TrackUnpublished,
        is RoomEvent.LocalTrackSubscribed -> {
          if (videoPaused) applyVideoPause(room)
          emit(room)
          reportLocalCamera(room)
          refreshVideo()
        }
        is RoomEvent.ConnectionQualityChanged -> {
          qualityChanged(room)
          emit(room)
        }
        is RoomEvent.ActiveSpeakersChanged,
        is RoomEvent.ParticipantMetadataChanged,
        is RoomEvent.ParticipantAttributesChanged -> emit(room)
        else -> Unit
      }
      Unit
    }
  }

  /** The REMOTE roster — the local participant is never included. */
  private fun emit(room: Room) {
    events.onParticipants(
      room.remoteParticipants.values.map {
        val identity = it.identity?.value ?: ""
        MediaParticipant(
          identity = identity,
          speaking = it.isSpeaking,
          muted = !it.isMicrophoneEnabled(),
          // Video, not avatar, only when there is a frame to draw:
          // published, subscribed and unmuted.
          cameraOn = remoteCamera(it) != null,
          connectionQuality = wire(it.connectionQuality),
          externalId = externalIdOf(it) ?: identity,
        )
      },
    )
  }

  /** The host's own user id, if the server put it in attributes/metadata. */
  // ── connection quality ──────────────────────────────────────────────

  /**
   * Our link went weak or came back. Weak for a while on a call with
   * video coming in: switch that video off so the audio keeps going —
   * the way FaceTime falls back — and bring it back once the link has
   * been good for a while. Brief dips change nothing.
   */
  private fun qualityChanged(r: Room) {
    if (room !== r) return
    val q = wire(r.localParticipant.connectionQuality)
    if (q == "poor" || q == "lost") {
      resumeJob?.cancel()
      resumeJob = null
      if (!videoPaused && pauseJob == null && hasRemoteVideo(r)) {
        pauseJob = scope.launch {
          delay(PAUSE_VIDEO_AFTER_MS)
          pauseJob = null
          if (room === r) setVideoPaused(r, true)
        }
      }
    } else if (q == "good") {
      pauseJob?.cancel()
      pauseJob = null
      if (videoPaused && resumeJob == null) {
        resumeJob = scope.launch {
          delay(RESUME_VIDEO_AFTER_MS)
          resumeJob = null
          if (room === r) setVideoPaused(r, false)
        }
      }
    }
    if (q != localQuality) {
      localQuality = q
      reportNetwork()
    }
  }

  private fun hasRemoteVideo(r: Room) =
    r.remoteParticipants.values.any { it.getTrackPublication(Track.Source.CAMERA) != null }

  private fun setVideoPaused(r: Room, paused: Boolean) {
    Log.i(TAG, "incoming video ${if (paused) "paused" else "resumed"} quality=$localQuality")
    videoPaused = paused
    applyVideoPause(r)
    refreshVideo()
    emit(r)
    reportNetwork()
  }

  /**
   * Every remote camera on or off to match [videoPaused] — including one
   * published after the pause began. Each publication is switched once:
   * this runs on every track event, and re-sending the setting each time
   * would only feed more events.
   */
  private fun applyVideoPause(r: Room) {
    val pubs = r.remoteParticipants.values.mapNotNull {
      it.getTrackPublication(Track.Source.CAMERA) as? RemoteTrackPublication
    }
    if (videoPaused) {
      for (pub in pubs) if (pausedSids.add(pub.sid)) runCatching { pub.setEnabled(false) }
    } else {
      for (pub in pubs) if (pausedSids.remove(pub.sid)) runCatching { pub.setEnabled(true) }
      pausedSids.clear()
    }
  }

  private fun reportNetwork() = events.onNetwork(localQuality, videoPaused)

  private fun externalIdOf(p: Participant): String? =
    runCatching { p.attributes["external_id"] }.getOrNull()?.ifEmpty { null }
      ?: p.metadata?.let { m ->
        runCatching { JSONObject(m).optString("external_id", "") }.getOrNull()?.ifEmpty { null }
      }

  fun dispose() {
    leave()
    for (s in surfaces.toList()) s.release()
    scope.cancel()
  }

  companion object {
    private const val TAG = "PoolseLiveKit"
    private const val SWITCH_SETTLE_MS = 600L
    private const val SPEAKER = "speaker"
    private const val PRIVATE = "private"

    /** Weak this long before incoming video is paused; good this long before it is back. */
    private const val PAUSE_VIDEO_AFTER_MS = 6_000L
    private const val RESUME_VIDEO_AFTER_MS = 10_000L

    fun wire(q: ConnectionQuality): String = when (q) {
      ConnectionQuality.EXCELLENT, ConnectionQuality.GOOD -> "good"
      ConnectionQuality.POOR -> "poor"
      ConnectionQuality.LOST -> "lost"
      else -> "unknown"
    }

    /** Pass as `mediaFactory` in CallCoreConfig. */
    val factory: (Context, MediaEvents) -> MediaPort = { ctx, ev -> LiveKitMediaPort(ctx, ev) }
  }
}
