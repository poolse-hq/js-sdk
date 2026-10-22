import AVKit
#if canImport(LiveKitClient)
import LiveKitClient // CocoaPods module name
#else
import LiveKit // SwiftPM module name
#endif
import UIKit

/// Video-call picture-in-picture on iOS (15+): leave the app during a
/// video call and the other person keeps playing in a floating window,
/// as in FaceTime.
///
/// iOS needs two things for it. A SOURCE view inside the app — the
/// `<CallVideoView pictureInPicture>` on screen, which the window grows
/// out of and shrinks back into — and the CONTENT, a view controller iOS
/// moves into its own window. The content draws the same participant
/// through its own surface, so it keeps rendering while the app's views
/// are off screen; it uses LiveKit's sample-buffer renderer, the one iOS
/// composites into a PiP window (a Metal view stays black there).
///
/// Armed by the host (`setPictureInPictureEnabled`) only while there is a
/// picture worth floating. Main thread only.
final class CallPictureInPicture: NSObject, AVPictureInPictureControllerDelegate {
  static let shared = CallPictureInPicture()

  /// Fires with true when the window opens, false when it closes.
  static var listener: ((Bool) -> Void)?

  private(set) var active = false
  private var enabled = false
  private weak var sourceView: UIView?
  private var participantId: String?

  private var controller: AVPictureInPictureController?
  private var content: UIViewController?
  private var surface: LiveKitVideoSurface?

  private override init() { super.init() }

  static var supported: Bool {
    if #available(iOS 15.0, *) { return AVPictureInPictureController.isPictureInPictureSupported() }
    return false
  }

  /// The host turns it on while a video call shows someone's picture.
  func setEnabled(_ on: Bool) {
    enabled = on
    rebuild()
  }

  /// The on-screen view to grow the window out of, and who it shows.
  func setSource(_ view: UIView?, participantId: String?) {
    let sameView = view === sourceView
    if sameView, participantId == self.participantId { return }
    sourceView = view
    self.participantId = participantId
    if sameView, view != nil, controller != nil, let id = participantId {
      // Same source, someone else (a 1-on-1 swap): just redirect the picture.
      surface?.configure(participantId: id, local: false, mirror: nil, fit: "cover")
      return
    }
    rebuild()
  }

  /// A source view going away: drop it only if it is still the source.
  func clearSource(_ view: UIView) {
    if sourceView === view { setSource(nil, participantId: nil) }
  }

  private func rebuild() {
    guard Self.supported, #available(iOS 15.0, *) else { return }
    guard enabled, let source = sourceView, let id = participantId, let core = CallCore.peek() else {
      tearDown()
      return
    }
    if let controller = controller, controller.contentSource?.activeVideoCallSourceView === source {
      surface?.configure(participantId: id, local: false, mirror: nil, fit: "cover")
      controller.canStartPictureInPictureAutomaticallyFromInline = true
      return
    }
    tearDown()

    let vc = AVPictureInPictureVideoCallViewController()
    // Portrait, the shape of a phone camera; iOS sizes the window from it.
    vc.preferredContentSize = CGSize(width: 9, height: 16)
    vc.view.backgroundColor = .black
    let s = core.createVideoSurface(renderMode: .sampleBuffer)
    s.frame = vc.view.bounds
    s.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    vc.view.addSubview(s)
    s.configure(participantId: id, local: false, mirror: nil, fit: "cover")

    let c = AVPictureInPictureController(
      contentSource: .init(activeVideoCallSourceView: source, contentViewController: vc))
    c.canStartPictureInPictureAutomaticallyFromInline = true
    c.delegate = self
    controller = c
    content = vc
    surface = s
    pcTrace("pip armed participant=\(id)")
  }

  private func tearDown() {
    guard let c = controller else { return }
    if c.isPictureInPictureActive { c.stopPictureInPicture() }
    c.delegate = nil
    controller = nil
    content = nil
    surface?.release()
    surface?.removeFromSuperview()
    surface = nil
    setActive(false)
  }

  private func setActive(_ on: Bool) {
    guard active != on else { return }
    active = on
    CallPictureInPicture.listener?(on)
  }

  // MARK: - AVPictureInPictureControllerDelegate

  func pictureInPictureControllerDidStartPictureInPicture(_ c: AVPictureInPictureController) {
    pcTrace("pip started")
    setActive(true)
  }

  func pictureInPictureControllerDidStopPictureInPicture(_ c: AVPictureInPictureController) {
    pcTrace("pip stopped")
    setActive(false)
  }

  func pictureInPictureController(_ c: AVPictureInPictureController,
                                  failedToStartPictureInPictureWithError error: Error) {
    pcTrace("pip failed: \(error.localizedDescription)")
    setActive(false)
  }

  // Back into the app: the call screen is still there underneath.
  func pictureInPictureController(_ c: AVPictureInPictureController,
                                  restoreUserInterfaceForPictureInPictureStopWithCompletionHandler
                                  completionHandler: @escaping (Bool) -> Void) {
    completionHandler(true)
  }
}
