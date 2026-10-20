package expo.modules.poolsecalls

import android.content.Context
import android.view.ViewGroup
import dev.poolse.callcore.android.CallCore
import dev.poolse.callcore.android.CallVideoSurface
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * `<CallVideoView>` on Android: a thin host for the core's
 * [CallVideoSurface]. All binding logic (which track, rebinds on
 * subscribe/mute/rejoin) lives in the media adapter; this view only
 * forwards props and ties the surface's lifetime to the window.
 */
class PoolseCallVideoView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

  // The renderer is a native child React does not lay out: let Android
  // measure it (and re-measure when the video's size changes).
  override val shouldUseAndroidLayout = true

  private var surface: CallVideoSurface? = null

  var participantId: String? = null
    set(v) { field = v; apply() }
  var local: Boolean = false
    set(v) { field = v; apply() }
  var mirror: Boolean? = null
    set(v) { field = v; apply() }
  var fit: String = "cover"
    set(v) { field = v; apply() }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attachSurface()
  }

  override fun onDetachedFromWindow() {
    detachSurface()
    super.onDetachedFromWindow()
  }

  private fun attachSurface() {
    if (surface != null) return
    // No core yet (never configured) or no video-capable SFU: stay empty.
    val s = CallCore.peek()?.createVideoSurface(context) ?: return
    surface = s
    addView(s.view, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    apply()
  }

  internal fun detachSurface() {
    val s = surface ?: return
    surface = null
    s.release()
    removeView(s.view)
  }

  private fun apply() {
    // Mounted before the core existed (configure still pending): try again.
    val s = surface ?: run { if (isAttachedToWindow) attachSurface(); return }
    s.configure(participantId, local, mirror, if (fit == "contain") "contain" else "cover")
  }
}
