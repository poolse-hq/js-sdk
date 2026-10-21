package dev.poolse.callcore.android

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import dev.poolse.callcore.CallCoreRuntime
import dev.poolse.callcore.MachineState
import dev.poolse.callcore.MediaPort
import dev.poolse.callcore.Phase
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
 *
 * It also owns what the pure machine deliberately does not carry but a
 * truthful snapshot needs: the remote roster, the conversation name,
 * self mute/camera, and the audio route. All of it lives on the
 * runtime's single thread and is merged into every snapshot.
 */
class CallCore private constructor(context: Context) {

  private val appContext = context.applicationContext
  private val main = Handler(Looper.getMainLooper())

  // The SFU is injected, not baked in: the core stays media-engine
  // agnostic (CONTRACT.md — "LiveKit or any SFU"), and the library
  // compiles without a specific media SDK on the classpath. The host
  // supplies the factory; LiveKitMediaPort is the first implementation.
  private val media: MediaPort = requireConfig().mediaFactory(appContext, mediaEvents())

  // Surface + HTTP read the config on every use, so a later configure()
  // (another API origin, icon, ringback) applies without a rebuild.
  private val surface = AndroidRingSurface(appContext) {
    peekConfig()?.ringSurface ?: RingSurfaceConfig(appContext.applicationInfo.icon, 0)
  }

  private val runtime = CallCoreRuntime(
    http = CallHttpClient({ peekConfig()?.apiBaseUrl ?: "" }),
    media = media,
    surface = surface,
    session = CallForegroundService.also { it.attach(appContext) },
    timers = HandlerTimerPort(main),
    sink = SnapshotSink { onState(it) },
    // One thread for every input: the main looper — where LiveKit,
    // the timers, the notification and the service lifecycle already
    // live. Already on it? Run now; the runtime's trampoline still
    // queues anything produced mid-dispatch.
    executor = { r -> if (Looper.myLooper() == Looper.getMainLooper()) r.run() else main.post(r) },
    onError = { Log.e(TAG, "call runtime task failed", it) },
  )

  // ── snapshot extras (runtime thread only) ───────────────────────────

  private var extrasCallId: String? = null
  private var extrasMedia: String? = null
  private var roster: List<MediaParticipant> = emptyList()
  private var conversationName: String? = null
  private var callKind: String = "call"

  // Video calls and rooms default to the speaker (the media port agrees).
  private fun loud(state: MachineState) = state.media == "video" || callKind == "room"
  private var mutedSelf = false
  private var cameraOn = false
  private var cameraFacing: String? = null
  private var audioRoute: String? = null
  private var audioOutputs: List<AudioOutput> = emptyList()
  private var audioOutputId: String? = null

  /** Last snapshot emitted; read by the bridge's getCallState from any thread. */
  @Volatile private var lastSnapshot: Map<String, Any?>? = null

  private val proximity: PowerManager.WakeLock? = runCatching {
    val pm = appContext.getSystemService(PowerManager::class.java)
    if (pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
      pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "poolse:call-proximity")
        .apply { setReferenceCounted(false) }
    } else null
  }.getOrNull()

  // ── native entry points ─────────────────────────────────────────────

  /** A ring arrived — from FCM (closed app) or the socket (open app). */
  fun onRing(ring: RingContext) = runtime.onRing(ring)

  /**
   * The caller withdrew, or the ring resolved elsewhere. Beyond the
   * machine (which only knows the ring it is showing), ALWAYS tear down
   * any surface for this call: after a process restart the notification
   * and full-screen activity outlive the in-memory state that would
   * otherwise dismiss them.
   */
  fun onRingEnded(callId: String, reason: String) {
    runtime.onRingEnded(callId, reason)
    runtime.post { tearDownRing(callId) }
  }

  /** The server finished the call (push `finished` or socket `call:finished`). */
  fun onCallFinished(callId: String, reason: String? = null) {
    runtime.onCallFinished(callId, reason)
    runtime.post { tearDownRing(callId) }
  }

  /**
   * Answer from a native surface. [from] is the activity the tap
   * landed in: the app must be brought forward from THAT context — a
   * background start from the application context is blocked on
   * Android 10+ and left audio connected behind the lock screen.
   */
  fun onUserAnswer(ring: RingContext, from: Context? = null): Boolean {
    runtime.onRing(ring) // idempotent: dedupes if already showing
    runtime.answer()
    return bringAppToFront(ring.callId, from)
  }

  fun onUserDecline(ring: RingContext) {
    runtime.onRing(ring)
    runtime.decline()
  }

  fun onUserOpen(ring: RingContext, from: Context? = null) {
    runtime.onRing(ring)
    bringAppToFront(ring.callId, from)
  }

  /** False once this ring is resolved here or past its deadline (+ clock slack). */
  fun isRingLive(ring: RingContext): Boolean =
    !runtime.isResolved(ring.callId) &&
      ring.ringDeadlineEpochMs + CallCoreRuntime.CLOCK_SLACK_MS > System.currentTimeMillis()

  // ── bridge-driven actions ───────────────────────────────────────────

  fun answer() = runtime.answer()
  fun decline() = runtime.decline()
  fun hangUp() = runtime.hangUp()
  /** Call waiting: end this call, answer the waiting one ([callId]: only if still that one). */
  fun answerWaiting(callId: String? = null) = runtime.answerWaiting(callId)
  /** Call waiting: turn the waiting call away — its caller hears busy. */
  fun declineWaiting(callId: String? = null) = runtime.declineWaiting(callId)
  fun place(conversationId: String, media: String, sessionToken: String) =
    runtime.place(conversationId, media, sessionToken)
  fun join(callId: String, conversationId: String?, sessionToken: String) =
    runtime.join(callId, conversationId, sessionToken)

  fun setMuted(muted: Boolean) {
    runtime.post { mutedSelf = muted }
    runtime.setMuted(muted)
    runtime.reemit()
  }

  /**
   * Not optimistic: `cameraOn` in the snapshot flips only when the
   * media adapter reports the local camera track actually published
   * (it may be refused — e.g. no CAMERA permission).
   */
  fun setCamera(on: Boolean) = runtime.setCamera(on)

  fun switchCamera() = runtime.switchCamera()

  /**
   * A video slot for `<CallVideoView>`, or null when the media engine
   * renders no video (signalling-only build). Main thread.
   */
  fun createVideoSurface(context: Context): CallVideoSurface? =
    (media as? CallVideoSource)?.createVideoSurface(context)

  fun setSpeaker(on: Boolean) {
    // Optimistic; the media adapter reports the route it actually got.
    runtime.post { audioRoute = if (on) "speaker" else "earpiece" }
    runtime.setSpeaker(on)
    runtime.reemit()
  }

  /**
   * Play through one output from the snapshot's `audioOutputs`. Not
   * optimistic: the adapter reports the route once the OS has moved it.
   */
  fun setAudioOutput(id: String) = runtime.setAudioOutput(id)

  fun allRingsResolved(outcome: String) = runtime.allRingsResolved(outcome)

  fun state(): MachineState = runtime.currentState()

  /** The contract Snapshot (`null` = idle), safe from any thread. */
  fun snapshot(): Map<String, Any?>? = lastSnapshot

  // ── snapshot assembly (runtime thread) ──────────────────────────────

  private fun onState(state: MachineState) {
    if (state.phase == Phase.IDLE) {
      if (extrasCallId != null) {
        // Idle: no call owns media any more. Clears the port's per-call
        // mute/camera/speaker choices even when the call ended on a path
        // with no MEDIA_LEAVE (e.g. refused while connecting).
        media.leave()
      }
      resetExtras(null, null)
    } else if (state.callId != extrasCallId) {
      // `pending:<conv>` → the server-minted id is the same call.
      if (extrasCallId?.startsWith("pending:") == true) extrasCallId = state.callId
      else resetExtras(state.callId, state.media)
    }
    if (state.phase != Phase.IDLE && state.media != extrasMedia) {
      // The server corrected the media (a join defaults to audio until
      // its bundle says otherwise): re-derive what depends on it.
      if (extrasMedia != null) {
        audioRoute = null
        CallForegroundService.updateCall(state.callId ?: "", state.media)
      }
      extrasMedia = state.media
    }
    runtime.conversationName?.let { conversationName = it }
    runtime.callKind?.let { callKind = it }

    val snap = state.toSnapshot(
      conversationName = conversationName,
      kind = callKind,
      participants = roster.map {
        mapOf(
          "userId" to it.identity,
          "externalId" to it.externalId,
          "speaking" to it.speaking,
          "muted" to it.muted,
          "cameraOn" to it.cameraOn,
        )
      },
      audioRoute = audioRoute ?: if (loud(state)) "speaker" else "earpiece",
      audioOutputs = audioOutputs.map { mapOf("id" to it.id, "kind" to it.kind, "name" to it.name) },
      audioOutputId = audioOutputId,
      mutedSelf = mutedSelf,
      cameraOn = cameraOn,
      cameraFacing = cameraFacing,
      waitingRing = runtime.waitingRing,
    )
    lastSnapshot = snap
    reconcileAndroid(state)
    runCatching { listener?.invoke(snap) }.onFailure { Log.w(TAG, "snapshot listener failed", it) }
  }

  private fun resetExtras(callId: String?, media: String?) {
    extrasCallId = callId
    extrasMedia = media
    roster = emptyList()
    conversationName = null
    callKind = "call"
    mutedSelf = false
    // Reported by the media adapter once the camera is really published.
    cameraOn = false
    cameraFacing = null
    audioRoute = null
    audioOutputs = emptyList()
    audioOutputId = null
  }

  /**
   * OS-level consequences of the state, applied after the FINAL state
   * of each dispatch — so an answer's DISMISS_RING → CALL_SESSION_START
   * hands the foreground service from ring to call without a gap.
   */
  private fun reconcileAndroid(state: MachineState) {
    // Keep the process alive while ringing (OEM freezers otherwise kill
    // the ringtone and the deadline timer of a closed app).
    if (state.phase == Phase.RINGING_IN) {
      CallForegroundService.startRing(state.callId ?: "")
    } else {
      CallForegroundService.stopRing()
    }

    if (state.phase == Phase.IDLE || state.phase == Phase.ENDED) surface.setCommunicationReady(false)

    // Screen off at the ear: only for an audio call on the earpiece.
    val inCall = state.phase == Phase.ACTIVE || state.phase == Phase.RECONNECTING ||
      state.phase == Phase.RINGING_OUT || state.phase == Phase.CONNECTING
    val earpiece = (audioRoute ?: if (loud(state)) "speaker" else "earpiece") == "earpiece"
    setProximity(inCall && state.media == "audio" && earpiece)
  }

  private fun setProximity(on: Boolean) {
    val lock = proximity ?: return
    runCatching {
      if (on && !lock.isHeld) lock.acquire(4 * 60 * 60 * 1000L)
      else if (!on && lock.isHeld) lock.release(PowerManager.RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY)
    }.onFailure { Log.w(TAG, "proximity wake lock", it) }
  }

  private fun tearDownRing(callId: String) {
    val s = runtime.currentState()
    surface.dismiss(callId)
    // Never silence a DIFFERENT call that is ringing right now.
    if (!(s.phase == Phase.RINGING_IN && s.callId != callId)) surface.ringtoneStop()
    if (s.phase != Phase.RINGING_IN) CallForegroundService.stopRing()
  }

  private fun mediaEvents() = object : MediaEvents {
    override fun onConnected() {
      // The communication audio mode is set by now: ringback may play
      // through the call route (earpiece), not the loudspeaker.
      runtime.post { surface.setCommunicationReady(true) }
      runtime.onMediaConnected()
    }
    override fun onFailed() = runtime.onMediaFailed()
    override fun onLost() = runtime.onMediaLost()
    override fun onReconnecting() = runtime.onMediaReconnecting()
    override fun onRecovered() = runtime.onMediaRecovered()
    override fun onRemoteJoined() = runtime.onRemoteJoined()
    override fun onParticipants(participants: List<MediaParticipant>) {
      runtime.post { roster = participants }
      runtime.reemit()
    }
    override fun onAudioRoute(route: String) {
      runtime.post { audioRoute = route }
      runtime.reemit()
    }
    override fun onLocalCamera(on: Boolean, facing: String?) {
      runtime.post { cameraOn = on; cameraFacing = facing }
      runtime.reemit()
    }
    override fun onAudioOutputs(outputs: List<AudioOutput>, selectedId: String?) {
      runtime.post { audioOutputs = outputs; audioOutputId = selectedId }
      runtime.reemit()
    }
  }

  private fun bringAppToFront(callId: String, from: Context?): Boolean {
    val launch = appContext.packageManager.getLaunchIntentForPackage(appContext.packageName)
      ?: return false
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    // The host's MainActivity reads this to show over the keyguard and
    // dismiss it, and to route straight to the call screen.
    launch.putExtra(EXTRA_LAUNCH_CALL, callId)
    return runCatching { (from ?: appContext).startActivity(launch) }
      .onFailure { Log.w(TAG, "could not bring the app forward", it) }
      .isSuccess
  }

  companion object {
    const val EXTRA_LAUNCH_CALL = "poolse_launch_call"
    private const val TAG = "PoolseCallCore"
    private const val PREFS = "dev.poolse.callcore"

    @Volatile private var instance: CallCore? = null
    @Volatile private var config: CallCoreConfig? = null

    /**
     * The bridge's snapshot subscriber. Process-level (not per instance)
     * so the JS side may subscribe before configure() — the core picks
     * it up when it is created.
     */
    @Volatile var listener: ((Map<String, Any?>?) -> Unit)? = null

    /**
     * Configure the core and PERSIST the inputs. A ring can wake a killed
     * app: the OS spawns the process cold to run [CallMessagingService],
     * with no React context and no chance for the JS bridge to call this.
     * Persisting lets [restoreConfig] rebuild the same config from disk on
     * that cold start, so closed-app ringing works. The bridge calls this
     * each time the app opens; the resource names (not the resolved ids)
     * are stored, since ids are not stable across installs.
     *
     * Re-configuring a live core swaps the config in place: HTTP and the
     * ring surface read it per use, so a new API origin takes effect on
     * the next request.
     */
    fun configure(context: Context, apiBaseUrl: String, smallIconName: String?, ringbackName: String?) {
      val ctx = context.applicationContext
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString("apiBaseUrl", apiBaseUrl)
        .putString("smallIcon", smallIconName)
        .putString("ringback", ringbackName)
        .apply()
      config = build(ctx, apiBaseUrl, smallIconName, ringbackName)
    }

    /** The core; throws if never configured (not even persisted). Prefer [getOrNull]. */
    fun get(context: Context): CallCore =
      getOrNull(context) ?: error("CallCore.configure() must be called before use")

    /** The core, or null if this install was never configured — callers no-op. */
    fun getOrNull(context: Context): CallCore? =
      instance ?: synchronized(this) {
        instance ?: run {
          if (config == null) restoreConfig(context.applicationContext)
          if (config == null) null else CallCore(context).also { instance = it }
        }
      }

    /** The live core if one exists — never creates (cheap reads, e.g. getCallState). */
    fun peek(): CallCore? = instance

    /** The configured API origin (restored from disk on a cold start), or null. */
    fun apiBaseUrl(context: Context): String? {
      if (config == null) restoreConfig(context.applicationContext)
      return config?.apiBaseUrl?.ifEmpty { null }
    }

    /** The configured notification icon (restored from disk on a cold start). */
    fun smallIcon(context: Context): Int {
      if (config == null) restoreConfig(context.applicationContext)
      return config?.smallIcon ?: context.applicationInfo.icon
    }

    internal fun peekConfig(): CallCoreConfig? = config

    internal fun requireConfig(): CallCoreConfig =
      config ?: error("CallCore.configure() must be called before use")

    // Rebuild config from the persisted inputs on a cold start. Leaves
    // config null if the app was never configured — impossible in
    // practice, since registering for pushes requires opening the app.
    private fun restoreConfig(context: Context) {
      val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val url = p.getString("apiBaseUrl", null) ?: return
      config = build(context, url, p.getString("smallIcon", null), p.getString("ringback", null))
    }

    private fun build(
      context: Context,
      apiBaseUrl: String,
      smallIconName: String?,
      ringbackName: String?,
    ): CallCoreConfig {
      val iconId = smallIconName
        ?.let { context.resources.getIdentifier(it, "drawable", context.packageName) } ?: 0
      val ringbackId = ringbackName
        ?.let { context.resources.getIdentifier(it, "raw", context.packageName) } ?: 0
      return CallCoreConfig(
        apiBaseUrl = apiBaseUrl.trimEnd('/'),
        // Fall back to the app's launcher icon rather than crash on a typo.
        smallIcon = if (iconId != 0) iconId else context.applicationInfo.icon,
        ringbackRawRes = ringbackId,
        mediaFactory = resolveMediaFactory(),
      )
    }

    /**
     * The shipped LiveKit adapter is loaded reflectively so the core
     * library carries no static dependency on the SFU source set. Absent
     * (LiveKit not built in), calls still ring and signal; there is just
     * no media — a supported degraded mode, not a crash.
     */
    @Suppress("UNCHECKED_CAST")
    private fun resolveMediaFactory(): (Context, MediaEvents) -> MediaPort =
      runCatching {
        val companion = Class.forName("dev.poolse.callcore.livekit.LiveKitMediaPort\$Companion")
        val livekit = Class.forName("dev.poolse.callcore.livekit.LiveKitMediaPort")
          .getField("Companion").get(null)
        companion.getMethod("getFactory").invoke(livekit) as (Context, MediaEvents) -> MediaPort
      }.getOrElse {
        { _, _ -> NoMediaPort }
      }

    /** Signalling-only fallback: the call rings and the state machine
     *  runs, there is simply no audio/video transport. */
    private object NoMediaPort : MediaPort {
      override fun join(bundle: dev.poolse.callcore.CallSessionBundle) {}
      override fun leave() {}
      override fun setMuted(muted: Boolean) {}
      override fun setCamera(on: Boolean) {}
      override fun switchCamera() {}
      override fun setSpeaker(on: Boolean) {}
    }
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
  /** Unexpected disconnect — the SFU gave up; the core asks the server and rejoins. */
  fun onLost()
  /** The SFU is resuming the session itself; only reflected in the UI. */
  fun onReconnecting()
  fun onRecovered()
  fun onRemoteJoined()
  /** The REMOTE roster (the local participant excluded). */
  fun onParticipants(participants: List<MediaParticipant>)
  /** `earpiece` | `speaker` | `bluetooth` | `headset`. */
  fun onAudioRoute(route: String)
  /** The local camera track is (not) published + enabled; [facing] `front` | `back`. */
  fun onLocalCamera(on: Boolean, facing: String?) {}
  /** Every output call audio can play through right now, and the one it does. */
  fun onAudioOutputs(outputs: List<AudioOutput>, selectedId: String?) {}
}

/** One place call audio can play — a snapshot `audioOutputs[]` entry. */
data class AudioOutput(
  /** Passed back to `setAudioOutput`; stable while the device stays connected. */
  val id: String,
  /** `earpiece` | `speaker` | `bluetooth` | `headset`. */
  val kind: String,
  /** What the device calls itself ("Galaxy Buds2"), or a plain default for built-ins. */
  val name: String,
)

data class MediaParticipant(
  /** The SFU identity — the poolse user id. */
  val identity: String,
  val speaking: Boolean,
  val muted: Boolean,
  /** True only with a published, subscribed, unmuted camera track — a frame to draw. */
  val cameraOn: Boolean = false,
  /** The host app's own id for the user, when the SFU carries it; else the identity. */
  val externalId: String = identity,
)
