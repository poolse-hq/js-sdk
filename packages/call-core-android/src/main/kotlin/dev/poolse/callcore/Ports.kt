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
  /** POST /calls/:id/reconnect with the call-control token. */
  fun reconnect(callId: String, controlToken: String, cb: (HttpResult) -> Unit)
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
)

/** LiveKit (or any SFU) — media only, no lifecycle opinions. */
interface MediaPort {
  fun join(bundle: CallSessionBundle)
  fun leave()
  fun setMuted(muted: Boolean)
  fun setCamera(on: Boolean)
  fun switchCamera()
}

/** The ring UX: CallStyle notification + full-screen activity + tones. */
interface RingSurfacePort {
  fun show(ring: RingContext)
  fun dismiss(callId: String)
  fun ringtoneStart()
  fun ringtoneStop()
  fun ringbackStart()
  fun ringbackStop()
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
interface SnapshotSink {
  fun emit(state: MachineState)
}
