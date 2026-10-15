package dev.poolse.callcore.livekit

import android.content.Context
import dev.poolse.callcore.CallSessionBundle
import dev.poolse.callcore.MediaPort
import dev.poolse.callcore.android.MediaEvents
import dev.poolse.callcore.android.MediaParticipant
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The shipped [MediaPort], over LiveKit's native Android SDK. Wire it
 * with [factory] in [dev.poolse.callcore.android.CallCoreConfig].
 *
 * This is the one adapter that depends on an external SFU SDK, so it
 * lives in its own source set (`src/main/livekit`) kept off the core
 * library's classpath. Lifecycle and signaling are not its concern — it
 * joins a room with the server-minted token, publishes the mic (and
 * camera for video), and reports room transitions back through
 * [MediaEvents]. The runtime decides everything else.
 */
class LiveKitMediaPort(
  private val context: Context,
  private val events: MediaEvents,
) : MediaPort {

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var room: Room? = null
  private var eventJob: Job? = null

  override fun join(bundle: CallSessionBundle) {
    leave()
    val wantsVideo = bundle.media == "video"
    val newRoom = LiveKit.create(appContext = context.applicationContext)
    room = newRoom
    eventJob = scope.launch { observe(newRoom) }
    scope.launch {
      runCatching {
        newRoom.connect(bundle.livekitUrl, bundle.livekitToken)
        newRoom.localParticipant.setMicrophoneEnabled(true)
        if (wantsVideo) newRoom.localParticipant.setCameraEnabled(true)
      }.onFailure { events.onFailed() }
    }
  }

  override fun leave() {
    eventJob?.cancel()
    eventJob = null
    room?.disconnect()
    room = null
  }

  override fun setMuted(muted: Boolean) {
    scope.launch { room?.localParticipant?.setMicrophoneEnabled(!muted) }
  }

  override fun setCamera(on: Boolean) {
    scope.launch { room?.localParticipant?.setCameraEnabled(on) }
  }

  override fun switchCamera() {
    // The host's VideoTrackView performs the actual flip; exposing the
    // control here keeps the port surface complete.
  }

  private suspend fun observe(room: Room) {
    room.events.collect { event ->
      when (event) {
        is RoomEvent.Connected -> events.onConnected()
        is RoomEvent.Reconnecting, is RoomEvent.Disconnected -> events.onLost()
        is RoomEvent.Reconnected -> events.onRecovered()
        is RoomEvent.ParticipantConnected -> { events.onRemoteJoined(); emit(room) }
        is RoomEvent.ParticipantDisconnected,
        is RoomEvent.ActiveSpeakersChanged,
        is RoomEvent.TrackMuted,
        is RoomEvent.TrackUnmuted -> emit(room)
        else -> Unit
      }
    }
  }

  private fun emit(room: Room) {
    events.onParticipants(
      room.remoteParticipants.values.map {
        MediaParticipant(
          identity = it.identity?.value ?: "",
          speaking = it.isSpeaking,
          muted = it.audioTrackPublications.firstOrNull()?.first?.muted ?: true,
        )
      },
    )
  }

  fun dispose() = scope.cancel()

  companion object {
    /** Pass as `mediaFactory` in CallCoreConfig. */
    val factory: (Context, MediaEvents) -> MediaPort = { ctx, ev -> LiveKitMediaPort(ctx, ev) }
  }
}
