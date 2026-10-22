package expo.modules.poolsecalls

import android.app.Activity
import android.os.Build
import android.view.WindowManager

/**
 * Lets the app's own activity show over the lock screen while a call
 * rings or runs, so answering never demands an unlock. Cleared when the
 * call ends, so the app never lingers above the keyguard.
 *
 * [showOverKeyguard] outlives the activity: a MainActivity recreated mid-call
 * (or launched by the core with `poolse_launch_call`) re-applies it from
 * its onCreate / onNewIntent — the host's config plugin patches those in.
 *
 * Only show-when-locked, never dismiss-keyguard: dismissing a secure lock
 * would throw up the PIN bouncer.
 */
object CallLockscreen {
  @JvmStatic
  @Volatile
  var showOverKeyguard = false

  @JvmStatic
  fun apply(activity: Activity, enabled: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      activity.setShowWhenLocked(enabled)
      activity.setTurnScreenOn(enabled)
    } else {
      @Suppress("DEPRECATION")
      val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      if (enabled) activity.window.addFlags(flags) else activity.window.clearFlags(flags)
    }
  }

  fun set(activity: Activity?, enabled: Boolean) {
    showOverKeyguard = enabled
    activity ?: return
    activity.runOnUiThread { runCatching { apply(activity, enabled) } }
  }
}
