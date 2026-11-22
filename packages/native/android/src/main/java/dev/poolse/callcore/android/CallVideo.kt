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

/**
 * Screen sharing, for a media port that can capture the screen. The
 * permission is the result of the system's screen-capture prompt
 * (`MediaProjectionManager.createScreenCaptureIntent`), which only an
 * Activity can ask for; the bridge asks and hands the result here.
 */
interface ScreenShareSource {
  fun setScreenShare(on: Boolean, permission: android.content.Intent?)
}

/**
 * Capture processing (CL7), for a media port that can change it mid-call.
 * Noise suppression is the platform's (WebRTC's NS with echo
 * cancellation kept on); background blur needs a video processor.
 */
interface CaptureProcessingSource {
  val noiseSuppressionSupported: Boolean get() = true
  val backgroundBlurSupported: Boolean get() = false
  /** On by default. Applies to the published microphone at once. */
  fun setNoiseSuppression(on: Boolean)
  /** A no-op where [backgroundBlurSupported] is false. */
  fun setBackgroundBlur(on: Boolean) {}
}

/**
 * The call's data channel (CL4 pointer and drawing on a shared screen,
 * CL6 reactions), for a media port that has one. Messages arrive through
 * [MediaEvents.onData]. Main thread only.
 */
interface CallDataSource {
  /** Our SFU identity (the poolse user id) while connected; null otherwise. */
  val localIdentity: String?

  /**
   * Send [data] under [topic] to everyone in the room, or to [to] (SFU
   * identities). `reliable = false` for what is stale a moment later (a
   * moving pointer). [done] false: not connected, over
   * [CallCore.DATA_MAX_BYTES], or refused.
   */
  fun publishData(topic: String, data: ByteArray, reliable: Boolean, to: List<String>, done: (Boolean) -> Unit)
}

/** One on-screen video slot, bound to a participant's camera or shared screen. */
interface CallVideoSurface {
  /** The Android view to host; it fills its parent. */
  val view: View

  /**
   * What to show. [participantId] is the remote's userId (SFU
   * identity); [local] shows the self view instead. [mirror] null =
   * the default (mirrored for the local front camera only). [fit] is
   * `cover` or `contain`. [source] is `camera` or `screen` (a shared
   * screen is never mirrored). Rebinds immediately and again whenever
   * the underlying track appears, disappears, mutes or the room is
   * replaced.
   */
  fun configure(participantId: String?, local: Boolean, mirror: Boolean?, fit: String, source: String = "camera")

  /** Detach from any track and free the renderer. Idempotent. */
  fun release()
}
