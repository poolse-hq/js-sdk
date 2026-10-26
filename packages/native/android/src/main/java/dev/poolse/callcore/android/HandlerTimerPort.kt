package dev.poolse.callcore.android

import android.os.Handler
import android.os.Looper
import dev.poolse.callcore.TimerPort

/**
 * The real [TimerPort]: a single main-looper Handler keyed by token, so
 * the runtime's timers (ring deadline, ended-linger, reconnect budget)
 * fire on one predictable thread and rescheduling a key cleanly
 * replaces its pending callback.
 *
 * [nowMs] is wall-clock epoch, because the one value it is compared
 * against — the push's `ring_deadline` — is epoch, minted by the
 * server (CALL_CONTRACT.md §5.1). The actual scheduling delay is handed to
 * [Handler.postDelayed], which counts down monotonically regardless of
 * clock changes, so a mid-ring NTP correction shifts the deadline by at
 * most the drift, never breaks it.
 */
internal class HandlerTimerPort(
  private val handler: Handler = Handler(Looper.getMainLooper()),
) : TimerPort {

  private val pending = mutableMapOf<String, Runnable>()

  override fun nowMs(): Long = System.currentTimeMillis()

  override fun schedule(key: String, delayMs: Long, fire: () -> Unit) {
    cancel(key)
    val runnable = Runnable {
      synchronized(pending) { pending.remove(key) }
      fire()
    }
    synchronized(pending) { pending[key] = runnable }
    handler.postDelayed(runnable, delayMs.coerceAtLeast(0))
  }

  override fun cancel(key: String) {
    val runnable = synchronized(pending) { pending.remove(key) } ?: return
    handler.removeCallbacks(runnable)
  }
}
