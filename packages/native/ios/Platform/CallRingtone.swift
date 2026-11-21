import Foundation

/// The incoming-call ringtone CallKit plays: `CXProviderConfiguration.ringtoneSound`.
///
/// Sources, first match wins:
/// 1. `configure({ ringtone })` at runtime — persisted, so a PushKit cold
///    wake (no JS yet) rings with it too;
/// 2. `PoolseRingtone` in Info.plist — written by the config plugin's
///    `ringtone` option;
/// 3. nothing: the system ringtone.
///
/// CallKit wants the file NAME of a sound in the main bundle (caf, aiff or
/// wav, 30 s or shorter — longer files and mp3 fall back to the system
/// ringtone). The value may be a full file name (`ring.caf`) or a base name
/// (`ring`), which is looked up as caf, aiff, aif, then wav. A name that is
/// not in the bundle is ignored rather than handed to CallKit, which would
/// ring silently.
enum CallRingtone {
  static let infoPlistKey = "PoolseRingtone"
  private static let defaultsKey = "ringtone"
  private static let defaults = UserDefaults(suiteName: "dev.poolse.callcore") ?? .standard
  static let extensions = ["caf", "aiff", "aif", "wav"]

  /// Store the runtime choice. nil / empty clears it (back to the plugin's or the system's).
  static func configure(_ name: String?) {
    let value = (name?.isEmpty ?? true) ? nil : name
    defaults.set(value, forKey: defaultsKey)
    writeFile(value)
  }

  /// The bundle file name CallKit should play, or nil for the system ringtone.
  static func soundFileName() -> String? {
    let runtime = defaults.string(forKey: defaultsKey) ?? readFile()
    if let runtime = runtime, let file = bundleFileName(for: runtime) { return file }
    if let plist = Bundle.main.object(forInfoDictionaryKey: infoPlistKey) as? String,
       let file = bundleFileName(for: plist) {
      return file
    }
    return nil
  }

  static func bundleFileName(for name: String) -> String? {
    guard !name.isEmpty else { return nil }
    let ns = name as NSString
    let ext = ns.pathExtension.lowercased()
    if !ext.isEmpty {
      return Bundle.main.url(forResource: ns.deletingPathExtension, withExtension: ns.pathExtension) != nil
        ? name : nil
    }
    for ext in extensions where Bundle.main.url(forResource: name, withExtension: ext) != nil {
      return "\(name).\(ext)"
    }
    return nil
  }

  // UserDefaults is unreadable while the phone is locked since reboot; a
  // PushKit wake then reads this unprotected file instead (it holds only
  // a sound name), beside CallCore's config.json.
  private static var fileURL: URL? {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
      .appendingPathComponent("dev.poolse.callcore", isDirectory: true)
      .appendingPathComponent("ringtone.txt")
  }

  private static func writeFile(_ value: String?) {
    guard let url = fileURL else { return }
    let fm = FileManager.default
    guard let value = value else {
      try? fm.removeItem(at: url)
      return
    }
    do {
      try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                             attributes: [.protectionKey: FileProtectionType.none])
      try Data(value.utf8).write(to: url, options: [.atomic, .noFileProtection])
    } catch {
      NSLog("[PoolseCalls] ringtone file write failed: %@", "\(error)")
    }
  }

  private static func readFile() -> String? {
    guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
    let s = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    return s.isEmpty ? nil : s
  }
}
