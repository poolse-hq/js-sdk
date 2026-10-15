package dev.poolse.callcore

/**
 * The engine around the machine: owns the state, serializes events,
 * executes effects through the ports, runs the timers, and emits a
 * snapshot after every change.
 *
 * The machine decides; this class merely obeys — there is deliberately
 * no call logic here beyond bookkeeping the effects need (which grant
 * answers which call, which control token hangs up). If behavior is
 * wrong, the fix is in CallMachine + vectors, not here.
 *
 * Thread-safe: adapters may call in from any thread; dispatch is
 * serialized on an internal lock. The Android bridge hops results back
 * to its own looper via TimerPort's scheduling.
 */
class CallCoreRuntime(
  private val http: HttpPort,
  private val media: MediaPort,
  private val surface: RingSurfacePort,
  private val session: CallSessionPort,
  private val timers: TimerPort,
  private val sink: SnapshotSink,
) {
  private val lock = Any()

  private var state: MachineState = MachineState.IDLE

  /** The ring being shown (its grant answers/declines it). */
  private var ring: RingContext? = null

  /** Grants of rings auto-declined busy, kept until the decline fires. */
  private val busyRings = mutableMapOf<String, RingContext>()

  /** The session bundle of the current call, once the server accepted. */
  private var bundle: CallSessionBundle? = null

  /** The session token place/join were called with, for one retry. */
  private var sessionToken: String? = null

  private companion object {
    const val ENDED_LINGER_MS = 2_500L
    const val RECONNECT_BUDGET_MS = 25_000L
    const val T_DEADLINE = "ring_deadline"
    const val T_LINGER = "linger"
    const val T_RECONNECT = "reconnect_budget"
  }

  // ── inputs from adapters ────────────────────────────────────────────

  fun currentState(): MachineState = synchronized(lock) { state }

  /** A ring arrived — push or socket, the machine treats them alike. */
  fun onRing(ctx: RingContext) {
    val stale = ctx.ringDeadlineEpochMs <= timers.nowMs()
    synchronized(lock) {
      // Remember the context BEFORE dispatch: the effects need it —
      // SHOW_RING for this call, or HTTP_DECLINE_BUSY for another.
      if (!stale) busyRings[ctx.callId] = ctx
      dispatch(
        Event.Ring(
          callId = ctx.callId,
          conversationId = ctx.conversationId,
          media = ctx.media,
          stale = stale,
        ),
        ringCtx = ctx,
      )
      busyRings.remove(ctx.callId)
    }
  }

  fun onRingEnded(callId: String, reason: String) =
    synchronized(lock) { dispatch(Event.RingEnded(callId, reason)) }

  fun onCallFinished(callId: String) =
    synchronized(lock) { dispatch(Event.CallFinished(callId)) }

  fun answer() = synchronized(lock) { dispatch(Event.UserAnswer) }
  fun decline() = synchronized(lock) { dispatch(Event.UserDecline) }
  fun hangUp() = synchronized(lock) { dispatch(Event.UserHangup) }

  fun place(conversationId: String, media: String, sessionToken: String) =
    synchronized(lock) {
      this.sessionToken = sessionToken
      // call_id is server-minted on place; a placeholder keys the state
      // until the bundle arrives.
      dispatch(Event.UserPlace(callId = "pending:$conversationId", conversationId = conversationId, media = media))
    }

  fun join(callId: String, conversationId: String?, sessionToken: String) =
    synchronized(lock) {
      this.sessionToken = sessionToken
      dispatch(Event.UserJoin(callId, conversationId))
    }

  /** Caller-side: the bridge resolved every ring from `ring_states`. */
  fun allRingsResolved(outcome: String) =
    synchronized(lock) { dispatch(Event.AllRingsResolved(outcome)) }

  fun onMediaConnected() = synchronized(lock) { dispatch(Event.MediaConnected) }
  fun onMediaFailed() = synchronized(lock) { dispatch(Event.MediaFailed) }
  fun onMediaLost() = synchronized(lock) { dispatch(Event.MediaLost) }
  fun onMediaRecovered() = synchronized(lock) { dispatch(Event.MediaRecovered) }
  fun onRemoteJoined() = synchronized(lock) { dispatch(Event.RemoteJoined) }

  fun setMuted(muted: Boolean) = media.setMuted(muted)
  fun setCamera(on: Boolean) = media.setCamera(on)
  fun switchCamera() = media.switchCamera()

  // ── dispatch ────────────────────────────────────────────────────────

  private fun dispatch(event: Event, ringCtx: RingContext? = null) {
    val before = state
    val (next, effects) = CallMachine.transition(before, event)
    state = next
    for (effect in effects) execute(effect, ringCtx)
    // Retire the ring grant only after EVERY effect has had its chance
    // to use it. CONNECTING keeps it (answer + the no-bundle hangup
    // fallback still need it); CallSessionStop clears it with the rest.
    if (next.phase == Phase.IDLE || next.phase == Phase.ENDED) ring = null
    runTimers(before, next)
    if (next != before || effects.isNotEmpty()) sink.emit(next)
  }

  private fun execute(effect: Effect, ringCtx: RingContext?) {
    when (effect) {
      Effect.ShowRing -> {
        ring = ringCtx
        ringCtx?.let(surface::show)
      }
      Effect.DismissRing -> {
        (ring ?: ringCtx)?.let { surface.dismiss(it.callId) }
        // The grant is NOT retired here: HTTP_DECLINE may still be
        // later in this very effect list (dismiss-then-decline), and
        // clearing mid-list silently dropped the decline — the exact
        // "rejection never reached the caller" bug, reborn. Retirement
        // happens once, after the whole list, in dispatch().
      }
      Effect.RingtoneStart -> surface.ringtoneStart()
      Effect.RingtoneStop -> surface.ringtoneStop()
      Effect.RingbackStart -> surface.ringbackStart()
      Effect.RingbackStop -> surface.ringbackStop()

      Effect.HttpAnswer -> {
        val r = ring
        if (r != null) http.answer(r.callId, r.grant, ::onHttpResult)
        else onHttpResult(HttpResult.AuthFailed("no_grant"))
      }
      Effect.HttpJoin -> {
        val callId = state.callId
        val token = sessionToken
        if (callId != null && token != null) http.join(callId, token, ::onHttpResult)
        else onHttpResult(HttpResult.AuthFailed("no_session"))
      }
      Effect.HttpPlace -> {
        val conversationId = state.conversationId
        val token = sessionToken
        if (conversationId != null && token != null) {
          http.place(conversationId, state.media, token, ::onHttpResult)
        } else onHttpResult(HttpResult.AuthFailed("no_session"))
      }
      Effect.HttpDecline -> {
        ring?.let { http.decline(it.callId, it.grant, busy = false) }
      }
      is Effect.HttpDeclineBusy -> {
        busyRings[effect.callId]?.let { http.decline(it.callId, it.grant, busy = true) }
      }
      Effect.HttpHangup -> {
        val b = bundle
        val r = ring
        when {
          b != null -> http.hangup(b.callId, b.controlToken)
          // Hanging up a connecting answer that has no bundle yet:
          // resolve the ring instead, so the caller is not left waiting.
          r != null -> http.decline(r.callId, r.grant, busy = false)
          else -> Unit
        }
      }
      Effect.HttpReconnect -> {
        val b = bundle
        if (b != null) http.reconnect(b.callId, b.controlToken, ::onReconnectResult)
        else synchronized(lock) { dispatch(Event.HttpGone) }
      }

      Effect.MediaJoin -> bundle?.let(media::join)
      Effect.MediaLeave -> media.leave()

      Effect.CallSessionStart -> session.start(state.callId ?: "", state.media)
      Effect.CallSessionStop -> {
        session.stop()
        bundle = null
        ring = null
        sessionToken = null
      }
    }
  }

  private fun onHttpResult(result: HttpResult) {
    synchronized(lock) {
      when (result) {
        is HttpResult.Ok -> {
          bundle = result.bundle
          // The server minted the real call id on place.
          if (state.callId?.startsWith("pending:") == true) {
            state = state.copy(callId = result.bundle.callId, conversationId = result.bundle.conversationId)
          }
          dispatch(Event.HttpOk(created = result.bundle.created))
        }
        HttpResult.Gone -> dispatch(Event.HttpGone)
        HttpResult.Timeout -> dispatch(Event.HttpTimeout)
        is HttpResult.AuthFailed -> dispatch(Event.HttpGone)
      }
    }
  }

  private fun onReconnectResult(result: HttpResult) {
    synchronized(lock) {
      when (result) {
        is HttpResult.Ok -> {
          bundle = result.bundle
          media.join(result.bundle)
        }
        HttpResult.Gone, is HttpResult.AuthFailed -> dispatch(Event.HttpGone)
        HttpResult.Timeout -> Unit // budget timer is the backstop
      }
    }
  }

  // ── timers ──────────────────────────────────────────────────────────

  private fun runTimers(before: MachineState, after: MachineState) {
    if (before.phase != after.phase) {
      when (after.phase) {
        Phase.RINGING_IN -> {
          val deadline = ring?.ringDeadlineEpochMs ?: return
          timers.schedule(T_DEADLINE, (deadline - timers.nowMs()).coerceAtLeast(0)) {
            synchronized(lock) { dispatch(Event.RingDeadline) }
          }
        }
        Phase.ENDED -> timers.schedule(T_LINGER, ENDED_LINGER_MS) {
          synchronized(lock) { dispatch(Event.LingerElapsed) }
        }
        Phase.RECONNECTING -> timers.schedule(T_RECONNECT, RECONNECT_BUDGET_MS) {
          synchronized(lock) { dispatch(Event.ReconnectBudgetElapsed) }
        }
        else -> Unit
      }
      when (before.phase) {
        Phase.RINGING_IN -> timers.cancel(T_DEADLINE)
        Phase.ENDED -> timers.cancel(T_LINGER)
        Phase.RECONNECTING -> timers.cancel(T_RECONNECT)
        else -> Unit
      }
    }
  }
}
