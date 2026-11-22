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
import dev.poolse.callcore.CallServer
import dev.poolse.callcore.CallServers
import dev.poolse.callcore.RingContext
import dev.poolse.callcore.RoutedHttpPort
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
  // agnostic (CALL_CONTRACT.md — "LiveKit or any SFU"), and the library
  // compiles without a specific media SDK on the classpath. The host
  // supplies the factory; LiveKitMediaPort is the first implementation.
  private val media: MediaPort = requireConfig().mediaFactory(appContext, mediaEvents())

  // Surface + HTTP read the config on every use, so a later configure()
  // (another API origin, icon, ringback) applies without a rebuild.
  private val surface = AndroidRingSurface(appContext) {
    peekConfig()?.ringSurface ?: RingSurfaceConfig(appContext.applicationInfo.icon, 0)
  }

  // One HTTP client per server, each reading its URL per request (a
  // re-added server's new address applies at once); the router picks the
  // one the call belongs to. A single-server app only ever uses `default`.
  private val httpClient = CallHttpClient.defaultClient()
  private val router = RoutedHttpPort { serverId ->
    CallHttpClient({ ServerRegistry.baseUrl(appContext, serverId) }, httpClient)
  }

  private val runtime = CallCoreRuntime(
    http = router,
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
  private var screenSharing = false
  private var audioRoute: String? = null
  private var audioOutputs: List<AudioOutput> = emptyList()
  private var audioOutputId: String? = null
  private var connectionQuality = "unknown"
  private var videoPaused = false
  /** False while the server holds our media back (recording consent). */
  private var canPublish = true
  /** Capture processing (CL7): per process, not per call. */
  private var noiseSuppression = true
  private var backgroundBlur = false
  /**
   * This call was taken over by the same user on another device (CL11):
   * the SFU replaced our participant (duplicate identity). The end that
   * follows reads `reason: 'moved'`.
   */
  private var movedElsewhere = false

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

  /** The push's `workspace_name` per ringing call. */
  private val ringWorkspaces = java.util.concurrent.ConcurrentHashMap<String, String>()

  /** Meeting rings (CA4) per call: the meeting's title, "" when it has none. Absent: a person calling. */
  private val ringMeetings = java.util.concurrent.ConcurrentHashMap<String, String>()

  /**
   * A ring arrived — from FCM (closed app) or the socket (open app).
   * Bound to its server before the runtime sees it: a busy-decline runs
   * inside the ring's own dispatch.
   */
  fun onRing(ring: RingContext) {
    bind(ring)
    runtime.onRing(ring)
  }

  private fun bind(ring: RingContext) {
    router.bindCall(ring.callId, ring.serverId)
    ring.workspaceName?.let {
      if (ringWorkspaces.size > 16) ringWorkspaces.clear()
      ringWorkspaces[ring.callId] = it
    }
    if (ring.isMeeting) {
      if (ringMeetings.size > 16) ringMeetings.clear()
      ringMeetings[ring.callId] = ring.meetingTitle ?: ""
    }
  }

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
    onRing(ring) // idempotent: dedupes if already showing
    runtime.answer()
    return bringAppToFront(ring.callId, from)
  }

  /**
   * End & answer from the call-waiting heads-up. Only for the call still
   * waiting (a stale notification is just taken down); brings the app
   * forward from [from], like [onUserAnswer].
   */
  fun onUserAnswerWaiting(ring: RingContext, from: Context? = null): Boolean {
    if (runtime.currentState().waiting?.callId != ring.callId) {
      runCatching {
        androidx.core.app.NotificationManagerCompat.from(appContext)
          .cancel(with(AndroidRingSurface) { ring.callId.notificationId() })
      }
      return false
    }
    bind(ring)
    runtime.answerWaiting(ring.callId)
    return bringAppToFront(ring.callId, from)
  }

  fun onUserDecline(ring: RingContext) {
    onRing(ring)
    runtime.decline()
  }

  fun onUserOpen(ring: RingContext, from: Context? = null) {
    onRing(ring)
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
  /** [serverId]: the server the session token is for (null = the default). */
  fun place(conversationId: String, media: String, sessionToken: String, serverId: String? = null) =
    runtime.post {
      // Busy: the runtime ignores it, so the binding must not move either.
      if (!idle()) return@post
      router.bindPlace(conversationId, serverId)
      runtime.place(conversationId, media, sessionToken)
    }

  fun join(callId: String, conversationId: String?, sessionToken: String, serverId: String? = null) =
    runtime.post {
      if (!idle()) return@post
      router.bindCall(callId, serverId)
      runtime.join(callId, conversationId, sessionToken)
    }

  private fun idle() = runtime.currentState().phase.let { it == Phase.IDLE || it == Phase.ENDED }

  /** The server [callId] runs on: its binding, else the default (when there is one). */
  private fun serverOf(callId: String?): String? {
    val id = callId ?: return null
    router.serverFor(id)?.let { return it }
    val servers = ServerRegistry.servers(appContext)
    return servers.get(CallServers.DEFAULT_ID)?.id ?: servers.all.singleOrNull()?.id
  }

  /** The server of the current call (null = the default). Any thread. */
  val currentServerId: String? get() = serverOf(runtime.currentState().callId)


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
   * Share the screen with the result of the system's capture prompt, or
   * stop ([permission] unused). Main thread. Not optimistic:
   * `screenSharing` flips when the adapter reports the track published.
   * False when the media engine cannot capture the screen.
   */
  fun setScreenShare(on: Boolean, permission: android.content.Intent?): Boolean {
    val source = media as? ScreenShareSource ?: return false
    source.setScreenShare(on, permission)
    return true
  }

  /**
   * Noise suppression on the microphone (CL7), on by default. Kept
   * across calls for this process. False when the engine can't change
   * it (the signalling-only build).
   */
  fun setNoiseSuppression(on: Boolean): Boolean {
    val source = media as? CaptureProcessingSource ?: return false
    // On the runtime's (main) thread: the media port only touches its room there.
    runtime.post { noiseSuppression = on; source.setNoiseSuppression(on) }
    runtime.reemit()
    return true
  }

  /** Background blur on the camera (CL7); a no-op where unsupported. */
  fun setBackgroundBlur(on: Boolean): Boolean {
    val source = media as? CaptureProcessingSource ?: return false
    if (!source.backgroundBlurSupported) return false
    runtime.post { backgroundBlur = on; source.setBackgroundBlur(on) }
    runtime.reemit()
    return true
  }

  val noiseSuppressionSupported: Boolean
    get() = (media as? CaptureProcessingSource)?.noiseSuppressionSupported ?: false

  val backgroundBlurSupported: Boolean
    get() = (media as? CaptureProcessingSource)?.backgroundBlurSupported ?: false

  /** Whether this build's media engine can share the screen. */
  val screenShareSupported: Boolean get() = media is ScreenShareSource

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

  /**
   * Consent given: publish the mic and camera again as the user last had
   * them. Also happens by itself once the server lets us publish.
   */
  fun republish() = runtime.republish()

  /** The current call's id and control token. Any thread. */
  val control: Pair<String, String>? get() = runtime.control

  /**
   * Breakout rooms (MEETINGS.md §5): the call's media to the room of
   * [payload] — the JSON of `POST /breakouts/:room/join` (or of `POST
   * /calls/:id/breakouts/return`). The call service and the system call
   * stay; see [CallCoreRuntime.moveToRoom]. [done] false: unparseable,
   * no live call, or another call's session.
   */
  fun moveToRoom(payload: String, done: (Boolean) -> Unit) = runtime.post {
    val current = runtime.currentBundle
    val next = current?.let { runCatching { CallHttpClient.parseBundle(payload, it) }.getOrNull() }
    if (next == null) {
      done(false)
      return@post
    }
    runtime.moveToRoom(next) { ok ->
      // The last room's people are not in this one.
      if (ok) roster = emptyList()
      done(ok)
    }
  }

  /**
   * A data-channel message to the call's room (CL4, CL6). False at once
   * when the media engine has no data channel (the signalling-only build).
   */
  fun publishData(topic: String, data: ByteArray, reliable: Boolean, to: List<String>, done: (Boolean) -> Unit) {
    val source = media as? CallDataSource ?: return done(false)
    // On the runtime's (main) thread: the media port only touches its room there.
    runtime.post { source.publishData(topic, data, reliable, to, done) }
  }

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
      // `pending:<conv>` → the server-minted id is the same call — but
      // only for that conversation's own placed call: a waiting call
      // promoted over a still-pending one is a different call.
      if (isRenameOfPending(extrasCallId, state)) extrasCallId = state.callId
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
        buildMap<String, Any> {
          put("userId", it.identity)
          put("externalId", it.externalId)
          put("speaking", it.speaking)
          put("muted", it.muted)
          put("cameraOn", it.cameraOn)
          put("screenSharing", it.screenSharing)
          put("connectionQuality", it.connectionQuality)
          if (it.isAgent) {
            put("isAgent", true)
            it.agentLabel?.let { label -> put("agentLabel", label) }
            it.agentMode?.let { mode -> put("agentMode", mode) }
          }
        }
      },
      audioRoute = audioRoute ?: if (loud(state)) "speaker" else "earpiece",
      audioOutputs = audioOutputs.map { mapOf("id" to it.id, "kind" to it.kind, "name" to it.name) },
      audioOutputId = audioOutputId,
      mutedSelf = mutedSelf,
      cameraOn = cameraOn,
      cameraFacing = cameraFacing,
      waitingRing = runtime.waitingRing,
      connectionQuality = connectionQuality,
      videoPaused = videoPaused,
      screenSharing = screenSharing,
      canPublish = canPublish,
      recording = runtime.capture.first,
      transcription = runtime.capture.second,
    )
    val withServers = snap?.let { withServers(it, state) }
    lastSnapshot = withServers
    reconcileAndroid(state)
    runCatching { listener?.invoke(withServers) }.onFailure { Log.w(TAG, "snapshot listener failed", it) }
  }

  /**
   * The workspace each call belongs to: `serverId` and `workspaceName`
   * on the snapshot and on its waiting call.
   */
  private fun withServers(snap: Map<String, Any?>, state: MachineState): Map<String, Any?> {
    val servers = ServerRegistry.servers(appContext)
    val serverId = serverOf(state.callId)
    val out = snap.toMutableMap()
    out["serverId"] = serverId
    out["workspaceName"] = state.callId?.let { ringWorkspaces[it] } ?: servers.get(serverId)?.name
    // A scheduled meeting that rang this device (CA4).
    val meeting = state.callId?.let { ringMeetings[it] }
    out["ringType"] = if (meeting != null) "meeting" else "call"
    out["meetingTitle"] = meeting?.ifEmpty { null }
    out["noiseSuppression"] = noiseSuppression
    out["backgroundBlur"] = backgroundBlur
    out["movedElsewhere"] = movedElsewhere
    // Breakout rooms (MEETINGS.md §5): the room the media is in, null in the main room.
    out["breakout"] = runtime.breakout?.let { (roomId, name) -> mapOf("roomId" to roomId, "name" to name) }
    out["selfIdentity"] = (media as? CallDataSource)?.localIdentity
    // Taken over by another of this user's devices: the machine ends it
    // as `left` (CALL_CONTRACT.md §9); the app is told why.
    if (movedElsewhere && state.phase == Phase.ENDED) out["reason"] = "moved"
    val waiting = snap["waiting"] as? Map<*, *>
    val ring = runtime.waitingRing
    if (waiting != null && ring != null) {
      val waitingServer = ring.serverId ?: serverOf(ring.callId)
      out["waiting"] = waiting.entries.associate { (k, v) -> k.toString() to v } + mapOf(
        "serverId" to waitingServer,
        "workspaceName" to (ring.workspaceName ?: servers.get(waitingServer)?.name),
        "ringType" to (if (ring.isMeeting) "meeting" else "call"),
        "meetingTitle" to ring.meetingTitle,
      )
    }
    return out
  }

  private fun isRenameOfPending(previous: String?, state: MachineState): Boolean =
    previous != null && previous.startsWith("pending:") &&
      state.direction != dev.poolse.callcore.Direction.INCOMING &&
      previous == "pending:${state.conversationId}"

  private fun resetExtras(callId: String?, media: String?) {
    extrasCallId = callId
    extrasMedia = media
    roster = emptyList()
    conversationName = null
    callKind = "call"
    movedElsewhere = false
    mutedSelf = false
    // Reported by the media adapter once the camera is really published.
    cameraOn = false
    cameraFacing = null
    screenSharing = false
    audioRoute = null
    audioOutputs = emptyList()
    audioOutputId = null
    connectionQuality = "unknown"
    videoPaused = false
    canPublish = true
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
      // An agent keeps nobody company: a call left with only agents is over.
      runtime.onRemoteCount(participants.count { !it.isAgent })
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
    override fun onCanPublish(allowed: Boolean) {
      runtime.post { canPublish = allowed }
      runtime.reemit()
    }
    override fun onLocalScreen(on: Boolean) {
      runtime.post { screenSharing = on }
      runtime.reemit()
    }
    override fun onAudioOutputs(outputs: List<AudioOutput>, selectedId: String?) {
      runtime.post { audioOutputs = outputs; audioOutputId = selectedId }
      runtime.reemit()
    }
    override fun onNetwork(quality: String, videoPaused: Boolean) {
      runtime.post { connectionQuality = quality; this@CallCore.videoPaused = videoPaused }
      runtime.reemit()
    }
    override fun onMovedElsewhere() {
      runtime.post { movedElsewhere = true }
    }
    override fun onData(topic: String, payload: ByteArray, fromIdentity: String?, fromName: String?) {
      val text = runCatching {
        Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(payload)).toString()
      }.getOrNull()
      runCatching {
        dataListener?.invoke(
          mapOf(
            "topic" to topic,
            "payload" to android.util.Base64.encodeToString(payload, android.util.Base64.NO_WRAP),
            "text" to text,
            "fromIdentity" to fromIdentity,
            "fromName" to fromName,
          ),
        )
      }.onFailure { Log.w(TAG, "data listener failed", it) }
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
    /** Plugin `ringtone`: the raw resource name. */
    internal const val META_RINGTONE = "dev.poolse.calls.ringtone"
    private val INCOMING_KEYS = listOf("accentColor", "backgroundColor", "avatarUrl", "activity")

    @Volatile private var instance: CallCore? = null
    @Volatile private var config: CallCoreConfig? = null

    /**
     * The bridge's snapshot subscriber. Process-level (not per instance)
     * so the JS side may subscribe before configure() — the core picks
     * it up when it is created.
     */
    @Volatile var listener: ((Map<String, Any?>?) -> Unit)? = null

    /**
     * The bridge's data-channel subscriber (CL4, CL6): `{topic, payload
     * (base64), text (UTF-8 or null), fromIdentity, fromName}`.
     */
    @Volatile var dataListener: ((Map<String, Any?>) -> Unit)? = null

    /** The most one data message may carry — the web CallRoom's CALL_DATA_MAX_BYTES. */
    const val DATA_MAX_BYTES = 14_000

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
    fun configure(
      context: Context,
      apiBaseUrl: String,
      smallIconName: String?,
      ringbackName: String?,
      /** Raw resource NAME of the incoming ringtone; null = the plugin's, else the system's. */
      ringtoneName: String? = null,
      /** `configure({ incomingCall })`: accentColor, backgroundColor, avatarUrl, activity. */
      incomingCall: Map<String, String?> = emptyMap(),
    ) {
      val ctx = context.applicationContext
      // A URL is the `default` server; "" sets the options only and keeps
      // whatever default server there is.
      val url = apiBaseUrl.trimEnd('/').ifEmpty {
        ServerRegistry.servers(ctx).get(CallServers.DEFAULT_ID)?.apiBaseUrl.orEmpty()
      }
      if (apiBaseUrl.isNotBlank()) {
        val current = ServerRegistry.servers(ctx).get(CallServers.DEFAULT_ID)
        ServerRegistry.upsert(ctx, current?.copy(apiBaseUrl = url) ?: CallServer(CallServers.DEFAULT_ID, url))
      }
      val edit = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString("apiBaseUrl", url)
        .putString("smallIcon", smallIconName)
        .putString("ringback", ringbackName)
        .putString("ringtone", ringtoneName)
      for (key in INCOMING_KEYS) edit.putString("incoming.$key", incomingCall[key])
      edit.apply()
      config = build(ctx, url, smallIconName, ringbackName, ringtoneName, incomingCall)
    }

    /**
     * `addServer` before any `configure`: the core still has to exist (it
     * carries the rings), with the default options.
     */
    fun ensureConfigured(context: Context) {
      if (config == null) restoreConfig(context.applicationContext)
      if (config == null) configure(context, "", null, null)
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
      config = build(
        context,
        url,
        p.getString("smallIcon", null),
        p.getString("ringback", null),
        p.getString("ringtone", null),
        INCOMING_KEYS.associateWith { p.getString("incoming.$it", null) },
      )
    }

    /** The ring screen's look (restored from disk on a cold start); the built-in one if never configured. */
    fun incomingCallLook(context: Context): IncomingCallLook {
      if (config == null) restoreConfig(context.applicationContext)
      return config?.incomingCall
        ?: IncomingCallLook.resolve(context.applicationContext, null, null, null, null)
    }

    /** Application meta-data the config plugin writes (`dev.poolse.calls.*`), or null. */
    internal fun manifestValue(context: Context, name: String): String? = runCatching {
      context.packageManager
        .getApplicationInfo(context.packageName, android.content.pm.PackageManager.GET_META_DATA)
        .metaData?.get(name)?.toString()
    }.getOrNull()?.ifEmpty { null }

    private fun build(
      context: Context,
      apiBaseUrl: String,
      smallIconName: String?,
      ringbackName: String?,
      ringtoneName: String?,
      incomingCall: Map<String, String?>,
    ): CallCoreConfig {
      val iconId = smallIconName
        ?.let { context.resources.getIdentifier(it, "drawable", context.packageName) } ?: 0
      val ringbackId = ringbackName
        ?.let { context.resources.getIdentifier(it, "raw", context.packageName) } ?: 0
      // Runtime name first, then the plugin's; an unknown name (0) rings
      // with the system ringtone rather than not at all.
      val ringtoneId = (ringtoneName?.ifEmpty { null } ?: manifestValue(context, META_RINGTONE))
        ?.let { context.resources.getIdentifier(it, "raw", context.packageName) } ?: 0
      return CallCoreConfig(
        apiBaseUrl = apiBaseUrl.trimEnd('/'),
        // Fall back to the app's launcher icon rather than crash on a typo.
        smallIcon = if (iconId != 0) iconId else context.applicationInfo.icon,
        ringbackRawRes = ringbackId,
        ringtoneRawRes = ringtoneId,
        incomingCall = IncomingCallLook.resolve(
          context,
          accentColor = incomingCall["accentColor"],
          backgroundColor = incomingCall["backgroundColor"],
          avatarUrl = incomingCall["avatarUrl"],
          activity = incomingCall["activity"],
        ),
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
  /** The incoming ringtone, `res/raw`; 0 = the system ringtone. */
  val ringtoneRawRes: Int = 0,
  /** The full-screen ring's colours, avatar source, or the app's own activity. */
  val incomingCall: IncomingCallLook = IncomingCallLook(),
  /**
   * Builds the media engine for a call. Injected so the core carries no
   * SFU dependency; pass `::LiveKitMediaPortFactory` (the shipped
   * implementation) or your own.
   */
  val mediaFactory: (Context, MediaEvents) -> MediaPort,
) {
  internal val ringSurface get() = RingSurfaceConfig(smallIcon, ringbackRawRes, ringtoneRawRes, incomingCall)
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
  /** The local screen share is (not) published. */
  fun onLocalScreen(on: Boolean) {}
  /** Every output call audio can play through right now, and the one it does. */
  fun onAudioOutputs(outputs: List<AudioOutput>, selectedId: String?) {}
  /**
   * Our own link to the SFU (`good` | `poor` | `lost` | `unknown`), and
   * whether incoming video is paused to keep the audio going.
   */
  fun onNetwork(quality: String, videoPaused: Boolean) {}
  /**
   * Whether the server lets us publish (false: recording consent not
   * given yet, docs/RECORDING.md §5). Sent on every change.
   */
  fun onCanPublish(allowed: Boolean) {}
  /**
   * The SFU replaced us with the same user joining from another device
   * ("move call to this device", CALL_CONTRACT.md §9). Sent just before
   * [onLost].
   */
  fun onMovedElsewhere() {}
  /**
   * A data-channel message from someone in the room (CL4, CL6): its
   * topic, the bytes, and who sent it (null identity: the server).
   */
  fun onData(topic: String, payload: ByteArray, fromIdentity: String?, fromName: String?) {}
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
  /** True with a published, subscribed, unmuted screen share — a screen to draw. */
  val screenSharing: Boolean = false,
  /** The host app's own id for the user, when the SFU carries it; else the identity. */
  val externalId: String = identity,
  /** Their link to the SFU: `good` | `poor` | `lost` (dropped, coming back) | `unknown`. */
  val connectionQuality: String = "unknown",
  /**
   * An agent in the call (AGENTS_IN_CALLS.md §1): shown with the Agent
   * badge, named [agentLabel], never counted as someone keeping the call up.
   */
  val isAgent: Boolean = false,
  /** "Scout" / "Jasir's agent" — the agent token's `label`. */
  val agentLabel: String? = null,
  /** `notetaker` | `assistant` | `delegate`. */
  val agentMode: String? = null,
)
