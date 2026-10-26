package dev.poolse.callcore.android

import android.os.Bundle
import dev.poolse.callcore.RingContext

/**
 * [RingContext] ⇄ [Bundle]. A ring crosses process boundaries as
 * PendingIntent extras (the notification lives on even when our process
 * is dead), so it must round-trip through a Bundle losslessly.
 */
internal fun RingContext.toBundle(): Bundle = Bundle().apply {
  putString(K_CALL_ID, callId)
  putString(K_CONVERSATION_ID, conversationId)
  putString(K_CONVERSATION_NAME, conversationName)
  putString(K_CALLER_NAME, callerName)
  putString(K_MEDIA, media)
  putString(K_GRANT, grant)
  putLong(K_DEADLINE, ringDeadlineEpochMs)
}

internal fun Bundle.toRingContext(): RingContext? {
  val callId = getString(K_CALL_ID) ?: return null
  val conversationId = getString(K_CONVERSATION_ID) ?: return null
  val grant = getString(K_GRANT) ?: return null
  return RingContext(
    callId = callId,
    conversationId = conversationId,
    conversationName = getString(K_CONVERSATION_NAME),
    callerName = getString(K_CALLER_NAME),
    media = getString(K_MEDIA) ?: "audio",
    grant = grant,
    ringDeadlineEpochMs = getLong(K_DEADLINE),
  )
}

private const val K_CALL_ID = "callId"
private const val K_CONVERSATION_ID = "conversationId"
private const val K_CONVERSATION_NAME = "conversationName"
private const val K_CALLER_NAME = "callerName"
private const val K_MEDIA = "media"
private const val K_GRANT = "grant"
private const val K_DEADLINE = "ringDeadline"
