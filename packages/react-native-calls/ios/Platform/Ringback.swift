import AVFoundation
import Foundation

/// Outgoing ringback. The incoming ringtone is CallKit's own; the caller's
/// "ring ring" is a host-bundled tone (configure options.ringback, looked
/// up in the main bundle as mp3/caf/wav), else silence. Played inside the
/// CallKit-activated session, so it follows the call route (earpiece).
final class Ringback {
  private var player: AVAudioPlayer?
  private var wanted = false
  var resourceName: () -> String?

  init(resourceName: @escaping () -> String?) {
    self.resourceName = resourceName
  }

  func start() {
    wanted = true
    play()
  }

  func stop() {
    wanted = false
    player?.stop()
    player = nil
  }

  /// The session just became active: a ringback asked for earlier starts now.
  func sessionActivated() {
    if wanted && player?.isPlaying != true { play() }
  }

  private func play() {
    guard let url = Ringback.url(for: resourceName()) else { return }
    do {
      if player == nil {
        let p = try AVAudioPlayer(contentsOf: url)
        p.numberOfLoops = -1
        p.volume = 0.6
        p.prepareToPlay()
        player = p
      }
      player?.play()
    } catch {
      NSLog("[PoolseCalls] ringback failed: %@", "\(error)")
    }
  }

  static func url(for name: String?) -> URL? {
    guard let name = name, !name.isEmpty else { return nil }
    let ns = name as NSString
    if !ns.pathExtension.isEmpty,
       let u = Bundle.main.url(forResource: ns.deletingPathExtension, withExtension: ns.pathExtension) {
      return u
    }
    for ext in ["mp3", "caf", "wav", "m4a"] {
      if let u = Bundle.main.url(forResource: name, withExtension: ext) { return u }
    }
    return nil
  }
}
