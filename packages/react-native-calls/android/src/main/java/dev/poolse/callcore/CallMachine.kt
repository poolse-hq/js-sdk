package dev.poolse.callcore

/**
 * The call state machine — contract cv 1, CONTRACT.md §7.
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
  data class CallFinished(val callId: String) : Event

  data object UserAnswer : Event
  data object UserDecline : Event
  data class UserPlace(val callId: String, val conversationId: String? = null, val media: String = "audio") : Event
  data class UserJoin(val callId: String, val conversationId: String? = null) : Event
  data object UserHangup : Event

  /** Server accepted answer/join/place. `created=false` on place means an existing live call (it became a join). */
  data class HttpOk(val created: Boolean = true) : Event
  data object HttpGone : Event
  data object HttpTimeout : Event

  data object MediaConnected : Event
  data object MediaFailed : Event
  data object MediaLost : Event
  data object MediaRecovered : Event
  data object RemoteJoined : Event

  /** Caller side: every ring resolved without anyone joining. */
  data class AllRingsResolved(val outcome: String) : Event

  data object RingDeadline : Event
  data object ReconnectBudgetElapsed : Event
  data object LingerElapsed : Event
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
}

data class Transition(val state: MachineState, val effects: List<Effect>)

object CallMachine {

  fun transition(s: MachineState, e: Event): Transition = when (e) {

    is Event.Ring -> ring(s, e)

    is Event.RingEnded ->
      if (s.phase == Phase.RINGING_IN && e.callId == s.callId) {
        Transition(MachineState.IDLE, listOf(Effect.RingtoneStop, Effect.DismissRing))
      } else noop(s)

    is Event.CallFinished ->
      if (e.callId == s.callId) when (s.phase) {
        Phase.ACTIVE, Phase.RECONNECTING, Phase.RINGING_OUT -> Transition(
          s.copy(phase = Phase.ENDED, reason = EndReason.FINISHED),
          buildList {
            if (s.phase == Phase.RINGING_OUT) add(Effect.RingbackStop)
            add(Effect.MediaLeave); add(Effect.CallSessionStop)
          },
        )
        Phase.CONNECTING -> Transition(
          s.copy(phase = Phase.ENDED, reason = EndReason.FINISHED),
          listOf(Effect.CallSessionStop),
        )
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

    Event.HttpTimeout ->
      if (s.phase == Phase.CONNECTING && s.httpAttempts < 2) Transition(
        s.copy(httpAttempts = s.httpAttempts + 1),
        listOf(
          when (s.direction) {
            Direction.OUTGOING -> Effect.HttpPlace
            Direction.JOINED -> Effect.HttpJoin
            else -> Effect.HttpAnswer
          },
        ),
      ) else noop(s) // out of retries: media join (or its absence) decides

    Event.MediaConnected -> when (s.phase) {
      Phase.CONNECTING -> Transition(s.copy(phase = Phase.ACTIVE), emptyList())
      else -> noop(s) // ringing_out keeps ringing until a remote joins
    }

    Event.MediaFailed ->
      if (s.phase == Phase.CONNECTING) Transition(
        s.copy(phase = Phase.ENDED, reason = EndReason.FAILED),
        listOf(Effect.HttpHangup, Effect.CallSessionStop),
      ) else noop(s)

    Event.MediaLost ->
      if (s.phase == Phase.ACTIVE) Transition(
        s.copy(phase = Phase.RECONNECTING),
        listOf(Effect.HttpReconnect),
      ) else noop(s)

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

    // Busy with another call, in any phase: auto-decline the newcomer,
    // whose banner still offers Join later. (Contract §7, scenario s9.)
    else -> Transition(s, listOf(Effect.HttpDeclineBusy(e.callId)))
  }

  private fun noop(s: MachineState) = Transition(s, emptyList())
}
