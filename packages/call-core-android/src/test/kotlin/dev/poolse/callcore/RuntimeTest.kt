package dev.poolse.callcore

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Scenario tests for the runtime's bookkeeping — the part the vectors
 * cannot see: which grant answers which call, which control token
 * hangs up, what the timers fire, what the ports actually receive.
 */
class RuntimeTest {

  // ── fakes ───────────────────────────────────────────────────────────

  private class FakeHttp : HttpPort {
    val log = mutableListOf<String>()
    var lastCb: ((HttpResult) -> Unit)? = null
    val cbs = mutableListOf<(HttpResult) -> Unit>()
    var lastReconnectCb: ((HttpResult) -> Unit)? = null
    /** When set, request/response doors answer synchronously, inside the effect. */
    var immediate: HttpResult? = null

    private fun take(cb: (HttpResult) -> Unit) {
      lastCb = cb; cbs += cb
      immediate?.let(cb)
    }

    override fun answer(callId: String, grant: String, cb: (HttpResult) -> Unit) {
      log += "answer:$callId:$grant"; take(cb)
    }
    override fun join(callId: String, sessionToken: String, cb: (HttpResult) -> Unit) {
      log += "join:$callId:$sessionToken"; take(cb)
    }
    override fun place(conversationId: String, media: String, sessionToken: String, cb: (HttpResult) -> Unit) {
      log += "place:$conversationId:$media:$sessionToken"; take(cb)
    }
    override fun decline(callId: String, auth: String, busy: Boolean) {
      log += "decline:$callId:$auth:busy=$busy"
    }
    override fun hangup(callId: String, controlToken: String) {
      log += "hangup:$callId:$controlToken"
    }
    override fun reconnect(current: CallSessionBundle, cb: (HttpResult) -> Unit) {
      log += "reconnect:${current.callId}:${current.controlToken}"; lastReconnectCb = cb
    }
  }

  private class FakeMedia : MediaPort {
    val log = mutableListOf<String>()
    override fun join(bundle: CallSessionBundle) { log += "join:${bundle.callId}:${bundle.livekitToken}" }
    override fun leave() { log += "leave" }
    override fun setMuted(muted: Boolean) { log += "muted:$muted" }
    override fun setCamera(on: Boolean) { log += "camera:$on" }
    override fun switchCamera() { log += "switch" }
    override fun setSpeaker(on: Boolean) { log += "speaker:$on" }
  }

  private class FakeSurface : RingSurfacePort {
    val log = mutableListOf<String>()
    override fun show(ring: RingContext) { log += "show:${ring.callId}" }
    override fun dismiss(callId: String) { log += "dismiss:$callId" }
    override fun ringtoneStart() { log += "ringtone+" }
    override fun ringtoneStop() { log += "ringtone-" }
    override fun ringbackStart() { log += "ringback+" }
    override fun ringbackStop() { log += "ringback-" }
    override fun showWaiting(ring: RingContext) { log += "waiting:${ring.callId}" }
    override fun dismissWaiting(callId: String) { log += "unwait:$callId" }
    override fun promoteWaiting(callId: String) { log += "promote:$callId" }
  }

  private class FakeSession : CallSessionPort {
    val log = mutableListOf<String>()
    override fun start(callId: String, media: String) { log += "start:$callId:$media" }
    override fun stop() { log += "stop" }
  }

  private class FakeTimers : TimerPort {
    var now = 1_000_000L
    val scheduled = mutableMapOf<String, Pair<Long, () -> Unit>>()
    override fun nowMs() = now
    override fun schedule(key: String, delayMs: Long, fire: () -> Unit) { scheduled[key] = delayMs to fire }
    override fun cancel(key: String) { scheduled.remove(key) }
    fun fire(key: String) {
      val (_, fn) = scheduled.remove(key) ?: error("timer $key not scheduled")
      fn()
    }
  }

  private class FakeSink : SnapshotSink {
    val phases = mutableListOf<Phase>()
    val states = mutableListOf<MachineState>()
    override fun emit(state: MachineState) { phases += state.phase; states += state }
  }

  private class Rig {
    val http = FakeHttp(); val media = FakeMedia(); val surface = FakeSurface()
    val session = FakeSession(); val timers = FakeTimers(); val sink = FakeSink()
    val runtime = CallCoreRuntime(http, media, surface, session, timers, sink)
  }

  private fun ring(callId: String = "c1", deadlineIn: Long = 45_000) = RingContext(
    callId = callId, conversationId = "conv-$callId", conversationName = "Fix the boiler",
    callerName = "Elena", media = "audio", grant = "grant-$callId",
    ringDeadlineEpochMs = 1_000_000L + deadlineIn,
  )

  private fun bundle(callId: String = "c1", created: Boolean = true) = CallSessionBundle(
    callId = callId, conversationId = "conv-$callId", conversationName = "Fix the boiler",
    media = "audio", created = created, livekitUrl = "wss://sfu", livekitToken = "lk-$callId",
    controlToken = "ctl-$callId",
  )

  // ── scenarios ───────────────────────────────────────────────────────

  @Test
  fun `cold ring to connected call uses the ring's grant end to end`() {
    val r = Rig()
    r.runtime.onRing(ring())
    assertEquals(listOf("show:c1", "ringtone+"), r.surface.log)
    assertTrue(r.timers.scheduled.containsKey("ring_deadline"))

    r.runtime.answer()
    assertEquals("answer:c1:grant-c1", r.http.log.last())
    assertEquals("start:c1:audio", r.session.log.last())
    assertNull(r.timers.scheduled["ring_deadline"], "deadline cancelled on answer")

    r.http.lastCb!!(HttpResult.Ok(bundle()))
    assertEquals("join:c1:lk-c1", r.media.log.last())

    r.runtime.onMediaConnected()
    assertEquals(Phase.ACTIVE, r.runtime.currentState().phase)
    assertEquals(Phase.ACTIVE, r.sink.phases.last())
  }

  @Test
  fun `a second ring is busy-declined with ITS OWN grant`() {
    val r = Rig()
    r.runtime.onRing(ring("c1"))
    r.runtime.onRing(ring("c2"))
    assertEquals("decline:c2:grant-c2:busy=true", r.http.log.last())
    assertEquals(Phase.RINGING_IN, r.runtime.currentState().phase)
    assertEquals("c1", r.runtime.currentState().callId)
  }

  @Test
  fun `the ring deadline dismisses the surface`() {
    val r = Rig()
    r.runtime.onRing(ring())
    r.timers.fire("ring_deadline")
    assertEquals(listOf("show:c1", "ringtone+", "ringtone-", "dismiss:c1"), r.surface.log)
    assertEquals(Phase.IDLE, r.runtime.currentState().phase)
  }

  @Test
  fun `decline resolves with the grant and goes idle`() {
    val r = Rig()
    r.runtime.onRing(ring())
    r.runtime.decline()
    assertEquals("decline:c1:grant-c1:busy=false", r.http.log.last())
    assertEquals(Phase.IDLE, r.runtime.currentState().phase)
  }

  @Test
  fun `a stale ring never surfaces`() {
    val r = Rig()
    // Past the deadline by more than the 10 s clock slack.
    r.runtime.onRing(ring(deadlineIn = -10_001))
    assertTrue(r.surface.log.isEmpty())
    assertEquals(Phase.IDLE, r.runtime.currentState().phase)
  }

  @Test
  fun `placing adopts the server-minted call id and rings back`() {
    val r = Rig()
    r.runtime.place("conv-1", "audio", "sess-token")
    assertEquals("place:conv-1:audio:sess-token", r.http.log.last())

    r.http.lastCb!!(HttpResult.Ok(bundle("real-id")))
    assertEquals("real-id", r.runtime.currentState().callId)
    assertEquals(Phase.RINGING_OUT, r.runtime.currentState().phase)
    assertEquals("ringback+", r.surface.log.last())

    r.runtime.onRemoteJoined()
    assertEquals(Phase.ACTIVE, r.runtime.currentState().phase)
    assertEquals("ringback-", r.surface.log.last())
  }

  @Test
  fun `placing onto an already-live call becomes a join without ringback`() {
    val r = Rig()
    r.runtime.place("conv-1", "audio", "sess-token")
    r.http.lastCb!!(HttpResult.Ok(bundle("real-id", created = false)))
    assertEquals(Direction.JOINED, r.runtime.currentState().direction)
    assertEquals(Phase.CONNECTING, r.runtime.currentState().phase)
    assertTrue(r.surface.log.none { it == "ringback+" })
  }

  @Test
  fun `reconnect uses the control token and a refusal means we are out`() {
    val r = Rig()
    r.runtime.onRing(ring())
    r.runtime.answer()
    r.http.lastCb!!(HttpResult.Ok(bundle()))
    r.runtime.onMediaConnected()

    r.runtime.onMediaLost()
    assertEquals("reconnect:c1:ctl-c1", r.http.log.last())
    assertTrue(r.timers.scheduled.containsKey("reconnect_budget"))

    r.http.lastReconnectCb!!(HttpResult.Gone)
    assertEquals(Phase.ENDED, r.runtime.currentState().phase)
    assertEquals(EndReason.LEFT, r.runtime.currentState().reason)
    assertEquals("stop", r.session.log.last())
  }

  @Test
  fun `an exhausted reconnect budget hangs up with the control token`() {
    val r = Rig()
    r.runtime.onRing(ring())
    r.runtime.answer()
    r.http.lastCb!!(HttpResult.Ok(bundle()))
    r.runtime.onMediaConnected()
    r.runtime.onMediaLost()

    r.timers.fire("reconnect_budget")
    assertEquals(EndReason.CONNECTION_LOST, r.runtime.currentState().reason)
    assertTrue(r.http.log.contains("hangup:c1:ctl-c1"))
  }

  @Test
  fun `hanging up mid-answer with no bundle resolves the ring instead`() {
    val r = Rig()
    r.runtime.onRing(ring())
    r.runtime.answer()
    // No HTTP result yet — the caller must still learn we backed out.
    r.runtime.hangUp()
    assertEquals("decline:c1:grant-c1:busy=false", r.http.log.last())
    assertEquals(Phase.ENDED, r.runtime.currentState().phase)
  }

  @Test
  fun `the linger resets to idle and a new ring may interrupt it`() {
    val r = Rig()
    r.runtime.onRing(ring())
    r.runtime.decline()
    // decline goes straight to idle; build an ended state via hangup:
    r.runtime.onRing(ring("c3"))
    r.runtime.answer()
    r.http.lastCb!!(HttpResult.Ok(bundle("c3")))
    r.runtime.onMediaConnected()
    r.runtime.hangUp()
    assertEquals(Phase.ENDED, r.runtime.currentState().phase)
    assertTrue(r.timers.scheduled.containsKey("linger"))

    r.timers.fire("linger")
    assertEquals(Phase.IDLE, r.runtime.currentState().phase)
  }

  @Test
  fun `leaving an active call sends hangup and the server decides the rest`() {
    val r = Rig()
    r.runtime.onRing(ring())
    r.runtime.answer()
    r.http.lastCb!!(HttpResult.Ok(bundle()))
    r.runtime.onMediaConnected()

    r.runtime.hangUp()
    assertEquals("hangup:c1:ctl-c1", r.http.log.last())
    assertEquals(EndReason.LEFT, r.runtime.currentState().reason)
    assertEquals("leave", r.media.log.last())
  }

  // ── fixes: reconnect, stale bundles, failures, finish, dedupe ───────

  private fun Rig.activeCall(callId: String = "c1") {
    runtime.onRing(ring(callId))
    runtime.answer()
    http.lastCb!!(HttpResult.Ok(bundle(callId)))
    runtime.onMediaConnected()
    assertEquals(Phase.ACTIVE, runtime.currentState().phase)
  }

  private fun Rig.ringingOut(): String {
    runtime.place("conv-1", "audio", "sess")
    http.lastCb!!(HttpResult.Ok(bundle("out-1")))
    assertEquals(Phase.RINGING_OUT, runtime.currentState().phase)
    return "out-1"
  }

  @Test
  fun `a ring just past its deadline still shows within the clock slack`() {
    val r = Rig()
    r.runtime.onRing(ring(deadlineIn = -5_000))
    assertEquals(Phase.RINGING_IN, r.runtime.currentState().phase)
    assertEquals(CallCoreRuntime.CLOCK_SLACK_MS, r.timers.scheduled["ring_deadline"]!!.first)
  }

  @Test
  fun `reconnect applies the fresh bundle and rejoins, media up returns to active`() {
    val r = Rig()
    r.activeCall()
    r.runtime.onMediaLost()
    assertEquals(Phase.RECONNECTING, r.runtime.currentState().phase)

    val fresh = bundle().copy(livekitToken = "lk-fresh", controlToken = "ctl-fresh")
    r.http.lastReconnectCb!!(HttpResult.Ok(fresh))
    assertEquals("join:c1:lk-fresh", r.media.log.last())

    r.runtime.onMediaConnected()
    assertEquals(Phase.ACTIVE, r.runtime.currentState().phase)
    assertNull(r.timers.scheduled["reconnect_budget"])

    // The fresh control token is the one used from now on.
    r.runtime.hangUp()
    assertEquals("hangup:c1:ctl-fresh", r.http.log.last())
  }

  @Test
  fun `SFU self-recovery shows reconnecting without asking the server`() {
    val r = Rig()
    r.activeCall()
    val before = r.http.log.size
    r.runtime.onMediaReconnecting()
    assertEquals(Phase.RECONNECTING, r.runtime.currentState().phase)
    assertEquals(before, r.http.log.size, "no /reconnect while LiveKit recovers itself")
    assertTrue(r.media.log.last() != "leave")
    r.runtime.onMediaRecovered()
    assertEquals(Phase.ACTIVE, r.runtime.currentState().phase)
  }

  @Test
  fun `hanging up while connecting hangs up the late bundle and never keeps it`() {
    val r = Rig()
    r.runtime.onRing(ring())
    r.runtime.answer()
    r.runtime.hangUp()
    assertEquals(Phase.ENDED, r.runtime.currentState().phase)

    // The answer's 2xx lands after the user already left.
    r.http.lastCb!!(HttpResult.Ok(bundle()))
    assertEquals("hangup:c1:ctl-c1", r.http.log.last())
    assertTrue(r.media.log.none { it.startsWith("join") }, "no media for a call we left")

    // The next call starts clean: its own bundle, not the stale one.
    r.runtime.onRing(ring("c2"))
    r.runtime.answer()
    r.http.lastCb!!(HttpResult.Ok(bundle("c2")))
    assertEquals("join:c2:lk-c2", r.media.log.last())
  }

  @Test
  fun `a previous call's late place response cannot be adopted by the next call`() {
    val r = Rig()
    r.runtime.place("conv-a", "audio", "sess")
    val first = r.http.lastCb!!
    r.runtime.hangUp()
    r.runtime.place("conv-b", "audio", "sess")
    assertEquals(Phase.CONNECTING, r.runtime.currentState().phase)

    first(HttpResult.Ok(bundle("a")))
    assertEquals("hangup:a:ctl-a", r.http.log.last())
    assertEquals(Phase.CONNECTING, r.runtime.currentState().phase)
    assertEquals("pending:conv-b", r.runtime.currentState().callId)
    assertTrue(r.media.log.none { it.startsWith("join") })
  }

  @Test
  fun `the retry's twin 2xx is ignored, not joined twice or hung up`() {
    val r = Rig()
    r.runtime.onRing(ring())
    r.runtime.answer()
    val first = r.http.cbs[0]
    first(HttpResult.Timeout)
    val second = r.http.cbs[1]
    second(HttpResult.Ok(bundle()))
    first(HttpResult.Ok(bundle()))
    assertEquals(1, r.media.log.count { it.startsWith("join") })
    assertTrue(r.http.log.none { it.startsWith("hangup") })
  }

  @Test
  fun `media failure while ringing out fails the call and cleans up`() {
    val r = Rig()
    r.ringingOut()
    r.runtime.onMediaFailed()
    val s = r.runtime.currentState()
    assertEquals(Phase.ENDED, s.phase)
    assertEquals(EndReason.FAILED, s.reason)
    assertEquals("ringback-", r.surface.log.last())
    assertEquals("leave", r.media.log.last())
    assertEquals("hangup:out-1:ctl-out-1", r.http.log.last())
    assertEquals("stop", r.session.log.last())
  }

  @Test
  fun `finished push ends ringing-out with the push's reason and stops ringback`() {
    val r = Rig()
    val id = r.ringingOut()
    r.runtime.onCallFinished(id, "no_answer")
    val s = r.runtime.currentState()
    assertEquals(Phase.ENDED, s.phase)
    assertEquals(EndReason.NO_ANSWER, s.reason)
    assertEquals("ringback-", r.surface.log.last())
    assertEquals("leave", r.media.log.last())
    assertTrue(r.http.log.none { it.startsWith("hangup") }, "server already finished it")
  }

  @Test
  fun `finished push ends an active call as finished`() {
    val r = Rig()
    r.activeCall()
    r.runtime.onCallFinished("c1", "finished")
    assertEquals(EndReason.FINISHED, r.runtime.currentState().reason)
    assertEquals("stop", r.session.log.last())
  }

  @Test
  fun `auth refusal fails, not finishes`() {
    val r = Rig()
    r.runtime.onRing(ring())
    r.runtime.answer()
    r.http.lastCb!!(HttpResult.AuthFailed("grant_spent"))
    assertEquals(EndReason.FAILED, r.runtime.currentState().reason)
    assertEquals("stop", r.session.log.last())
  }

  @Test
  fun `a second timeout ends connecting as failed`() {
    val r = Rig()
    r.runtime.place("conv-1", "audio", "sess")
    r.http.lastCb!!(HttpResult.Timeout)
    assertEquals(Phase.CONNECTING, r.runtime.currentState().phase)
    r.http.lastCb!!(HttpResult.Timeout)
    assertEquals(Phase.ENDED, r.runtime.currentState().phase)
    assertEquals(EndReason.FAILED, r.runtime.currentState().reason)
    assertEquals("stop", r.session.log.last())
  }

  @Test
  fun `the connecting watchdog fails a call that never got in`() {
    val r = Rig()
    r.runtime.place("conv-1", "audio", "sess")
    r.timers.fire("connect_watchdog")
    assertEquals(EndReason.FAILED, r.runtime.currentState().reason)
  }

  @Test
  fun `a resolved call never rings again`() {
    val r = Rig()
    r.runtime.onRing(ring("c1"))
    r.runtime.decline()
    r.surface.log.clear()
    r.runtime.onRing(ring("c1"))
    assertTrue(r.surface.log.isEmpty())
    assertEquals(Phase.IDLE, r.runtime.currentState().phase)

    // ring_ended before the ring itself (push reordering)
    r.runtime.onRingEnded("c9", "cancelled")
    r.runtime.onRing(ring("c9"))
    assertTrue(r.surface.log.isEmpty())
  }

  @Test
  fun `a duplicate ring of the call we are in is not busy-declined`() {
    val r = Rig()
    r.activeCall("c1")
    r.runtime.onRing(ring("c1"))
    assertTrue(r.http.log.none { it.startsWith("decline") })
    assertEquals(Phase.ACTIVE, r.runtime.currentState().phase)
  }

  @Test
  fun `the resolved LRU is bounded`() {
    val r = Rig()
    for (i in 0..CallCoreRuntime.RESOLVED_LRU) r.runtime.onRingEnded("x$i", "cancelled")
    assertTrue(!r.runtime.isResolved("x0"), "eldest evicted")
    assertTrue(r.runtime.isResolved("x${CallCoreRuntime.RESOLVED_LRU}"))
  }

  @Test
  fun `a synchronous port result is queued, not re-entered, and snapshots stay ordered`() {
    val r = Rig()
    r.http.immediate = HttpResult.Ok(bundle("out-1"))
    r.runtime.place("conv-1", "audio", "sess")
    assertEquals(Phase.RINGING_OUT, r.runtime.currentState().phase)
    assertEquals(listOf(Phase.CONNECTING, Phase.RINGING_OUT), r.sink.phases)
    assertEquals("start:pending:conv-1:audio", r.session.log.first())
  }

  @Test
  fun `ended lingers with its reason then clears to idle`() {
    val r = Rig()
    r.activeCall()
    r.runtime.hangUp()
    assertEquals(Phase.ENDED, r.sink.states.last().phase)
    assertEquals(EndReason.LEFT, r.sink.states.last().reason)
    assertEquals(CallCoreRuntime.ENDED_LINGER_MS, r.timers.scheduled["linger"]!!.first)
    r.timers.fire("linger")
    assertEquals(Phase.IDLE, r.sink.phases.last())
  }

  @Test
  fun `a stale timer from a previous call cannot touch the next`() {
    val r = Rig()
    r.runtime.place("conv-a", "audio", "sess")
    val (_, staleFire) = r.timers.scheduled["connect_watchdog"]!!
    r.runtime.hangUp()
    r.runtime.place("conv-b", "audio", "sess")
    staleFire()
    assertEquals(Phase.CONNECTING, r.runtime.currentState().phase)
  }

  // ── review fixes ────────────────────────────────────────────────────

  @Test
  fun `a join adopts the server's conversation and media`() {
    val r = Rig()
    r.runtime.join("c1", null, "sess")
    assertEquals("audio", r.runtime.currentState().media)
    r.http.lastCb!!(HttpResult.Ok(bundle().copy(media = "video", conversationId = "conv-x")))
    val s = r.runtime.currentState()
    assertEquals("video", s.media)
    assertEquals("conv-x", s.conversationId)
    assertEquals("video", r.sink.states.last().media)
  }

  @Test
  fun `a later finish with an outcome corrects the lingering ended reason`() {
    val r = Rig()
    val id = r.ringingOut()
    r.runtime.onCallFinished(id, null) // socket, no reason
    assertEquals(EndReason.FINISHED, r.runtime.currentState().reason)
    r.runtime.onCallFinished(id, "declined_all") // FCM, with reason
    assertEquals(EndReason.DECLINED_ALL, r.runtime.currentState().reason)
    assertEquals(EndReason.DECLINED_ALL, r.sink.states.last().reason)
    assertTrue(r.timers.scheduled.containsKey("linger"), "linger untouched")
  }

  // ── call waiting ────────────────────────────────────────────────────

  @Test
  fun `a second ring during a call waits with its own grant`() {
    val r = Rig()
    r.activeCall("c1")
    r.runtime.onRing(ring("c2"))
    val s = r.runtime.currentState()
    assertEquals(Phase.ACTIVE, s.phase)
    assertEquals("c1", s.callId)
    assertEquals("c2", s.waiting?.callId)
    assertEquals("waiting:c2", r.surface.log.last())
    assertEquals("Elena", r.runtime.waitingRing?.callerName)
    assertNotNull(r.timers.scheduled["waiting_deadline"])
    assertFalse(r.http.log.any { it.startsWith("decline:c2") }, "a waiting call is not turned away")
    assertEquals("c2", r.sink.states.last().waiting?.callId, "the snapshot carries it")
  }

  @Test
  fun `end and answer retires the old call and answers with the waiting grant`() {
    val r = Rig()
    r.activeCall("c1")
    r.runtime.onRing(ring("c2"))
    r.runtime.answerWaiting()

    assertTrue("hangup:c1:ctl-c1" in r.http.log)
    assertEquals("answer:c2:grant-c2", r.http.log.last())
    assertEquals("leave", r.media.log.last())
    assertEquals(listOf("stop", "start:c2:audio"), r.session.log.takeLast(2))
    assertEquals("promote:c2", r.surface.log.last())
    assertFalse("show:c2" in r.surface.log, "never rings: it goes straight to connecting")
    val s = r.runtime.currentState()
    assertEquals(Phase.CONNECTING, s.phase)
    assertEquals("c2", s.callId)
    assertEquals(Direction.INCOMING, s.direction)
    assertNull(s.waiting)
    assertNull(r.timers.scheduled["waiting_deadline"])
    assertNotNull(r.timers.scheduled["connect_watchdog"])

    // A late duplicate ring of the old call is dropped (resolved).
    r.runtime.onRing(ring("c1"))
    assertEquals("c2", r.runtime.currentState().callId)

    r.http.lastCb!!(HttpResult.Ok(bundle("c2")))
    assertEquals("join:c2:lk-c2", r.media.log.last())
    r.runtime.onMediaConnected()
    assertEquals(Phase.ACTIVE, r.runtime.currentState().phase)
    assertEquals("c2", r.runtime.currentState().callId)
  }

  @Test
  fun `end and answer while connecting ignores the old answer and gets its own watchdog`() {
    val r = Rig()
    r.runtime.onRing(ring("c1"))
    r.runtime.answer()
    val oldAnswer = r.http.lastCb!!
    r.runtime.onRing(ring("c2"))
    assertEquals("c2", r.runtime.currentState().waiting?.callId)
    r.runtime.answerWaiting()
    // No bundle yet for c1: leaving it resolves its ring instead.
    assertTrue("decline:c1:grant-c1:busy=false" in r.http.log)
    assertEquals("answer:c2:grant-c2", r.http.log.last())

    // c1's answer lands late: left at once, and nothing of it is kept.
    oldAnswer(HttpResult.Ok(bundle("c1")))
    assertEquals("hangup:c1:ctl-c1", r.http.log.last())
    assertEquals("c2", r.runtime.currentState().callId)
    assertEquals(Phase.CONNECTING, r.runtime.currentState().phase)

    // The watchdog running now is c2's, and it is live.
    r.timers.fire("connect_watchdog")
    assertEquals(Phase.ENDED, r.runtime.currentState().phase)
  }

  @Test
  fun `declining the waiting call busies it and it never returns`() {
    val r = Rig()
    r.activeCall("c1")
    r.runtime.onRing(ring("c2"))
    r.runtime.declineWaiting()
    assertEquals("decline:c2:grant-c2:busy=true", r.http.log.last())
    assertEquals("unwait:c2", r.surface.log.last())
    assertNull(r.runtime.currentState().waiting)
    assertNull(r.runtime.waitingRing)
    assertNull(r.timers.scheduled["waiting_deadline"])
    r.runtime.onRing(ring("c2")) // redelivered push
    assertNull(r.runtime.currentState().waiting)
    assertEquals("c1", r.runtime.currentState().callId)
  }

  @Test
  fun `hanging up rings the waiting call which answers with its grant`() {
    val r = Rig()
    r.activeCall("c1")
    r.runtime.onRing(ring("c2"))
    r.runtime.hangUp()
    assertTrue("hangup:c1:ctl-c1" in r.http.log)
    assertEquals(Phase.RINGING_IN, r.runtime.currentState().phase)
    assertEquals("c2", r.runtime.currentState().callId)
    assertEquals(listOf("promote:c2", "show:c2", "ringtone+"), r.surface.log.takeLast(3))
    assertNotNull(r.timers.scheduled["ring_deadline"])
    assertNull(r.timers.scheduled["waiting_deadline"])
    r.runtime.answer()
    assertEquals("answer:c2:grant-c2", r.http.log.last())
  }

  @Test
  fun `the waiting deadline clears it as missed`() {
    val r = Rig()
    r.activeCall("c1")
    r.runtime.onRing(ring("c2"))
    r.timers.fire("waiting_deadline")
    assertNull(r.runtime.currentState().waiting)
    assertEquals("unwait:c2", r.surface.log.last())
    assertFalse(r.http.log.any { it.startsWith("decline:c2") }, "a missed call is the server's to record")
    r.runtime.onRing(ring("c2"))
    assertNull(r.runtime.currentState().waiting)
  }

  @Test
  fun `the waiting call outlives the current call connecting`() {
    val r = Rig()
    r.runtime.place("conv-1", "audio", "sess")
    r.runtime.onRing(ring("c2"))
    assertEquals("c2", r.runtime.currentState().waiting?.callId)
    r.http.lastCb!!(HttpResult.Ok(bundle("out-1")))
    assertEquals(Phase.RINGING_OUT, r.runtime.currentState().phase)
    assertEquals("c2", r.runtime.currentState().waiting?.callId)
    r.timers.fire("waiting_deadline")
    assertNull(r.runtime.currentState().waiting, "the deadline still fires after the generation moved")
  }
}
