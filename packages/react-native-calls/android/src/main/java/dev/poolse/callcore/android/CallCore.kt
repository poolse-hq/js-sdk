package dev.poolse.callcore.android

import android.content.Context
import android.content.Intent
import dev.poolse.callcore.CallCoreRuntime
import dev.poolse.callcore.MachineState
import dev.poolse.callcore.MediaPort
import dev.poolse.callcore.RingContext
import dev.poolse.callcore.SnapshotSink

/**
 * The composition root and the single native entry point.
 *
 * Everything that can originate a call action — the FCM service, the
 * notification receiver, the full-screen activity, the React Native
 * bridge — comes through here, so there is exactly one runtime and one
 * answer/decline path on the device. Process-singleton, created lazily
 * from the first caller's application context.
 */
class CallCore private constructor(context: Context) {

  private val appContext = context.applicationContext

  // The SFU is injected, not baked in: the core stays media-engine
  // agnostic (CONTRACT.md — "LiveKit or any SFU"), and the library
  // compiles without a specific media SDK on the classpath. The host
  // supplies the factory; LiveKitMediaPort is the first implementation.
  private val media: MediaPort = requireConfig().mediaFactory(appContext, mediaEvents())
  private val surface = AndroidRingSurface(appContext, requireConfig().ringSurface)
  private val runtime = CallCoreRuntime(
    http = CallHttpClient(requireConfig().apiBaseUrl),
    media = media,
    surface = surface,
    session = CallForegroundService.also { it.attach(appContext) },
    timers = HandlerTimerPort(),
    sink = SnapshotSink { emitSnapshot(it) },
  )

  // ── native entry points ─────────────────────────────────────────────

  /** A ring arrived — from FCM (closed app) or the socket (open app). */
  fun onRing(ring: RingContext) = runtime.onRing(ring)

  /** The caller withdrew, or the ring resolved elsewhere. */
  fun onRingEnded(callId: String, reason: String) = runtime.onRingEnded(callId, reason)

  fun onCallFinished(callId: String) = runtime.onCallFinished(callId)

  fun onUserAnswer(ring: RingContext) {
    runtime.onRing(ring) // idempotent: dedupes if already showing
    runtime.answer()
    bringAppToFront(ring)
  }

  fun onUserDecline(ring: RingContext) {
    runtime.onRing(ring)
    runtime.decline()
  }

  fun onUserOpen(ring: RingContext) {
    runtime.onRing(ring)
    bringAppToFront(ring)
  }

  // ── bridge-driven actions ───────────────────────────────────────────

  fun answer() = runtime.answer()
  fun decline() = runtime.decline()
  fun hangUp() = runtime.hangUp()
  fun place(conversationId: String, media: String, sessionToken: String) =
    runtime.place(conversationId, media, sessionToken)
  fun join(callId: String, conversationId: String?, sessionToken: String) =
    runtime.join(callId, conversationId, sessionToken)
  fun setMuted(muted: Boolean) = runtime.setMuted(muted)
  fun setCamera(on: Boolean) = runtime.setCamera(on)
  fun switchCamera() = runtime.switchCamera()

  fun snapshot(): MachineState = runtime.currentState()

  /** The bridge subscribes here; replaced each mount, cleared on unmount. */
  @Volatile var snapshotListener: ((MachineState) -> Unit)? = null

  private fun emitSnapshot(state: MachineState) {
    snapshotListener?.invoke(state)
  }

  private fun mediaEvents() = object : MediaEvents {
    override fun onConnected() = runtime.onMediaConnected()
    override fun onFailed() = runtime.onMediaFailed()
    override fun onLost() = runtime.onMediaLost()
    override fun onRecovered() = runtime.onMediaRecovered()
    override fun onRemoteJoined() = runtime.onRemoteJoined()
    override fun onParticipants(participants: List<MediaParticipant>) {
      // Participant roster flows to the bridge via the snapshot; the
      // runtime does not need the detail to drive the machine.
    }
  }

  private fun bringAppToFront(ring: RingContext) {
    val launch = appContext.packageManager.getLaunchIntentForPackage(appContext.packageName)
      ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    launch.putExtra(EXTRA_LAUNCH_CALL, ring.callId)
    runCatching { appContext.startActivity(launch) }
  }

  companion object {
    const val EXTRA_LAUNCH_CALL = "poolse_launch_call"

    @Volatile private var instance: CallCore? = null
    @Volatile private var config: CallCoreConfig? = null

    /**
     * Host apps call this once (the bridge does it on configure, or an
     * app can do it in Application.onCreate) before any ring can arrive.
     */
    fun configure(config: CallCoreConfig) {
      this.config = config
    }

    fun get(context: Context): CallCore =
      instance ?: synchronized(this) {
        instance ?: CallCore(context).also { instance = it }
      }

    internal fun peekConfig(): CallCoreConfig? = config

    internal fun requireConfig(): CallCoreConfig =
      config ?: error("CallCore.configure() must be called before use")
  }
}

/**
 * The host-supplied configuration: the API base URL the HTTP doors
 * target, and the drawable/raw resources the surfaces need. Everything
 * here is knowable only by the app, never by the library.
 */
data class CallCoreConfig(
  val apiBaseUrl: String,
  val smallIcon: Int,
  val ringbackRawRes: Int,
  /**
   * Builds the media engine for a call. Injected so the core carries no
   * SFU dependency; pass `::LiveKitMediaPortFactory` (the shipped
   * implementation) or your own.
   */
  val mediaFactory: (Context, MediaEvents) -> MediaPort,
) {
  internal val ringSurface get() = RingSurfaceConfig(smallIcon, ringbackRawRes)
}

/** Media-level signals the SFU adapter reports back to the core. */
interface MediaEvents {
  fun onConnected()
  fun onFailed()
  fun onLost()
  fun onRecovered()
  fun onRemoteJoined()
  fun onParticipants(participants: List<MediaParticipant>)
}

data class MediaParticipant(
  val identity: String,
  val speaking: Boolean,
  val muted: Boolean,
)
