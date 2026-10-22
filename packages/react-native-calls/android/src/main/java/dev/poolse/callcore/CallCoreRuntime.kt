package dev.poolse.callcore

/**
 * The engine around the machine: owns the state, serializes events,
 * executes effects through the ports, runs the timers, and emits a
 * snapshot after every change.
 *
 * The machine decides; this class merely obeys — there is deliberately
 * no call logic here beyond bookkeeping the effects need (which grant
 * answers which call, which control token hangs up, which HTTP answer
 * belongs to which call). If behavior is wrong, the fix is in
 * CallMachine + vectors, not here.
 *
 * Threading: ONE serial queue, no lock. Every input — FCM, binder taps,
 * OkHttp callbacks, SFU events, timers, JS commands — is [post]ed onto
 * [executor] (on Android the main looper). The previous lock let a port
 * that answered synchronously re-enter `dispatch` mid-effect-list, so
 * a later effect ran against a state the earlier one had already moved
 * on. Now a result produced while effects execute is QUEUED behind the
 * current dispatch, never run inside it, and each dispatch emits its
 * snapshot only after its last effect. Tests pass a direct executor;
 * the internal trampoline gives them the same ordering.
 */
class CallCoreRuntime(
  private val http: HttpPort,
  private val media: MediaPort,
  private val surface: RingSurfacePort,
  private val session: CallSessionPort,
  private val timers: TimerPort,
  private val sink: SnapshotSink,
  /** Runs a task on the single runtime thread. Must be serial. */
  private val executor: (Runnable) -> Unit = { it.run() },
  /** Where a crashing task is reported; the queue keeps draining regardless. */
  private val onError: (Throwable) -> Unit = {},
) {
  // Read from any thread (the bridge's getCallState); written only on
  // the runtime thread.
  @Volatile private var state: MachineState = MachineState.IDLE

  /** The ring being shown (its grant answers/declines it). */
  private var ring: RingContext? = null

  /** Grants of rings auto-declined busy, kept until the decline fires. */
  private val busyRings = mutableMapOf<String, RingContext>()

  /** The ring of the call waiting beside the current one (its grant answers or busy-declines it). */
  private var waitingRingCtx: RingContext? = null

  /** The session bundle of the current call, once the server accepted. */
  private var bundle: CallSessionBundle? = null

  /** The session token place/join were called with, for one retry. */
  private var sessionToken: String? = null

  /**
   * Call generation: bumped whenever a call starts CONNECTING and
   * whenever one ends. HTTP callbacks and timers capture it, so a late
   * answer/place response or timer of a call that already ended can
   * never be adopted by — or end — the next one.
   */
  private var gen = 0

  /**
   * callIds already resolved on this device (ended, declined, timed
   * out, rung-off remotely, busy-declined). Push + socket + FCM's own
   * redelivery can hand us the same ring several times, sometimes after
   * the call is over; a bounded LRU drops those instead of re-ringing.
   */
  /** The call whose media has had someone else in it (for [onRemoteCount]). */
  private var remoteSeenFor: String? = null

  private val resolved = object : LinkedHashMap<String, Unit>(RESOLVED_LRU, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Unit>?) = size > RESOLVED_LRU
  }

  // ── serial queue ────────────────────────────────────────────────────

  private val queue = ArrayDeque<() -> Unit>()
  private var draining = false

  /** Run [block] on the runtime thread, after anything already queued. */
  fun post(block: () -> Unit) {
    executor(Runnable { enqueue(block) })
  }

  private fun enqueue(block: () -> Unit) {
    queue.addLast(block)
    if (draining) return // a dispatch is executing: run after it, not inside it
    draining = true
    try {
      while (queue.isNotEmpty()) {
        val next = queue.removeFirst()
        try { next() } catch (t: Throwable) { onError(t) }
      }
    } finally {
      draining = false
    }
  }

  companion object {
    const val ENDED_LINGER_MS = 2_500L
    const val RECONNECT_BUDGET_MS = 25_000L
    /** CONNECTING watchdog: two HTTP attempts plus an SFU connect fit inside. */
    const val CONNECT_WATCHDOG_MS = 20_000L
    /** Caller-side backstop if the server's finish/no-answer never arrives. */
    const val RING_OUT_BACKSTOP_MS = 75_000L
    /**
     * Device clocks drift; the deadline is server epoch. A ring this
     * close past its deadline still shows (for at least this long) —
     * the server's ring_ended(timeout) is the real cut-off.
     */
    const val CLOCK_SLACK_MS = 10_000L
    const val RESOLVED_LRU = 32
    private const val T_DEADLINE = "ring_deadline"
    private const val T_LINGER = "linger"
    private const val T_RECONNECT = "reconnect_budget"
    private const val T_CONNECT = "connect_watchdog"
    private const val T_RING_OUT = "ring_out_backstop"
    private const val T_WAITING = "waiting_deadline"
    private const val T_ALONE = "alone_probe"
    /**
     * Alone in a call: ask the server after a moment (the other side's own
     * reconnect gets that long), and once more past its 30s drop grace.
     */
    val ALONE_PROBES_MS = longArrayOf(3_000L, 35_000L)
  }

  // ── inputs from adapters ────────────────────────────────────────────

  fun currentState(): MachineState = state

  /** Best name for the current call: the server's bundle, else the ring's. Runtime thread only. */
  val conversationName: String? get() = bundle?.conversationName ?: ring?.conversationName

  /** `room` or `call`, once the server's bundle says; null before. Runtime thread only. */
  val callKind: String? get() = bundle?.kind

  /** The call waiting beside the current one, with its caller's names. Runtime thread only. */
  val waitingRing: RingContext? get() = if (state.waiting == null) null else waitingRingCtx

  /** True if [callId] was already resolved here — its ring must never surface again. */
  fun isResolved(callId: String): Boolean = synchronized(resolved) { resolved.containsKey(callId) }

  private fun markResolved(callId: String?) {
    if (callId == null || callId.startsWith("pending:")) return
    synchronized(resolved) { resolved[callId] = Unit }
  }

  /** A ring arrived — push or socket, the machine treats them alike. */
  fun onRing(ctx: RingContext) = post {
    if (isResolved(ctx.callId)) return@post
    // A late duplicate of the ring for the call we are already IN must
    // not reach the machine: it would read as "another call while busy"
    // and busy-decline our own call.
    val s = state
    if (s.callId == ctx.callId && s.phase != Phase.IDLE && s.phase != Phase.RINGING_IN) return@post

    val stale = ctx.ringDeadlineEpochMs + CLOCK_SLACK_MS <= timers.nowMs()
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

  fun onRingEnded(callId: String, reason: String) = post {
    dispatch(Event.RingEnded(callId, reason))
    markResolved(callId)
  }

  fun onCallFinished(callId: String, reason: String? = null) = post {
    dispatch(Event.CallFinished(callId, reason))
    markResolved(callId)
  }

  fun answer() = post { dispatch(Event.UserAnswer) }
  fun decline() = post { dispatch(Event.UserDecline) }
  fun hangUp() = post { dispatch(Event.UserHangup) }
  /**
   * Call waiting: end this call and answer the one waiting. With
   * [callId], only if that is still the call waiting (a stale tap on a
   * surface for an earlier one must not answer a different call).
   */
  fun answerWaiting(callId: String? = null) = post {
    if (callId == null || state.waiting?.callId == callId) dispatch(Event.UserAnswerWaiting)
  }
  /** Call waiting: turn the waiting call away (its caller hears busy). */
  fun declineWaiting(callId: String? = null) = post {
    if (callId == null || state.waiting?.callId == callId) dispatch(Event.UserDeclineWaiting)
  }

  fun place(conversationId: String, media: String, sessionToken: String) = post {
    if (state.phase != Phase.IDLE && state.phase != Phase.ENDED) return@post
    this.sessionToken = sessionToken
    // call_id is server-minted on place; a placeholder keys the state
    // until the bundle arrives.
    dispatch(Event.UserPlace(callId = "pending:$conversationId", conversationId = conversationId, media = media))
  }

  fun join(callId: String, conversationId: String?, sessionToken: String) = post {
    if (state.phase != Phase.IDLE && state.phase != Phase.ENDED) return@post
    this.sessionToken = sessionToken
    dispatch(Event.UserJoin(callId, conversationId))
  }

  /** Caller-side: the bridge resolved every ring from `ring_states`. */
  fun allRingsResolved(outcome: String) = post { dispatch(Event.AllRingsResolved(outcome)) }

  fun onMediaConnected() = post { dispatch(Event.MediaConnected) }
  fun onMediaFailed() = post { dispatch(Event.MediaFailed) }
  fun onMediaLost() = post { dispatch(Event.MediaLost) }
  fun onMediaReconnecting() = post { dispatch(Event.MediaReconnecting) }
  fun onMediaRecovered() = post { dispatch(Event.MediaRecovered) }
  fun onRemoteJoined() = post { dispatch(Event.RemoteJoined) }

  /**
   * The media's remote roster changed: [remotes] other people in it.
   *
   * Everyone else gone from a call (not a room) usually means it is over
   * — and this device may never be told: an iPhone gets no `finished`
   * push, and the conversation channel that carries the socket event can
   * have been left. So, alone, ask the server (the reconnect endpoint
   * answers 410 for a call that is over) and end here as finished if so.
   * Someone back in the room cancels the check.
   */
  fun onRemoteCount(remotes: Int) = post {
    val callId = state.callId ?: return@post
    if (remotes > 0) {
      remoteSeenFor = callId
      timers.cancel(T_ALONE)
      return@post
    }
    if (state.phase != Phase.ACTIVE || callKind == "room" || remoteSeenFor != callId) return@post
    scheduleAloneProbe(callId, 0)
  }

  private fun scheduleAloneProbe(callId: String, attempt: Int) {
    if (attempt >= ALONE_PROBES_MS.size) return
    val g = gen
    timers.schedule(T_ALONE, ALONE_PROBES_MS[attempt]) {
      post { if (g == gen && state.callId == callId) probeAlone(callId, attempt) }
    }
  }

  private fun probeAlone(callId: String, attempt: Int) {
    if (state.phase != Phase.ACTIVE) return
    val b = bundle ?: return
    val g = gen
    // A still-live answer carries a fresh bundle; the current one stays
    // in use (its token is still good), so it is dropped.
    http.reconnect(b) { res ->
      post {
        if (g != gen || state.callId != callId) return@post
        if (res == HttpResult.Gone) dispatch(Event.CallFinished(callId, "finished"))
        else scheduleAloneProbe(callId, attempt + 1)
      }
    }
  }

  fun setMuted(muted: Boolean) = post { media.setMuted(muted) }
  fun setCamera(on: Boolean) = post { media.setCamera(on) }
  fun switchCamera() = post { media.switchCamera() }
  fun setSpeaker(on: Boolean) = post { media.setSpeaker(on) }
  fun setAudioOutput(id: String) = post { media.setAudioOutput(id) }

  /** Re-emit the current state (the bridge's roster/route changed). */
  fun reemit() = post { if (state.phase != Phase.IDLE) sink.emit(state) }

  // ── dispatch ────────────────────────────────────────────────────────

  private fun isTerminal(p: Phase) = p == Phase.IDLE || p == Phase.ENDED

  private fun dispatch(event: Event, ringCtx: RingContext? = null) {
    val before = state
    val (next, effects) = CallMachine.transition(before, event)
    state = next
    // A new call attempt, or the end of one: old callbacks go stale.
    if (next.phase == Phase.CONNECTING && before.phase != Phase.CONNECTING) gen++
    if (isTerminal(next.phase) && !isTerminal(before.phase)) {
      gen++
      markResolved(before.callId)
    }
    for (effect in effects) execute(effect, ringCtx, before)
    // Retire the ring grant only after EVERY effect has had its chance
    // to use it. CONNECTING keeps it (answer + the no-bundle hangup
    // fallback still need it); CallSessionStop clears it with the rest.
    if (isTerminal(next.phase)) ring = null
    // A bundle never outlives its call — whatever ended it.
    if (isTerminal(next.phase)) { bundle = null; sessionToken = null }
    // A waiting call that went away without becoming the current one
    // (declined, cancelled, timed out) is resolved: its ring never again.
    before.waiting?.let { w ->
      if (next.waiting?.callId != w.callId && next.callId != w.callId) markResolved(w.callId)
    }
    if (next.waiting == null) waitingRingCtx = null
    runTimers(before, next)
    if (next != before || effects.isNotEmpty()) sink.emit(next)
  }

  private fun execute(effect: Effect, ringCtx: RingContext?, before: MachineState) {
    val g = gen
    when (effect) {
      Effect.ShowRing -> {
        // A promoted waiting call rings with the ring already on file.
        if (ringCtx != null) ring = ringCtx
        ring?.let(surface::show)
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
        if (r != null) http.answer(r.callId, r.grant) { res -> post { onHttpResult(g, res) } }
        else post { onHttpResult(g, HttpResult.AuthFailed("no_grant")) }
      }
      Effect.HttpJoin -> {
        val callId = state.callId
        val token = sessionToken
        if (callId != null && token != null) http.join(callId, token) { res -> post { onHttpResult(g, res) } }
        else post { onHttpResult(g, HttpResult.AuthFailed("no_session")) }
      }
      Effect.HttpPlace -> {
        val conversationId = state.conversationId
        val token = sessionToken
        if (conversationId != null && token != null) {
          http.place(conversationId, state.media, token) { res -> post { onHttpResult(g, res) } }
        } else post { onHttpResult(g, HttpResult.AuthFailed("no_session")) }
      }
      Effect.HttpDecline -> {
        ring?.let { http.decline(it.callId, it.grant, busy = false) }
      }
      is Effect.HttpDeclineBusy -> {
        val waitingMatch = waitingRingCtx?.takeIf { it.callId == effect.callId }
        (busyRings[effect.callId] ?: waitingMatch)?.let { http.decline(it.callId, it.grant, busy = true) }
        markResolved(effect.callId)
      }
      Effect.HttpHangup -> {
        val b = bundle
        val r = ring
        when {
          b != null -> http.hangup(b.callId, b.controlToken)
          // Hanging up a connecting answer that has no bundle yet:
          // resolve the ring instead, so the caller is not left waiting.
          // (The answer's late 2xx is hung up in onHttpResult.)
          r != null -> http.decline(r.callId, r.grant, busy = false)
          else -> Unit
        }
      }
      Effect.HttpReconnect -> {
        val b = bundle
        if (b != null) http.reconnect(b) { res -> post { onReconnectResult(g, res) } }
        else post { if (g == gen) dispatch(Event.HttpGone) }
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

      Effect.ShowWaiting -> {
        waitingRingCtx = ringCtx
        ringCtx?.let(surface::showWaiting)
      }
      // The grant is NOT retired here: HTTP_DECLINE_BUSY may precede or follow.
      Effect.DismissWaiting -> before.waiting?.let { surface.dismissWaiting(it.callId) }
      Effect.PromoteWaiting -> {
        // The old call is over: nothing it started may land on this one.
        markResolved(before.callId)
        gen++
        bundle = null
        sessionToken = null
        ring = waitingRingCtx
        waitingRingCtx = null
        before.waiting?.let { surface.promoteWaiting(it.callId) }
      }
    }
  }

  private fun onHttpResult(requestGen: Int, result: HttpResult) {
    if (requestGen != gen) {
      // The call this request belonged to is over (the user hung up
      // while it was in flight). The server may still have let us in:
      // leave, with the token it just gave us, and keep nothing.
      if (result is HttpResult.Ok) http.hangup(result.bundle.callId, result.bundle.controlToken)
      return
    }
    when (result) {
      is HttpResult.Ok -> {
        val existing = bundle
        if (existing != null) {
          // The timeout retry's twin answered too. Same call: ignore.
          // Somehow a different one: we are not in it — leave it.
          if (existing.callId != result.bundle.callId) {
            http.hangup(result.bundle.callId, result.bundle.controlToken)
          }
          return
        }
        if (state.phase != Phase.CONNECTING) {
          http.hangup(result.bundle.callId, result.bundle.controlToken)
          return
        }
        bundle = result.bundle
        // The server is the authority on the call's identity: the real
        // id minted on place, and — for a join, which starts with only a
        // call id and an "audio" default — its conversation and media.
        // A video join left as "audio" took the earpiece wake lock, said
        // "Voice call" and hid the camera; a null conversationId broke JS.
        val b = result.bundle
        state = state.copy(callId = b.callId, conversationId = b.conversationId, media = b.media)
        dispatch(Event.HttpOk(created = b.created))
      }
      HttpResult.Gone -> dispatch(Event.HttpGone)
      HttpResult.Timeout -> dispatch(Event.HttpTimeout)
      is HttpResult.AuthFailed -> dispatch(Event.HttpFailed(result.code))
      is HttpResult.Failed -> dispatch(Event.HttpFailed(result.code))
    }
  }

  private fun onReconnectResult(requestGen: Int, result: HttpResult) {
    if (requestGen != gen || state.phase != Phase.RECONNECTING) return
    when (result) {
      is HttpResult.Ok -> {
        // Fresh token (and possibly URL): rejoin with it. MEDIA_CONNECTED
        // on the new room returns us to ACTIVE.
        bundle = result.bundle
        media.join(result.bundle)
      }
      HttpResult.Gone -> dispatch(Event.HttpGone)
      is HttpResult.AuthFailed -> dispatch(Event.HttpFailed(result.code))
      // Transient: the reconnect budget timer is the backstop.
      HttpResult.Timeout, is HttpResult.Failed -> Unit
    }
  }

  // ── timers ──────────────────────────────────────────────────────────

  private fun schedule(key: String, delayMs: Long, event: Event) {
    val g = gen
    // The timer fires on its own thread; hop onto the queue, and only
    // act if it is still the same call (a cancel can lose the race).
    timers.schedule(key, delayMs) { post { if (g == gen) dispatch(event) } }
  }

  private fun runTimers(before: MachineState, after: MachineState) {
    runWaitingTimer(before, after)
    // A different call in the same phase (end-and-answer while connecting)
    // needs its own timers: the old ones belong to a retired generation.
    if (before.phase == after.phase && before.callId == after.callId) return
    when (before.phase) {
      Phase.RINGING_IN -> timers.cancel(T_DEADLINE)
      Phase.ENDED -> timers.cancel(T_LINGER)
      Phase.RECONNECTING -> timers.cancel(T_RECONNECT)
      Phase.CONNECTING -> timers.cancel(T_CONNECT)
      Phase.RINGING_OUT -> timers.cancel(T_RING_OUT)
      else -> Unit
    }
    when (after.phase) {
      Phase.RINGING_IN -> {
        val deadline = ring?.ringDeadlineEpochMs ?: return
        // Floor at the clock slack: a ring we decided is not stale
        // still gets a moment on screen even if this clock runs ahead.
        val delay = (deadline - timers.nowMs()).coerceAtLeast(CLOCK_SLACK_MS)
        schedule(T_DEADLINE, delay, Event.RingDeadline)
      }
      Phase.ENDED -> schedule(T_LINGER, ENDED_LINGER_MS, Event.LingerElapsed)
      Phase.RECONNECTING -> schedule(T_RECONNECT, RECONNECT_BUDGET_MS, Event.ReconnectBudgetElapsed)
      Phase.CONNECTING -> schedule(T_CONNECT, CONNECT_WATCHDOG_MS, Event.ConnectTimeout)
      Phase.RINGING_OUT -> schedule(T_RING_OUT, RING_OUT_BACKSTOP_MS, Event.AllRingsResolved("no_answer"))
      else -> Unit
    }
  }

  private fun runWaitingTimer(before: MachineState, after: MachineState) {
    val was = before.waiting?.callId
    val now = after.waiting?.callId
    if (was == now) return
    if (was != null) timers.cancel(T_WAITING)
    val deadline = waitingRingCtx?.ringDeadlineEpochMs
    if (now == null || deadline == null) return
    val delay = (deadline - timers.nowMs()).coerceAtLeast(CLOCK_SLACK_MS)
    // Keyed to the waiting call, not the generation: the current call may
    // move on (connect, reconnect) while this one keeps waiting.
    timers.schedule(T_WAITING, delay) { post { if (state.waiting?.callId == now) dispatch(Event.WaitingDeadline) } }
  }
}
