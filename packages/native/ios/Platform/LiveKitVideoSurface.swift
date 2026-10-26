#if canImport(LiveKitClient)
import LiveKitClient // CocoaPods module name
#else
import LiveKit // SwiftPM module name
#endif
import UIKit

/// One on-screen video slot over LiveKit's VideoView — LiveKitVideoSurface.kt
/// for iOS. The port rebinds every live surface whenever a camera may have
/// appeared, vanished, muted, or the room was replaced (rejoin).
///
/// Main thread only, like the port that owns it.
final class LiveKitVideoSurface: UIView {
  private weak var port: LiveKitMediaPort?
  private let videoView = VideoView()
  private var released = false

  private var participantId: String?
  private var local = false
  private var mirror: Bool?
  private var fit = "cover"

  init(port: LiveKitMediaPort, renderMode: VideoView.RenderMode = .auto) {
    self.port = port
    super.init(frame: .zero)
    videoView.renderMode = renderMode
    backgroundColor = .clear
    clipsToBounds = true
    videoView.frame = bounds
    videoView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    videoView.isHidden = true
    addSubview(videoView)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  /// [participantId] is the remote's userId (SFU identity); [local] shows
  /// the self view. [mirror] nil = mirrored for the local front camera only.
  func configure(participantId: String?, local: Bool, mirror: Bool?, fit: String) {
    self.participantId = participantId
    self.local = local
    self.mirror = mirror
    self.fit = fit
    rebind()
  }

  func rebind() {
    guard !released else { return }
    let next = port?.cameraTrack(participantId: participantId, local: local)
    if (videoView.track as AnyObject?) !== (next as AnyObject?) {
      videoView.track = next
    }
    // No camera: hide so a last frozen frame never shows; the UI draws
    // the avatar from the snapshot's cameraOn underneath.
    videoView.isHidden = next == nil
    let mirrored = mirror ?? (local && port?.cameraFacing() != "back")
    videoView.mirrorMode = mirrored ? .mirror : .off
    videoView.layoutMode = fit == "contain" ? .fit : .fill
  }

  /// Detach from any track. Idempotent.
  func release() {
    guard !released else { return }
    released = true
    videoView.track = nil
    port?.unregister(self)
  }
}
