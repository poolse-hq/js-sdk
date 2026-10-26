package dev.poolse.callcore.android

import dev.poolse.callcore.Direction
import dev.poolse.callcore.MachineState
import dev.poolse.callcore.Phase

/**
 * The one place a [MachineState] becomes the contract's `Snapshot`
 * (CALL_CONTRACT.md §8). Both the Android bridge and — mirrored — the JS
 * machine produce this exact shape, so a UI reads identically wherever
 * it runs. Returns `null` for idle: the bridge maps that to a cleared
 * call state.
 *
 * The participant roster is merged in by the bridge from the media
 * adapter's reports; the machine itself does not carry it.
 */
internal fun MachineState.toSnapshot(
  conversationName: String? = null,
  kind: String = "call",
  participants: List<Map<String, Any>> = emptyList(),
  audioRoute: String = "earpiece",
  audioOutputs: List<Map<String, Any>> = emptyList(),
  audioOutputId: String? = null,
  mutedSelf: Boolean = false,
  cameraOn: Boolean = false,
  cameraFacing: String? = null,
  /** The waiting call's ring (names); the machine's [MachineState.waiting] says whether there is one. */
  waitingRing: dev.poolse.callcore.RingContext? = null,
  /** Our own link to the SFU: `good` | `poor` | `lost` | `unknown`. */
  connectionQuality: String = "unknown",
  /** Incoming video switched off to keep the audio going. */
  videoPaused: Boolean = false,
): Map<String, Any?>? {
  if (phase == Phase.IDLE) return null
  return buildMap {
    putAll(snapshotCore(conversationName, participants, audioRoute, mutedSelf, cameraOn))
    put("kind", kind)
    put("connectionQuality", connectionQuality)
    put("videoPaused", videoPaused)
    put("audioOutputs", audioOutputs)
    put("audioOutputId", audioOutputId)
    // Optional in the contract: present only while a camera is published.
    if (cameraFacing != null) put("cameraFacing", cameraFacing)
    // The call waiting beside this one: null when none.
    put(
      "waiting",
      waiting?.let { w ->
        mapOf(
          "callId" to w.callId,
          "conversationId" to (waitingRing?.conversationId ?: w.conversationId),
          "conversationName" to waitingRing?.conversationName,
          "callerName" to waitingRing?.callerName,
          "media" to w.media,
        )
      },
    )
  }
}

private fun MachineState.snapshotCore(
  conversationName: String?,
  participants: List<Map<String, Any>>,
  audioRoute: String,
  mutedSelf: Boolean,
  cameraOn: Boolean,
): Map<String, Any?> {
  return mapOf(
    "cv" to 1,
    "callId" to callId,
    "conversationId" to conversationId,
    "conversationName" to conversationName,
    "direction" to (direction?.wire ?: Direction.INCOMING.wire),
    "media" to media,
    "phase" to phase.wire,
    "reason" to reason?.wire,
    "participants" to participants,
    "audioRoute" to audioRoute,
    "mutedSelf" to mutedSelf,
    "cameraOn" to cameraOn,
  )
}

private val Phase.wire: String
  get() = when (this) {
    Phase.IDLE -> "idle"
    Phase.RINGING_IN -> "ringing_in"
    Phase.RINGING_OUT -> "ringing_out"
    Phase.CONNECTING -> "connecting"
    Phase.ACTIVE -> "active"
    Phase.RECONNECTING -> "reconnecting"
    Phase.ENDED -> "ended"
  }

private val Direction.wire: String
  get() = when (this) {
    Direction.INCOMING -> "incoming"
    Direction.OUTGOING -> "outgoing"
    Direction.JOINED -> "joined"
  }
