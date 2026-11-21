import Foundation

/// The signed-in servers, persisted — so a PushKit wake or a notification
/// action with no JS knows where each workspace's API lives.
///
/// Written to Application Support/dev.poolse.callcore/servers.json with
/// FileProtectionType.none, beside config.json and for the same reason:
/// a ring while the phone has been locked since reboot must still find
/// its server. No secrets in it — ids, URLs, tenant ids and names.
///
/// Upgrading from a single-server build: no file yet, so the server
/// `configure` persisted becomes `default`.
final class ServerRegistry {
  static let shared = ServerRegistry()

  private let lock = NSLock()
  private var loaded: CallServers?

  /// The current list. Any thread.
  var servers: CallServers {
    lock.lock(); defer { lock.unlock() }
    return loadLocked()
  }

  func upsert(_ server: CallServer) {
    mutate { $0.upsert(server) }
  }

  func remove(_ id: String) {
    mutate { $0.remove(id) }
  }

  /// The base URL of `serverId` (nil = the default server); "" when unknown.
  func baseUrl(_ serverId: String?) -> String {
    let s = servers
    if let server = s.get(serverId) { return server.apiBaseUrl }
    // A single-server app that never named its server: whatever it has.
    if serverId == nil, s.all.count == 1 { return s.all[0].apiBaseUrl }
    return ""
  }

  private func mutate(_ change: (inout CallServers) -> Void) {
    lock.lock()
    var s = loadLocked()
    change(&s)
    loaded = s
    lock.unlock()
    write(s)
  }

  private func loadLocked() -> CallServers {
    if let l = loaded { return l }
    var s = CallServers()
    if let url = fileURL, let data = try? Data(contentsOf: url),
       let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] {
      s = CallServers(list.compactMap(CallServer.init(dict:)))
    } else if let legacy = CallCore.persistedLegacyApiBaseUrl() {
      // Migrate: the one server a single-server build configured.
      s = CallServers([CallServer(id: CallServers.defaultId, apiBaseUrl: legacy)])
      loaded = s
      write(s)
      return s
    } else {
      // Nothing yet — don't cache: configure may still be about to run
      // (or, locked since reboot, the files may just be unreadable).
      return s
    }
    loaded = s
    return s
  }

  private var fileURL: URL? {
    guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
    return base.appendingPathComponent("dev.poolse.callcore", isDirectory: true).appendingPathComponent("servers.json")
  }

  private func write(_ s: CallServers) {
    guard let url = fileURL else { return }
    do {
      let fm = FileManager.default
      try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                             attributes: [.protectionKey: FileProtectionType.none])
      let data = try JSONSerialization.data(withJSONObject: s.all.map(\.dict))
      try data.write(to: url, options: [.atomic, .noFileProtection])
      try? fm.setAttributes([.protectionKey: FileProtectionType.none], ofItemAtPath: url.path)
    } catch {
      NSLog("[PoolseCalls] servers file write failed: %@", "\(error)")
    }
  }
}
