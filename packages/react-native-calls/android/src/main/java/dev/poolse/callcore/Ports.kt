package dev.poolse.callcore

/**
 * The seams between the pure machine and the platform. Each adapter
 * lives in the bridge/Android layer; the core knows only these shapes.
 * Every port call corresponds 1:1 to an Effect — the runtime below is
 * the only place effects are executed.
 */

/** CONTRACT.md §4 — the three doors. Tokens are opaque strings. */
interface HttpPort {
  /** POST /calls/:id/answer with the ring grant. */
  fun answer(callId: String, grant: String, cb: (HttpResult) -> Unit)
  /** POST /calls/:id/join with a session token. */
  fun join(callId: String, sessionToken: String, cb: (HttpResult) -> Unit)
  /** POST /conversations/:id/calls with a session token. */
  fun place(conversationId: String, media: String, sessionToken: String, cb: (HttpResult) -> Unit)
  /** POST /calls/:id/decline — grant or session; fire-and-forget with retry. */
  fun decline(callId: String, auth: String, busy: Boolean)
  /** POST /calls/:id/hangup with the call-control token; fire-and-forget with retry. */
  fun hangup(callId: String, controlToken: String)
  /**
   * POST /calls/:id/reconnect with the call-control token. The server
   * answers with the FULL bundle (same shape as answer/join); [current]
   * is passed so an older server's `{livekit:{url,token}}` refresh can
   * still be applied onto it.
   */
  fun reconnect(current: CallSessionBundle, cb: (HttpResult) -> Unit)
}

sealed interface HttpResult {
  /** 2xx: the CallSessionBundle (or reconnect's token refresh). */
  data class Ok(val bundle: CallSessionBundle) : HttpResult
  /** 410 — the call is finished (or this device was superseded). */
  data object Gone : HttpResult
  /** Timeout / transient network failure. */
  data object Timeout : HttpResult
  /** 401/403 — grant spent, expired, or wrong device. Terminal. */
  data class AuthFailed(val code: String) : HttpResult
  /**
   * Terminal but not auth: 503 (no SFU capacity), another 4xx, or a 2xx
   * whose body would not parse. Retrying would only repeat it.
   */
  data class Failed(val code: String) : HttpResult
}

data class CallSessionBundle(
  val callId: String,
  val conversationId: String,
  val conversationName: String?,
  val media: String,
  val created: Boolean,
  val livekitUrl: String,
  val livekitToken: String,
  val controlToken: String,
  /** `room` (rings nobody, CONTRACT.md §5.6) or `call`. */
  val kind: String = "call",
)

/** LiveKit (or any SFU) — media only, no lifecycle opinions. */
interface MediaPort {
  fun join(bundle: CallSessionBundle)
  fun leave()
  fun setMuted(muted: Boolean)
  fun setCamera(on: Boolean)
  fun switchCamera()
  /**
   * Route call audio to the loudspeaker (`true`) or back to the private
   * route — earpiece, or a connected headset/Bluetooth device (`false`).
   */
  fun setSpeaker(on: Boolean)

  /**
   * Play through one specific output — an id from the snapshot's
   * `audioOutputs`. Engines without device selection fall back to the
   * speaker toggle.
   */
  fun setAudioOutput(id: String) = setSpeaker(id == "speaker")
}

/** The ring UX: CallStyle notification + full-screen activity + tones. */
interface RingSurfacePort {
  fun show(ring: RingContext)
  fun dismiss(callId: String)
  fun ringtoneStart()
  fun ringtoneStop()
  fun ringbackStart()
  fun ringbackStop()
  /**
   * A call waiting beside the current one: its own quiet surface (a
   * heads-up with a waiting tone; iOS: CallKit's call-waiting UI).
   */
  fun showWaiting(ring: RingContext) {}
  /** The waiting call is over (declined, cancelled, timed out). */
  fun dismissWaiting(callId: String) {}
  /**
   * The waiting call becomes THE ring (SHOW_RING follows): drop its
   * waiting surface without resolving it.
   */
  fun promoteWaiting(callId: String) {}
}

data class RingContext(
  val callId: String,
  val conversationId: String,
  val conversationName: String?,
  val callerName: String?,
  val media: String,
  val grant: String,
  val ringDeadlineEpochMs: Long,
)

/** Android: the phoneCall foreground service. iOS: the CallKit session. */
interface CallSessionPort {
  fun start(callId: String, media: String)
  fun stop()
}

/** Snapshots out — the bridge turns these into JS events. */
fun interface SnapshotSink {
  fun emit(state: MachineState)
}

/** Time, injectable: real adapters use a Handler/looper; tests a fake. */
interface TimerPort {
  fun nowMs(): Long
  /** Scheduling an existing key replaces it. */
  fun schedule(key: String, delayMs: Long, fire: () -> Unit)
  fun cancel(key: String)
}
