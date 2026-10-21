package dev.poolse.callcore

import com.google.gson.Gson
import com.google.gson.JsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.fail

/**
 * Runs every vector from contracts/call-core/vectors.json against the
 * machine. The vectors are the contract; a red test here means either
 * the machine or the contract must change — never "adjust the test".
 */
class ConformanceTest {

  @Test
  fun `machine conforms to the contract vectors`() {
    val path = System.getProperty("poolse.vectors")
      ?: fail("poolse.vectors system property not set")
    val root = Gson().fromJson(File(path).readText(), JsonObject::class.java)
    val vectors = root.getAsJsonArray("vectors")
    val failures = mutableListOf<String>()

    for (element in vectors) {
      val v = element.asJsonObject
      val name = v["name"].asString
      val given = v.getAsJsonObject("given")
      val event = v.getAsJsonObject("event")
      val expect = v.getAsJsonObject("expect")

      val result = CallMachine.transition(parseState(given), parseEvent(event, given))
      val problems = diff(expect, result)
      if (problems.isNotEmpty()) {
        failures += "✗ $name\n   ${problems.joinToString("\n   ")}"
      }
    }

    if (failures.isNotEmpty()) {
      fail("${failures.size}/${vectors.size()} vectors failed:\n" + failures.joinToString("\n"))
    }
  }

  private fun parseState(g: JsonObject): MachineState {
    val phase = phaseOf(g["phase"].asString)
    if (phase == Phase.IDLE) return MachineState.IDLE
    return MachineState(
      phase = phase,
      callId = g["callId"]?.asString ?: "c1",
      direction = g["direction"]?.asString?.let { Direction.valueOf(it.uppercase()) },
      httpAttempts = g["httpAttempts"]?.asInt ?: 1,
      reason = g["reason"]?.asString?.let { w -> EndReason.entries.first { it.wire == w } },
      waiting = g["waitingCallId"]?.takeIf { !it.isJsonNull }?.asString?.let { WaitingCall(it, null, "audio") },
    )
  }

  private fun parseEvent(e: JsonObject, g: JsonObject): Event {
    val callId = { e["callId"]?.asString ?: g["callId"]?.asString ?: "c1" }
    return when (val type = e["type"].asString) {
      "PUSH_RING", "SOCKET_RING" -> Event.Ring(
        callId = callId(),
        media = e["media"]?.asString ?: "audio",
        stale = e["stale"]?.asBoolean ?: false,
      )
      "RING_ENDED" -> Event.RingEnded(callId(), e["reason"].asString)
      "CALL_FINISHED" -> Event.CallFinished(callId(), e["reason"]?.asString)
      "USER_ANSWER" -> Event.UserAnswer
      "USER_DECLINE" -> Event.UserDecline
      "USER_PLACE" -> Event.UserPlace(callId(), media = e["media"]?.asString ?: "audio")
      "USER_JOIN" -> Event.UserJoin(callId())
      "USER_HANGUP" -> Event.UserHangup
      "HTTP_OK" -> Event.HttpOk(created = e["created"]?.asBoolean ?: true)
      "HTTP_GONE" -> Event.HttpGone
      "HTTP_TIMEOUT" -> Event.HttpTimeout
      "HTTP_FAILED" -> Event.HttpFailed(e["code"]?.asString ?: "failed")
      "MEDIA_CONNECTED" -> Event.MediaConnected
      "MEDIA_FAILED" -> Event.MediaFailed
      "MEDIA_LOST" -> Event.MediaLost
      "MEDIA_RECONNECTING" -> Event.MediaReconnecting
      "MEDIA_RECOVERED" -> Event.MediaRecovered
      "REMOTE_JOINED" -> Event.RemoteJoined
      "ALL_RINGS_RESOLVED" -> Event.AllRingsResolved(e["outcome"].asString)
      "RING_DEADLINE" -> Event.RingDeadline
      "RECONNECT_BUDGET_ELAPSED" -> Event.ReconnectBudgetElapsed
      "LINGER_ELAPSED" -> Event.LingerElapsed
      "CONNECT_TIMEOUT" -> Event.ConnectTimeout
      "USER_ANSWER_WAITING" -> Event.UserAnswerWaiting
      "USER_DECLINE_WAITING" -> Event.UserDeclineWaiting
      "WAITING_DEADLINE" -> Event.WaitingDeadline
      else -> fail("unknown event type: $type")
    }
  }

  private fun diff(expect: JsonObject, actual: Transition): List<String> {
    val problems = mutableListOf<String>()

    val wantPhase = phaseOf(expect["phase"].asString)
    if (actual.state.phase != wantPhase) {
      problems += "phase: expected $wantPhase, got ${actual.state.phase}"
    }
    expect["reason"]?.asString?.let { want ->
      if (actual.state.reason?.wire != want) {
        problems += "reason: expected $want, got ${actual.state.reason?.wire}"
      }
    }
    expect["callId"]?.asString?.let { want ->
      if (actual.state.callId != want) {
        problems += "callId: expected $want, got ${actual.state.callId}"
      }
    }
    expect["direction"]?.asString?.let { want ->
      if (actual.state.direction?.name?.lowercase() != want) {
        problems += "direction: expected $want, got ${actual.state.direction}"
      }
    }

    if (expect.has("waitingCallId")) {
      val want = expect["waitingCallId"].takeIf { !it.isJsonNull }?.asString // null: none waiting
      if (actual.state.waiting?.callId != want) {
        problems += "waitingCallId: expected $want, got ${actual.state.waiting?.callId}"
      }
    }

    val wantEffects = expect.getAsJsonArray("effects").map { it.asString }
    val gotEffects = actual.effects.map { it.wire }
    if (wantEffects != gotEffects) {
      problems += "effects: expected $wantEffects, got $gotEffects"
    }
    return problems
  }

  private fun phaseOf(wire: String): Phase = Phase.valueOf(wire.uppercase())
}
