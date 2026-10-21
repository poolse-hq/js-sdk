package dev.poolse.callcore.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import dev.poolse.callcore.android.AndroidRingSurface.Companion.ACTION_ANSWER
import dev.poolse.callcore.android.AndroidRingSurface.Companion.ACTION_DECLINE
import dev.poolse.callcore.android.AndroidRingSurface.Companion.ACTION_OPEN
import dev.poolse.callcore.android.AndroidRingSurface.Companion.ACTION_PREFIX
import dev.poolse.callcore.android.AndroidRingSurface.Companion.ACTION_WAITING_ANSWER
import dev.poolse.callcore.android.AndroidRingSurface.Companion.ACTION_WAITING_DECLINE
import dev.poolse.callcore.android.AndroidRingSurface.Companion.EXTRA_RING
import dev.poolse.callcore.android.AndroidRingSurface.Companion.notificationId

/**
 * Answer / Decline taps on the CallStyle notification land here, as do
 * programmatic opens. Everything funnels into [CallCore], the one native
 * entry point — the same place the full-screen activity and a cold
 * launch resolve to, so there is a single answer/decline path regardless
 * of how the tap arrived.
 */
class CallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val ring = intent.getBundleExtra(EXTRA_RING)?.toRingContext() ?: return
    val core = CallCore.getOrNull(context) ?: return
    when (intent.action) {
      "$ACTION_PREFIX.$ACTION_ANSWER" -> core.onUserAnswer(ring)
      "$ACTION_PREFIX.$ACTION_DECLINE" -> core.onUserDecline(ring)
      "$ACTION_PREFIX.$ACTION_OPEN" -> core.onUserOpen(ring)
      // Call waiting: keyed to THIS call, so a stale notification can
      // never act on a different one — and one outliving its call (a
      // process restart) is simply taken down.
      "$ACTION_PREFIX.$ACTION_WAITING_ANSWER", "$ACTION_PREFIX.$ACTION_WAITING_DECLINE" -> {
        if (core.state().waiting?.callId != ring.callId) {
          NotificationManagerCompat.from(context).cancel(ring.callId.notificationId())
        } else if (intent.action == "$ACTION_PREFIX.$ACTION_WAITING_ANSWER") {
          core.answerWaiting(ring.callId)
        } else {
          core.declineWaiting(ring.callId)
        }
      }
    }
  }
}
