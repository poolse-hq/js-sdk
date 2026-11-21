import Foundation

/// One API server the app is signed in to — a workspace. Holds no
/// secrets: the push brings each ring's grant, and JS passes session
/// tokens per place/join. Twin of CallServers.kt.
public struct CallServer: Equatable {
  /// The host's own id for it (`addServer({ id })`); `default` is the one `configure(apiBaseUrl)` sets.
  public var id: String
  public var apiBaseUrl: String
  /// The poolse tenant it signs in to: how a push (`tenant_id`) finds its server.
  public var tenantId: String?
  /// The workspace's name, when the push carries none ("Ana · Acme").
  public var name: String?

  public init(id: String, apiBaseUrl: String, tenantId: String? = nil, name: String? = nil) {
    self.id = id
    self.apiBaseUrl = apiBaseUrl
    self.tenantId = tenantId
    self.name = name
  }

  public init?(dict: [String: Any]) {
    guard let id = dict["id"] as? String, !id.isEmpty,
          let url = dict["apiBaseUrl"] as? String, !url.isEmpty else { return nil }
    self.init(id: id, apiBaseUrl: url,
              tenantId: (dict["tenantId"] as? String).flatMap { $0.isEmpty ? nil : $0 },
              name: (dict["name"] as? String).flatMap { $0.isEmpty ? nil : $0 })
  }

  public var dict: [String: Any] {
    var d: [String: Any] = ["id": id, "apiBaseUrl": apiBaseUrl]
    if let tenantId = tenantId { d["tenantId"] = tenantId }
    if let name = name { d["name"] = name }
    return d
  }
}

/// The signed-in servers, in the order they were added, and the rules
/// that route a push to one of them.
public struct CallServers: Equatable {
  public static let defaultId = "default"

  public private(set) var all: [CallServer]

  public init(_ all: [CallServer] = []) { self.all = all }

  public var isMulti: Bool { all.count > 1 }

  public func get(_ id: String?) -> CallServer? {
    all.first { $0.id == (id ?? CallServers.defaultId) }
  }

  /// Adds or replaces (by id), keeping its place in the order.
  public mutating func upsert(_ server: CallServer) {
    if let i = all.firstIndex(where: { $0.id == server.id }) { all[i] = server } else { all.append(server) }
  }

  public mutating func remove(_ id: String) { all.removeAll { $0.id == id } }

  /// The server a push belongs to: the one signed in to its `tenant_id`;
  /// else — an older server's push, or a host that left `tenantId` out —
  /// the only server, the only one without a tenant, the default, the
  /// first. Nil only with no server at all. Never drops a ring: a wrong
  /// guess fails its answer, a dropped one never rings.
  public func resolve(tenantId: String?) -> CallServer? {
    if let t = tenantId, let match = all.first(where: { $0.tenantId == t }) { return match }
    if all.count <= 1 { return all.first }
    let untagged = all.filter { $0.tenantId == nil }
    if untagged.count == 1 { return untagged[0] }
    return get(CallServers.defaultId) ?? untagged.first ?? all.first
  }

  /// The workspace a ring / notification is labelled with: the push's
  /// name, else the server's own. Nil while only one server is signed in
  /// — a single-workspace app looks exactly as before.
  public func workspaceLabel(serverId: String?, pushName: String?) -> String? {
    guard isMulti else { return nil }
    if let n = pushName, !n.isEmpty { return n }
    return get(serverId)?.name
  }

  /// "Ana · Acme" — `base` with the workspace, when there is one to show
  /// (the workspace alone when the push named nobody).
  public static func title(_ base: String?, workspace: String?) -> String? {
    guard let w = workspace, !w.isEmpty else { return base }
    guard let b = base, !b.isEmpty else { return w }
    return "\(b) · \(w)"
  }
}
