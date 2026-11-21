package dev.poolse.callcore.android

import android.app.Activity
import android.content.Context
import android.content.Intent
import dev.poolse.callcore.RingContext

/**
 * For an app that replaces the built-in full-screen ring with its own
 * activity (`incomingCall.activity`). That activity is launched by the
 * ring notification's full-screen intent and heads-up tap with these
 * extras, and answers or declines through the functions below — the same
 * single entry point the built-in screen and the notification use.
 *
 * ```kotlin
 * class RingActivity : Activity() {
 *   private var answered = false
 *   private val closed = object : BroadcastReceiver() {
 *     override fun onReceive(c: Context, i: Intent) {
 *       if (!answered && i.getStringExtra(PoolseIncomingCall.EXTRA_CALL_ID) ==
 *         intent.getStringExtra(PoolseIncomingCall.EXTRA_CALL_ID)) finish()
 *     }
 *   }
 *   override fun onCreate(b: Bundle?) {
 *     super.onCreate(b)
 *     setShowWhenLocked(true); setTurnScreenOn(true)
 *     if (!PoolseIncomingCall.isLive(this, intent)) return finish()
 *     ContextCompat.registerReceiver(this, closed,
 *       IntentFilter(PoolseIncomingCall.ACTION_RING_CLOSED), ContextCompat.RECEIVER_NOT_EXPORTED)
 *     // … draw it from the EXTRA_* values …
 *     answerButton.setOnClickListener {
 *       answered = PoolseIncomingCall.answer(this, intent)
 *       if (!answered) finish()  // else finish in onStop, once the app is in front
 *     }
 *     declineButton.setOnClickListener { PoolseIncomingCall.decline(this, intent); finish() }
 *   }
 *   override fun onStop() { super.onStop(); if (answered) finish() }
 *   override fun onDestroy() { runCatching { unregisterReceiver(closed) }; super.onDestroy() }
 * }
 * ```
 */
object PoolseIncomingCall {
  const val EXTRA_CALL_ID = AndroidRingSurface.EXTRA_CALL_ID
  const val EXTRA_CONVERSATION_ID = "poolse_conversation_id"
  /** The conversation's name (a group's title), when it has one. */
  const val EXTRA_CONVERSATION_NAME = "poolse_conversation_name"
  const val EXTRA_CALLER_NAME = "poolse_caller_name"
  /** The caller's picture: the push's `caller_avatar_url`, else `incomingCall.avatarUrl` filled in. */
  const val EXTRA_CALLER_AVATAR_URL = "poolse_caller_avatar_url"
  /** `audio` | `video`. */
  const val EXTRA_MEDIA = "poolse_media"
  /** Epoch ms the ring gives up at. */
  const val EXTRA_RING_DEADLINE = "poolse_ring_deadline"
  /** Package-local broadcast with [EXTRA_CALL_ID]: that ring is over (cancelled, answered elsewhere, timed out). */
  const val ACTION_RING_CLOSED = AndroidRingSurface.ACTION_RING_CLOSED

  /** True while the ring in [intent] can still be answered. */
  @JvmStatic
  fun isLive(context: Context, intent: Intent): Boolean {
    val ring = ringOf(intent) ?: return false
    return CallCore.getOrNull(context)?.isRingLive(ring) ?: false
  }

  /**
   * Answer the ring in [intent] and bring the app forward from [activity]
   * (only a foreground activity may). Returns whether the app was started;
   * finish [activity] once it is covered (onStop), not at once — finishing
   * immediately dropped the launch on some OEMs.
   */
  @JvmStatic
  fun answer(activity: Activity, intent: Intent): Boolean {
    val ring = ringOf(intent) ?: return false
    val core = CallCore.getOrNull(activity) ?: return false
    if (!core.isRingLive(ring)) return false
    return core.onUserAnswer(ring, activity)
  }

  /** Decline the ring in [intent]. */
  @JvmStatic
  fun decline(context: Context, intent: Intent) {
    val ring = ringOf(intent) ?: return
    CallCore.getOrNull(context)?.onUserDecline(ring)
  }

  internal fun ringOf(intent: Intent): RingContext? =
    intent.getBundleExtra(AndroidRingSurface.EXTRA_RING)?.toRingContext()

  /** The ring as extras: the opaque bundle the functions above read, plus plain values to draw. */
  internal fun fill(intent: Intent, ring: RingContext): Intent = intent
    .putExtra(AndroidRingSurface.EXTRA_RING, ring.toBundle())
    .putExtra(EXTRA_CALL_ID, ring.callId)
    .putExtra(EXTRA_CONVERSATION_ID, ring.conversationId)
    .putExtra(EXTRA_CONVERSATION_NAME, ring.conversationName)
    .putExtra(EXTRA_CALLER_NAME, ring.callerName)
    .putExtra(EXTRA_CALLER_AVATAR_URL, ring.callerAvatarUrl)
    .putExtra(EXTRA_MEDIA, ring.media)
    .putExtra(EXTRA_RING_DEADLINE, ring.ringDeadlineEpochMs)
}
