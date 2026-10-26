package dev.poolse.callcore

/**
 * The call state machine — contract cv 1, CALL_CONTRACT.md §7.
 *
 * Pure: no I/O, no platform, no time. Events in, (state, effects) out.
 * The adapters execute effects; the machine only decides. Its behavior
 * is pinned by contracts/call-core/vectors.json, which the conformance
 * test runs verbatim — change the vectors first, then this file.
 *
 * Lifecycle authority is the SERVER's (LiveKit-counted). This machine
 * never counts participants to decide whether a call should end; it
 * reacts to `RING_ENDED` and `CALL_FINISHED` and reports what the user
 * did.
 */

enum class Phase { IDLE, RINGING_IN, RINGING_OUT, CONNECTING, ACTIVE, RECONNECTING, ENDED }

enum class Direction { INCOMING, OUTGOING, JOINED }

enum class EndReason {
  LEFT, FINISHED, DECLINED_ALL, BUSY_ALL, NO_ANSWER, CANCELLED, CONNECTION_LOST, FAILED;

  val wire: String get() = name.lowercase()
}

/**
 * A second call ringing while this device is on one (CALL_CONTRACT.md §7,
 * call waiting): shown beside the current call, never instead of it.
 */
data class WaitingCall(
  val callId: String,
  val conversationId: String?,
  val media: String,
)

/** Everything the machine knows. Immutable; transitions return a new one. */
data class MachineState(
  val phase: Phase = Phase.IDLE,
  val callId: String? = null,
  val conversationId: String? = null,
  val direction: Direction? = null,
  val media: String = "audio",
  val reason: EndReason? = null,
  /** HTTP attempts made for the current connecting request (retry budget = 2). */
  val httpAttempts: Int = 0,
  /** A second call ringing beside this one, if any. */
  val waiting: WaitingCall? = null,
) {
  companion object { val IDLE = MachineState() }
}

/** Inputs, named exactly as in the contract and vectors. */
sealed interface Event {
  /** A ring from push or socket — the machine treats them identically. */
  data class Ring(
    val callId: String,
    val conversationId: String? = null,
    val media: String = "audio",
    /** Deadline already passed, or registry already finished. Never surface. */
    val stale: Boolean = false,
  ) : Event

  data class RingEnded(val callId: String, val reason: String) : Event
  /**
   * The server finished the call. [reason] is the push's own reason
   * (`finished`, `declined_all`, `no_answer`, `cancelled`); it only
   * colours the caller's ended screen when the call never got answered.
   */
  data class CallFinished(val callId: String, val reason: String? = null) : Event

  data object UserAnswer : Event
  data object UserDecline : Event
  data class UserPlace(val callId: String, val conversationId: String? = null, val media: String = "audio") : Event
  data class UserJoin(val callId: String, val conversationId: String? = null) : Event
  data object UserHangup : Event

  /** Server accepted answer/join/place. `created=false` on place means an existing live call (it became a join). */
  data class HttpOk(val created: Boolean = true) : Event
  data object HttpGone : Event
  data object HttpTimeout : Event
  /**
   * Terminal refusal that is NOT "the call is over": 401/403 (grant
   * spent, wrong device), 503, or an unparseable 2xx. Ends as `failed`,
   * never as `finished`, so the UI does not claim the other side hung up.
   */
  data class HttpFailed(val code: String = "failed") : Event

  data object MediaConnected : Event
  data object MediaFailed : Event
  data object MediaLost : Event
  /** The SFU is recovering the session on its own (ICE restart, resume). Show it; do not rejoin. */
  data object MediaReconnecting : Event
  data object MediaRecovered : Event
  data object RemoteJoined : Event

  /** Caller side: every ring resolved without anyone joining. */
  data class AllRingsResolved(val outcome: String) : Event

  data object RingDeadline : Event
  data object ReconnectBudgetElapsed : Event
  /** CONNECTING watchdog: neither the server nor the SFU got us in. */
  data object ConnectTimeout : Event
  data object LingerElapsed : Event

  /** Call waiting: leave the current call and answer the waiting one. */
  data object UserAnswerWaiting : Event
  /** Call waiting: turn the waiting call away — its caller hears busy. */
  data object UserDeclineWaiting : Event
  /** The waiting call's ring deadline passed. */
  data object WaitingDeadline : Event
}

/** Abstract effects — each adapter maps them to its platform. */
sealed interface Effect {
  val wire: String

  data object ShowRing : Effect { override val wire = "SHOW_RING" }
  data object DismissRing : Effect { override val wire = "DISMISS_RING" }
  data object RingtoneStart : Effect { override val wire = "RINGTONE_START" }
  data object RingtoneStop : Effect { override val wire = "RINGTONE_STOP" }
  data object RingbackStart : Effect { override val wire = "RINGBACK_START" }
  data object RingbackStop : Effect { override val wire = "RINGBACK_STOP" }
  data object HttpAnswer : Effect { override val wire = "HTTP_ANSWER" }
  data object HttpJoin : Effect { override val wire = "HTTP_JOIN" }
  data object HttpPlace : Effect { override val wire = "HTTP_PLACE" }
  data object HttpDecline : Effect { override val wire = "HTTP_DECLINE" }
  data class HttpDeclineBusy(val callId: String) : Effect { override val wire = "HTTP_DECLINE_BUSY:$callId" }
  data object HttpHangup : Effect { override val wire = "HTTP_HANGUP" }
  data object HttpReconnect : Effect { override val wire = "HTTP_RECONNECT" }
  data object MediaJoin : Effect { override val wire = "MEDIA_JOIN" }
  data object MediaLeave : Effect { override val wire = "MEDIA_LEAVE" }
  data object CallSessionStart : Effect { override val wire = "CALL_SESSION_START" }
  data object CallSessionStop : Effect { override val wire = "CALL_SESSION_STOP" }
  data object ShowWaiting : Effect { override val wire = "SHOW_WAITING" }
  data object DismissWaiting : Effect { override val wire = "DISMISS_WAITING" }
  /**
   * The waiting call becomes the current one: retire the old call's
   * grant/bundle/generation and take the waiting ring's.
   */
  data object PromoteWaiting : Effect { override val wire = "PROMOTE_WAITING" }
}

data class Transition(val state: MachineState, val effects: List<Effect>)

object CallMachine {

  /**
   * Phases that can hold a call waiting beside them: this device is on
   * (or placing, or joining) a call. A second ring while one is ringING
   * in is still busy — two rings at once is not a choice anyone can make.
   */
  private fun canHoldWaiting(s: MachineState) = when (s.phase) {
    Phase.RINGING_OUT, Phase.CONNECTING, Phase.ACTIVE, Phase.RECONNECTING -> true
    else -> false
  }

  /**
   * The ring surface effects the end-and-answer composite skips: the
   * waiting call goes straight from waiting to connecting, never ringing.
   */
  private val ringSurfaceEffects =
    setOf<Effect>(Effect.ShowRing, Effect.RingtoneStart, Effect.RingtoneStop, Effect.DismissRing)

  fun transition(s: MachineState, e: Event): Transition {
    val w = s.waiting
    if (w == null) {
      return when {
        e is Event.Ring && !e.stale && canHoldWaiting(s) && e.callId != s.callId -> Transition(
          s.copy(waiting = WaitingCall(e.callId, e.conversationId, e.media)),
          listOf(Effect.ShowWaiting),
        )
        e == Event.UserAnswerWaiting || e == Event.UserDeclineWaiting || e == Event.WaitingDeadline -> noop(s)
        else -> single(s, e)
      }
    }

    val cleared = s.copy(waiting = null)
    return when {
      e is Event.Ring -> when (e.callId) {
        w.callId -> noop(s)
        s.callId -> carry(single(cleared, e), w)
        else -> if (e.stale) noop(s) else Transition(s, listOf(Effect.HttpDeclineBusy(e.callId)))
      }
      e is Event.RingEnded && e.callId == w.callId -> Transition(cleared, listOf(Effect.DismissWaiting))
      e is Event.CallFinished && e.callId == w.callId -> Transition(cleared, listOf(Effect.DismissWaiting))
      e == Event.WaitingDeadline -> Transition(cleared, listOf(Effect.DismissWaiting))
      e == Event.UserDeclineWaiting ->
        Transition(cleared, listOf(Effect.HttpDeclineBusy(w.callId), Effect.DismissWaiting))
      e == Event.UserAnswerWaiting -> {
        // Leaving rings the waiting call (below); answering it at once
        // makes that ring a no-op the surface never sees.
        val left = transition(s, Event.UserHangup)
        if (left.state.phase != Phase.RINGING_IN || left.state.callId != w.callId) {
          noop(s)
        } else {
          val answered = single(left.state, Event.UserAnswer)
          Transition(answered.state, (left.effects + answered.effects).filterNot { it in ringSurfaceEffects })
        }
      }
      else -> {
        val t = single(cleared, e)
        if (t.state.phase != Phase.ENDED && t.state.phase != Phase.IDLE) {
          carry(t, w)
        } else {
          // The current call is over while another rings beside it: that
          // ring is now simply THE ring (no ended screen in between).
          Transition(
            MachineState(
              phase = Phase.RINGING_IN, callId = w.callId, conversationId = w.conversationId,
              direction = Direction.INCOMING, media = w.media,
            ),
            t.effects + listOf(Effect.PromoteWaiting, Effect.ShowRing, Effect.RingtoneStart),
          )
        }
      }
    }
  }

  private fun carry(t: Transition, w: WaitingCall) = Transition(t.state.copy(waiting = w), t.effects)

  /** The one-call machine: everything that is not about a waiting call. */
  private fun single(s: MachineState, e: Event): Transition = when (e) {

    is Event.Ring -> ring(s, e)

    is Event.RingEnded ->
      if (s.phase == Phase.RINGING_IN && e.callId == s.callId) {
        Transition(MachineState.IDLE, listOf(Effect.RingtoneStop, Effect.DismissRing))
      } else noop(s)

    is Event.CallFinished ->
      if (e.callId == s.callId) when (s.phase) {
        // The finish push can overtake (or replace) ring_ended: a ring
        // for a finished call is over either way.
        Phase.RINGING_IN -> Transition(MachineState.IDLE, listOf(Effect.RingtoneStop, Effect.DismissRing))
        // Caller still ringing out: nobody ever joined, so the push's
        // reason (no_answer / declined_all / cancelled) is the truth the
        // ended screen should show. The server already finished the call
        // — no hangup to send.
        Phase.RINGING_OUT -> Transition(
          s.copy(phase = Phase.ENDED, reason = ringOutcome(e.reason)),
          listOf(Effect.RingbackStop, Effect.MediaLeave, Effect.CallSessionStop),
        )
        Phase.ACTIVE, Phase.RECONNECTING -> Transition(
          s.copy(phase = Phase.ENDED, reason = EndReason.FINISHED),
          listOf(Effect.MediaLeave, Effect.CallSessionStop),
        )
        // CONNECTING may already have joined media (HTTP_OK came back):
        // leave it, or the room outlives the call.
        Phase.CONNECTING -> Transition(
          s.copy(phase = Phase.ENDED, reason = EndReason.FINISHED),
          listOf(Effect.MediaLeave, Effect.CallSessionStop),
        )
        // Lingering "ended": a later finish with a real outcome (the FCM
        // push after a reason-less socket event, or vice versa) corrects
        // an unanswered outgoing call's generic "finished" to what
        // actually happened. Display only — nothing left to tear down.
        Phase.ENDED -> {
          val outcome = ringOutcome(e.reason)
          if (s.direction == Direction.OUTGOING && s.reason == EndReason.FINISHED &&
            outcome != EndReason.FINISHED
          ) Transition(s.copy(reason = outcome), emptyList()) else noop(s)
        }
        else -> noop(s)
      } else noop(s)

    Event.UserAnswer ->
      if (s.phase == Phase.RINGING_IN) Transition(
        s.copy(phase = Phase.CONNECTING, direction = Direction.INCOMING, httpAttempts = 1),
        listOf(Effect.RingtoneStop, Effect.DismissRing, Effect.HttpAnswer, Effect.CallSessionStart),
      ) else noop(s)

    Event.UserDecline ->
      if (s.phase == Phase.RINGING_IN) Transition(
        MachineState.IDLE,
        listOf(Effect.RingtoneStop, Effect.DismissRing, Effect.HttpDecline),
      ) else noop(s)

    is Event.UserPlace ->
      if (s.phase == Phase.IDLE || s.phase == Phase.ENDED) Transition(
        MachineState(
          phase = Phase.CONNECTING, callId = e.callId, conversationId = e.conversationId,
          direction = Direction.OUTGOING, media = e.media, httpAttempts = 1,
        ),
        listOf(Effect.HttpPlace, Effect.CallSessionStart),
      ) else noop(s)

    is Event.UserJoin ->
      if (s.phase == Phase.IDLE || s.phase == Phase.ENDED) Transition(
        MachineState(
          phase = Phase.CONNECTING, callId = e.callId, conversationId = e.conversationId,
          direction = Direction.JOINED, httpAttempts = 1,
        ),
        listOf(Effect.HttpJoin, Effect.CallSessionStart),
      ) else noop(s)

    Event.UserHangup -> when (s.phase) {
      Phase.RINGING_OUT -> Transition(
        s.copy(phase = Phase.ENDED, reason = EndReason.CANCELLED),
        listOf(Effect.RingbackStop, Effect.MediaLeave, Effect.HttpHangup, Effect.CallSessionStop),
      )
      Phase.ACTIVE, Phase.RECONNECTING, Phase.CONNECTING -> Transition(
        s.copy(phase = Phase.ENDED, reason = EndReason.LEFT),
        listOf(Effect.MediaLeave, Effect.HttpHangup, Effect.CallSessionStop),
      )
      else -> noop(s)
    }

    is Event.HttpOk -> when {
      s.phase != Phase.CONNECTING -> noop(s)
      s.direction == Direction.OUTGOING && e.created -> Transition(
        s.copy(phase = Phase.RINGING_OUT),
        listOf(Effect.MediaJoin, Effect.RingbackStart),
      )
      s.direction == Direction.OUTGOING && !e.created -> Transition(
        // Somebody's call was already live: our place collapsed into a join.
        s.copy(direction = Direction.JOINED),
        listOf(Effect.MediaJoin),
      )
      else -> Transition(s, listOf(Effect.MediaJoin))
    }

    Event.HttpGone -> when (s.phase) {
      Phase.CONNECTING -> Transition(
        s.copy(phase = Phase.ENDED, reason = EndReason.FINISHED),
        listOf(Effect.CallSessionStop),
      )
      Phase.RECONNECTING -> Transition(
        // Finished — or this device was superseded by the same user
        // joining elsewhere. Either way: we are no longer in it.
        s.copy(phase = Phase.ENDED, reason = EndReason.LEFT),
        listOf(Effect.MediaLeave, Effect.CallSessionStop),
      )
      else -> noop(s)
    }

    Event.HttpTimeout -> when {
      s.phase != Phase.CONNECTING -> noop(s)
      s.httpAttempts < 2 -> Transition(
        s.copy(httpAttempts = s.httpAttempts + 1),
        listOf(
          when (s.direction) {
            Direction.OUTGOING -> Effect.HttpPlace
            Direction.JOINED -> Effect.HttpJoin
            else -> Effect.HttpAnswer
          },
        ),
      )
      // Out of retries. A timeout only ever answers the CONNECTING
      // request, so there is no bundle and media can never join:
      // waiting on it was the "stuck in connecting forever" bug.
      else -> Transition(
        s.copy(phase = Phase.ENDED, reason = EndReason.FAILED),
        listOf(Effect.HttpHangup, Effect.CallSessionStop),
      )
    }

    is Event.HttpFailed -> when (s.phase) {
      // HTTP_HANGUP still runs: with no bundle it resolves the ring
      // grant, so an incoming caller is not left ringing a dead answer.
      Phase.CONNECTING -> Transition(
        s.copy(phase = Phase.ENDED, reason = EndReason.FAILED),
        listOf(Effect.HttpHangup, Effect.CallSessionStop),
      )
      // Reconnect refused for auth: the control token is dead, so a
      // hangup with it would be refused too — just leave.
      Phase.RECONNECTING -> Transition(
        s.copy(phase = Phase.ENDED, reason = EndReason.FAILED),
        listOf(Effect.MediaLeave, Effect.CallSessionStop),
      )
      else -> noop(s)
    }

    Event.ConnectTimeout ->
      if (s.phase == Phase.CONNECTING) Transition(
        s.copy(phase = Phase.ENDED, reason = EndReason.FAILED),
        listOf(Effect.MediaLeave, Effect.HttpHangup, Effect.CallSessionStop),
      ) else noop(s)

    Event.MediaConnected -> when (s.phase) {
      Phase.CONNECTING -> Transition(s.copy(phase = Phase.ACTIVE), emptyList())
      // A rejoin after /reconnect lands as a fresh connect.
      Phase.RECONNECTING -> Transition(s.copy(phase = Phase.ACTIVE), emptyList())
      else -> noop(s) // ringing_out keeps ringing until a remote joins
    }

    Event.MediaFailed -> when (s.phase) {
      Phase.CONNECTING -> Transition(
        s.copy(phase = Phase.ENDED, reason = EndReason.FAILED),
        listOf(Effect.HttpHangup, Effect.CallSessionStop),
      )
      // The caller's own media never came up: the callees would answer
      // into an empty room. Give up and tell the server.
      Phase.RINGING_OUT -> Transition(
        s.copy(phase = Phase.ENDED, reason = EndReason.FAILED),
        listOf(Effect.RingbackStop, Effect.MediaLeave, Effect.HttpHangup, Effect.CallSessionStop),
      )
      else -> noop(s) // reconnecting: the budget timer is the backstop
    }

    // Lost = the SFU gave up (unexpected disconnect). Ask the server for
    // a fresh token and rejoin — also from RECONNECTING, where the SFU's
    // own recovery just failed.
    Event.MediaLost -> when (s.phase) {
      Phase.ACTIVE -> Transition(s.copy(phase = Phase.RECONNECTING), listOf(Effect.HttpReconnect))
      Phase.RECONNECTING -> Transition(s, listOf(Effect.HttpReconnect))
      else -> noop(s)
    }

    // The SFU is resuming the same session itself: only reflect it.
    // Tearing the room down here fought LiveKit's own recovery.
    Event.MediaReconnecting ->
      if (s.phase == Phase.ACTIVE) Transition(s.copy(phase = Phase.RECONNECTING), emptyList())
      else noop(s)

    Event.MediaRecovered ->
      if (s.phase == Phase.RECONNECTING) Transition(s.copy(phase = Phase.ACTIVE), emptyList())
      else noop(s)

    Event.RemoteJoined ->
      if (s.phase == Phase.RINGING_OUT) Transition(
        s.copy(phase = Phase.ACTIVE),
        listOf(Effect.RingbackStop),
      ) else noop(s)

    is Event.AllRingsResolved ->
      if (s.phase == Phase.RINGING_OUT) Transition(
        s.copy(
          phase = Phase.ENDED,
          reason = when (e.outcome) {
            "busy_all" -> EndReason.BUSY_ALL
            "no_answer" -> EndReason.NO_ANSWER
            "cancelled" -> EndReason.CANCELLED
            else -> EndReason.DECLINED_ALL
          },
        ),
        listOf(Effect.RingbackStop, Effect.MediaLeave, Effect.HttpHangup, Effect.CallSessionStop),
      ) else noop(s)

    Event.RingDeadline ->
      if (s.phase == Phase.RINGING_IN) Transition(
        MachineState.IDLE,
        listOf(Effect.RingtoneStop, Effect.DismissRing),
      ) else noop(s)

    Event.ReconnectBudgetElapsed ->
      if (s.phase == Phase.RECONNECTING) Transition(
        s.copy(phase = Phase.ENDED, reason = EndReason.CONNECTION_LOST),
        listOf(Effect.MediaLeave, Effect.HttpHangup, Effect.CallSessionStop),
      ) else noop(s)

    Event.LingerElapsed ->
      if (s.phase == Phase.ENDED) Transition(MachineState.IDLE, emptyList()) else noop(s)

    // Handled by `transition`, which owns the waiting slot.
    Event.UserAnswerWaiting, Event.UserDeclineWaiting, Event.WaitingDeadline -> noop(s)
  }

  private fun ring(s: MachineState, e: Event.Ring): Transition = when {
    e.stale -> noop(s)

    // Already showing this very ring (push + socket race): one surface.
    s.phase == Phase.RINGING_IN && e.callId == s.callId -> noop(s)

    // A fresh ring lands on idle — or over a lingering ended screen,
    // which the new call simply replaces.
    s.phase == Phase.IDLE || s.phase == Phase.ENDED -> Transition(
      MachineState(
        phase = Phase.RINGING_IN, callId = e.callId,
        conversationId = e.conversationId, direction = Direction.INCOMING, media = e.media,
      ),
      listOf(Effect.ShowRing, Effect.RingtoneStart),
    )

    // Busy ringing another call (a call in progress holds it waiting
    // instead — see `transition`): auto-decline the newcomer, whose
    // banner still offers Join later. (Contract §7, scenario s9.)
    else -> Transition(s, listOf(Effect.HttpDeclineBusy(e.callId)))
  }

  /** A finish push's reason, read as the caller's unanswered outcome. */
  private fun ringOutcome(reason: String?): EndReason = when (reason) {
    "no_answer", "timeout" -> EndReason.NO_ANSWER
    "declined_all", "declined" -> EndReason.DECLINED_ALL
    "busy_all" -> EndReason.BUSY_ALL
    "cancelled" -> EndReason.CANCELLED
    else -> EndReason.FINISHED
  }

  private fun noop(s: MachineState) = Transition(s, emptyList())
}
