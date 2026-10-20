package dev.poolse.callcore.livekit

import android.content.Context
import android.util.Log
import android.view.View
import dev.poolse.callcore.android.CallVideoSurface
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.track.VideoTrack
import livekit.org.webrtc.RendererCommon

/**
 * A [CallVideoSurface] over LiveKit's [TextureViewRenderer]. TextureView,
 * not SurfaceView: a local picture-in-picture overlapping a full-screen
 * remote composes like any view, with no SurfaceView z-order fights.
 *
 * The renderer is initialised against the CURRENT room's EGL context
 * ([Room.initVideoRenderer]); a rejoin builds a new room, so [rebind]
 * re-initialises it. Tracks are attached with [VideoTrack.addRenderer]
 * — for a remote track that registers the view's visibility with the
 * SDK, so adaptive stream (if ever enabled) resumes the track as soon as
 * the view is on screen instead of keeping it paused.
 *
 * Main thread only, like the port that owns it.
 */
internal class LiveKitVideoSurface(
  context: Context,
  private val port: LiveKitMediaPort,
) : CallVideoSurface {

  private val renderer = TextureViewRenderer(context)
  override val view: View get() = renderer

  private var initRoom: Room? = null
  private var track: VideoTrack? = null
  private var released = false

  private var participantId: String? = null
  private var local = false
  private var mirror: Boolean? = null
  private var fit = "cover"

  override fun configure(participantId: String?, local: Boolean, mirror: Boolean?, fit: String) {
    this.participantId = participantId
    this.local = local
    this.mirror = mirror
    this.fit = fit
    rebind()
  }

  /** Re-resolve the track (and the room) this slot should show. */
  fun rebind() {
    if (released) return
    val room = port.currentRoom()
    if (room !== initRoom) {
      // Detach from the old room's track BEFORE its EGL goes away.
      detachTrack()
      if (initRoom != null) runCatching { renderer.release() }
      initRoom = null
      if (room != null) {
        runCatching { room.initVideoRenderer(renderer); initRoom = room }
          .onFailure { Log.w(TAG, "initVideoRenderer failed", it) }
      }
    }

    val next = if (initRoom != null) port.cameraTrack(participantId, local) else null
    if (next !== track) {
      detachTrack()
      if (next != null) {
        runCatching { next.addRenderer(renderer); track = next }
          .onFailure { Log.w(TAG, "addRenderer failed", it) }
      }
    }
    // No camera: hide the renderer so its last frozen frame never shows;
    // the UI draws the avatar from the snapshot's cameraOn.
    renderer.visibility = if (track != null) View.VISIBLE else View.INVISIBLE
    if (initRoom != null) {
      runCatching {
        renderer.setMirror(mirror ?: (local && port.cameraFacing() != "back"))
        renderer.setScalingType(
          if (fit == "contain") RendererCommon.ScalingType.SCALE_ASPECT_FIT
          else RendererCommon.ScalingType.SCALE_ASPECT_FILL,
        )
      }
    }
  }

  private fun detachTrack() {
    val t = track ?: return
    track = null
    runCatching { t.removeRenderer(renderer) }
    runCatching { renderer.clearImage() }
  }

  override fun release() {
    if (released) return
    released = true
    detachTrack()
    if (initRoom != null) runCatching { renderer.release() }
    initRoom = null
    port.unregister(this)
  }

  private companion object {
    const val TAG = "PoolseCallVideo"
  }
}
