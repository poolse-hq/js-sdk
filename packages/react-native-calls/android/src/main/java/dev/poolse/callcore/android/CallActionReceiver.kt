package dev.poolse.callcore.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dev.poolse.callcore.android.AndroidRingSurface.Companion.ACTION_ANSWER
import dev.poolse.callcore.android.AndroidRingSurface.Companion.ACTION_DECLINE
import dev.poolse.callcore.android.AndroidRingSurface.Companion.ACTION_OPEN
import dev.poolse.callcore.android.AndroidRingSurface.Companion.ACTION_PREFIX
import dev.poolse.callcore.android.AndroidRingSurface.Companion.EXTRA_RING

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
    when (intent.action) {
      "$ACTION_PREFIX.$ACTION_ANSWER" -> CallCore.get(context).onUserAnswer(ring)
      "$ACTION_PREFIX.$ACTION_DECLINE" -> CallCore.get(context).onUserDecline(ring)
      "$ACTION_PREFIX.$ACTION_OPEN" -> CallCore.get(context).onUserOpen(ring)
    }
  }
}
