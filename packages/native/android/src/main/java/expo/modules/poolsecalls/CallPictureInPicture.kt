package expo.modules.poolsecalls

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import android.util.Rational
import androidx.core.app.OnPictureInPictureModeChangedProvider
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.core.util.Consumer
import java.lang.ref.WeakReference

/**
 * Video-call picture-in-picture on Android (8+): leave the app during a
 * video call and the whole activity shrinks into a floating window. The
 * app keeps rendering — the host draws a compact layout while
 * [active] — and grows back when the window is tapped.
 *
 * Android 12+ enters by itself on Home / a swipe up (auto-enter); older
 * versions are entered from the module's user-leave hook. Armed by the
 * host only while there is a picture worth floating.
 *
 * Main thread only. The activity needs `android:supportsPictureInPicture`.
 */
internal object CallPictureInPicture {
  private const val TAG = "PoolsePip"

  /** Fires with true when the window opens, false when it closes. */
  var listener: ((Boolean) -> Unit)? = null

  var enabled = false
    private set
  var active = false
    private set

  private var watched: WeakReference<Activity>? = null
  private val onModeChanged = Consumer<PictureInPictureModeChangedInfo> { info ->
    setActive(info.isInPictureInPictureMode)
  }

  fun supported(activity: Activity?): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      activity?.packageManager?.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE) == true

  fun setEnabled(activity: Activity?, on: Boolean) {
    enabled = on
    if (activity == null || !supported(activity)) return
    watch(activity)
    runCatching { activity.setPictureInPictureParams(params(on)) }
      .onFailure { Log.w(TAG, "setPictureInPictureParams failed", it) }
  }

  /** Before Android 12 nothing enters by itself: the user leaving is the cue. */
  fun onUserLeave(activity: Activity?) {
    if (!enabled || activity == null || !supported(activity)) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return
    runCatching { activity.enterPictureInPictureMode(params(true)) }
      .onFailure { Log.w(TAG, "enterPictureInPictureMode failed", it) }
  }

  fun refresh(activity: Activity?) {
    if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    setActive(activity.isInPictureInPictureMode)
  }

  private fun params(on: Boolean): PictureInPictureParams {
    val b = PictureInPictureParams.Builder()
      // Portrait, the shape of a phone camera.
      .setAspectRatio(Rational(9, 16))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      b.setAutoEnterEnabled(on)
      b.setSeamlessResizeEnabled(true)
    }
    return b.build()
  }

  private fun watch(activity: Activity) {
    if (watched?.get() === activity) return
    (watched?.get() as? OnPictureInPictureModeChangedProvider)
      ?.removeOnPictureInPictureModeChangedListener(onModeChanged)
    (activity as? OnPictureInPictureModeChangedProvider)
      ?.addOnPictureInPictureModeChangedListener(onModeChanged)
    watched = WeakReference(activity)
  }

  private fun setActive(on: Boolean) {
    if (active == on) return
    active = on
    listener?.invoke(on)
  }
}
