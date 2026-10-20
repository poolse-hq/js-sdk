import ExpoModulesCore
import UIKit

/// `<CallVideoView>` on iOS: a thin host for the core's LiveKitVideoSurface.
/// All binding logic lives in the media adapter; this view forwards props
/// and ties the surface's lifetime to the window.
public final class PoolseCallVideoView: ExpoView {
  private var surface: LiveKitVideoSurface?

  var participantId: String?
  var local = false
  var mirror: Bool?
  var fit = "cover"

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    clipsToBounds = true
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { attachSurface() } else { detachSurface() }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    surface?.frame = bounds
  }

  private func attachSurface() {
    guard surface == nil else { return }
    // No core yet (never configured): stay empty; a later prop update retries.
    guard let core = CallCore.peek() else { return }
    let s = core.createVideoSurface()
    s.frame = bounds
    s.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(s)
    surface = s
    apply()
  }

  func detachSurface() {
    guard let s = surface else { return }
    surface = nil
    s.release()
    s.removeFromSuperview()
  }

  func apply() {
    guard let s = surface else {
      if window != nil { attachSurface() }
      return
    }
    s.configure(participantId: participantId, local: local, mirror: mirror, fit: fit == "contain" ? "contain" : "cover")
  }

  deinit {
    // UIKit objects must be torn down on main; deinit of a view runs there.
    surface?.release()
  }
}
