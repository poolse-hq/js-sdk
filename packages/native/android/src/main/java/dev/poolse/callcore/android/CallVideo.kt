package dev.poolse.callcore.android

import android.content.Context
import android.view.View

/**
 * Video rendering, kept SFU-agnostic: a [dev.poolse.callcore.MediaPort]
 * that can render video ALSO implements this; the bridge's view asks
 * [CallCore.createVideoSurface] and never sees the SFU's types. A port
 * without video (the signalling-only fallback) simply doesn't implement
 * it, and the view stays empty.
 *
 * Main thread only — surfaces live in the view hierarchy, and the media
 * adapter keeps its room on main.
 */
interface CallVideoSource {
  fun createVideoSurface(context: Context): CallVideoSurface
}

/** One on-screen video slot, bound to a participant's camera. */
interface CallVideoSurface {
  /** The Android view to host; it fills its parent. */
  val view: View

  /**
   * What to show. [participantId] is the remote's userId (SFU
   * identity); [local] shows the self view instead. [mirror] null =
   * the default (mirrored for the local front camera only). [fit] is
   * `cover` or `contain`. Rebinds immediately and again whenever the
   * underlying track appears, disappears, mutes or the room is replaced.
   */
  fun configure(participantId: String?, local: Boolean, mirror: Boolean?, fit: String)

  /** Detach from any track and free the renderer. Idempotent. */
  fun release()
}
