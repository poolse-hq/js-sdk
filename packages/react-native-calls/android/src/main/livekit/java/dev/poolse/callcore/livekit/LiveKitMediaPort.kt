package dev.poolse.callcore.livekit

import android.content.Context
import android.util.Log
import com.twilio.audioswitch.AudioDevice
import dev.poolse.callcore.CallSessionBundle
import dev.poolse.callcore.MediaPort
import dev.poolse.callcore.android.MediaEvents
import dev.poolse.callcore.android.MediaParticipant
import io.livekit.android.LiveKit
import io.livekit.android.audio.AudioSwitchHandler
import io.livekit.android.events.DisconnectReason
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.participant.Participant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
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
) : MediaPort {

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  @Volatile private var room: Room? = null
  private var eventJob: Job? = null
  private var media: String = "audio"

  /** Speaker forced by the user; null = the media-type default. */
  private var speakerWanted: Boolean? = null

  /**
   * The user's mute / camera choices for the CURRENT call. They survive
   * a rejoin: /reconnect rebuilds the room, and blindly re-enabling the
   * mic there went live while the UI still showed "muted". Reset only
   * when the call ends ([leave]) or a different call joins.
   */
  private var mutedWanted = false
  private var cameraWanted: Boolean? = null
  private var joinedCallId: String? = null

  override fun join(bundle: CallSessionBundle) {
    // Rejoin of the same call keeps the user's choices; so do choices
    // made while this call was still connecting (joinedCallId null). A
    // different call joining without a leave starts clean.
    if (joinedCallId != null && bundle.callId != joinedCallId) resetWanted()
    joinedCallId = bundle.callId
    detach()
    media = bundle.media
    val wantsVideo = bundle.media == "video"
    val newRoom = LiveKit.create(appContext = context.applicationContext)
    configureAudio(newRoom, wantsVideo)
    room = newRoom
    eventJob = scope.launch { observe(newRoom) }
    scope.launch {
      runCatching {
        newRoom.connect(bundle.livekitUrl, bundle.livekitToken)
        if (room !== newRoom) return@runCatching
        newRoom.localParticipant.setMicrophoneEnabled(!mutedWanted)
        if (cameraWanted ?: wantsVideo) newRoom.localParticipant.setCameraEnabled(true)
      }.onFailure {
        Log.w(TAG, "connect failed", it)
        if (room === newRoom) {
          // Don't leave a half-open room (and its audio mode) behind.
          eventJob?.cancel()
          eventJob = null
          teardown(newRoom)
          room = null
          events.onFailed()
        }
      }
    }
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
    speakerWanted = null
  }

  /** Drop the current room only (a rejoin replaces it). */
  private fun detach() {
    eventJob?.cancel()
    eventJob = null
    val r = room ?: return
    room = null
    teardown(r)
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
    scope.launch { runCatching { r.localParticipant.setCameraEnabled(on) } }
  }

  override fun switchCamera() {
    // The host's VideoTrackView performs the actual flip; exposing the
    // control here keeps the port surface complete.
  }

  override fun setSpeaker(on: Boolean) {
    speakerWanted = on
    val handler = room?.audioHandler as? AudioSwitchHandler ?: return
    applyRoute(handler)
  }

  // ── audio routing ───────────────────────────────────────────────────

  /**
   * A voice call is held to the ear: earpiece by default (a connected
   * headset or Bluetooth device first); video defaults to the speaker.
   * Set before connect — the handler starts during connect.
   */
  private fun configureAudio(r: Room, video: Boolean) {
    val handler = r.audioHandler as? AudioSwitchHandler ?: return
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
    handler.audioDeviceChangeListener = { devices, selected ->
      // A user's speaker choice survives device-list changes, except
      // that plugging in a headset always wins (as the dialer does).
      val wanted = speakerWanted
      if (wanted != null && selected != null && room?.audioHandler === handler) {
        val external = selected is AudioDevice.BluetoothHeadset || selected is AudioDevice.WiredHeadset
        val isSpeaker = selected is AudioDevice.Speakerphone
        if (!external && isSpeaker != wanted) devices.pick(wanted)?.let(handler::selectDevice)
      }
      events.onAudioRoute(routeOf(handler.selectedAudioDevice ?: selected))
    }
  }

  private fun applyRoute(handler: AudioSwitchHandler) {
    val want = speakerWanted ?: (media == "video")
    handler.availableAudioDevices.pick(want)?.let(handler::selectDevice)
    events.onAudioRoute(routeOf(handler.selectedAudioDevice))
  }

  /** Speaker, or the best private route: Bluetooth → wired → earpiece. */
  private fun List<AudioDevice>.pick(speaker: Boolean): AudioDevice? =
    if (speaker) firstOrNull { it is AudioDevice.Speakerphone }
    else firstOrNull { it is AudioDevice.BluetoothHeadset }
      ?: firstOrNull { it is AudioDevice.WiredHeadset }
      ?: firstOrNull { it is AudioDevice.Earpiece }

  private fun routeOf(d: AudioDevice?): String = when (d) {
    is AudioDevice.Speakerphone -> "speaker"
    is AudioDevice.BluetoothHeadset -> "bluetooth"
    is AudioDevice.WiredHeadset -> "headset"
    is AudioDevice.Earpiece -> "earpiece"
    null -> if (media == "video") "speaker" else "earpiece"
  }

  // ── room events ─────────────────────────────────────────────────────

  private suspend fun observe(room: Room) {
    room.events.collect { event ->
      if (this.room !== room) return@collect
      when (event) {
        is RoomEvent.Connected -> {
          (room.audioHandler as? AudioSwitchHandler)?.let { if (speakerWanted != null) applyRoute(it) }
          events.onConnected()
          // Somebody may already be in (a late join, or a callee who
          // answered before our media came up): they will not "connect".
          if (room.remoteParticipants.isNotEmpty()) events.onRemoteJoined()
          emit(room)
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
        is RoomEvent.ParticipantConnected -> { events.onRemoteJoined(); emit(room) }
        is RoomEvent.ParticipantDisconnected,
        is RoomEvent.ActiveSpeakersChanged,
        is RoomEvent.TrackMuted,
        is RoomEvent.TrackUnmuted,
        is RoomEvent.TrackPublished,
        is RoomEvent.TrackUnpublished,
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
          cameraOn = it.isCameraEnabled(),
          externalId = externalIdOf(it) ?: identity,
        )
      },
    )
  }

  /** The host's own user id, if the server put it in attributes/metadata. */
  private fun externalIdOf(p: Participant): String? =
    runCatching { p.attributes["external_id"] }.getOrNull()?.ifEmpty { null }
      ?: p.metadata?.let { m ->
        runCatching { JSONObject(m).optString("external_id", "") }.getOrNull()?.ifEmpty { null }
      }

  fun dispose() {
    leave()
    scope.cancel()
  }

  companion object {
    private const val TAG = "PoolseLiveKit"

    /** Pass as `mediaFactory` in CallCoreConfig. */
    val factory: (Context, MediaEvents) -> MediaPort = { ctx, ev -> LiveKitMediaPort(ctx, ev) }
  }
}
