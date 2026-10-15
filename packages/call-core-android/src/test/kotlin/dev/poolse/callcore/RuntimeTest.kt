package dev.poolse.callcore

import kotlin.test.Test
import kotlin.test.assertEquals
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
    var lastReconnectCb: ((HttpResult) -> Unit)? = null

    override fun answer(callId: String, grant: String, cb: (HttpResult) -> Unit) {
      log += "answer:$callId:$grant"; lastCb = cb
    }
    override fun join(callId: String, sessionToken: String, cb: (HttpResult) -> Unit) {
      log += "join:$callId:$sessionToken"; lastCb = cb
    }
    override fun place(conversationId: String, media: String, sessionToken: String, cb: (HttpResult) -> Unit) {
      log += "place:$conversationId:$media:$sessionToken"; lastCb = cb
    }
    override fun decline(callId: String, auth: String, busy: Boolean) {
      log += "decline:$callId:$auth:busy=$busy"
    }
    override fun hangup(callId: String, controlToken: String) {
      log += "hangup:$callId:$controlToken"
    }
    override fun reconnect(callId: String, controlToken: String, cb: (HttpResult) -> Unit) {
      log += "reconnect:$callId:$controlToken"; lastReconnectCb = cb
    }
  }

  private class FakeMedia : MediaPort {
    val log = mutableListOf<String>()
    override fun join(bundle: CallSessionBundle) { log += "join:${bundle.callId}:${bundle.livekitToken}" }
    override fun leave() { log += "leave" }
    override fun setMuted(muted: Boolean) { log += "muted:$muted" }
    override fun setCamera(on: Boolean) { log += "camera:$on" }
    override fun switchCamera() { log += "switch" }
  }

  private class FakeSurface : RingSurfacePort {
    val log = mutableListOf<String>()
    override fun show(ring: RingContext) { log += "show:${ring.callId}" }
    override fun dismiss(callId: String) { log += "dismiss:$callId" }
    override fun ringtoneStart() { log += "ringtone+" }
    override fun ringtoneStop() { log += "ringtone-" }
    override fun ringbackStart() { log += "ringback+" }
    override fun ringbackStop() { log += "ringback-" }
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
    override fun emit(state: MachineState) { phases += state.phase }
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
    r.runtime.onRing(ring(deadlineIn = -1))
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
}
