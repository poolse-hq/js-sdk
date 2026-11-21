package dev.poolse.callcore

/**
 * One API server the app is signed in to — a workspace. Holds no
 * secrets: the push brings each ring's grant, and JS passes session
 * tokens per place/join.
 */
data class CallServer(
  /** The host's own id for it (`addServer({ id })`); `default` is the one `configure(apiBaseUrl)` sets. */
  val id: String,
  val apiBaseUrl: String,
  /** The poolse tenant it signs in to: how a push (`tenant_id`) finds its server. */
  val tenantId: String? = null,
  /** The workspace's name, when the push carries none ("Ana · Acme"). */
  val name: String? = null,
)

/**
 * The signed-in servers, in the order they were added, and the rules
 * that route a push to one of them. Pure (no Android): the iOS twin is
 * CallServers.swift.
 */
data class CallServers(val all: List<CallServer> = emptyList()) {

  val isMulti: Boolean get() = all.size > 1

  fun get(id: String?): CallServer? = all.firstOrNull { it.id == (id ?: DEFAULT_ID) }

  /** Adds or replaces (by id), keeping its place in the order. */
  fun upsert(server: CallServer): CallServers {
    val i = all.indexOfFirst { it.id == server.id }
    return CallServers(if (i < 0) all + server else all.toMutableList().also { it[i] = server })
  }

  fun remove(id: String): CallServers = CallServers(all.filter { it.id != id })

  /**
   * The server a push belongs to: the one signed in to its `tenant_id`;
   * else — an older server's push, or a host that left `tenantId` out —
   * the only server, the only one without a tenant, the default, the
   * first. Null only with no server at all. Never drops a ring: a wrong
   * guess fails its answer, a dropped one never rings.
   */
  fun resolve(tenantId: String?): CallServer? {
    if (tenantId != null) all.firstOrNull { it.tenantId == tenantId }?.let { return it }
    if (all.size <= 1) return all.firstOrNull()
    val untagged = all.filter { it.tenantId == null }
    if (untagged.size == 1) return untagged[0]
    return get(DEFAULT_ID) ?: untagged.firstOrNull() ?: all.firstOrNull()
  }

  /**
   * The workspace a ring / notification is labelled with: the push's
   * name, else the server's own. Null while only one server is signed in
   * — a single-workspace app looks exactly as before.
   */
  fun workspaceLabel(serverId: String?, pushName: String?): String? {
    if (!isMulti) return null
    return pushName?.ifBlank { null } ?: get(serverId)?.name
  }

  companion object {
    const val DEFAULT_ID = "default"

    /** "Ana · Acme" — [base] with the workspace, when there is one to show (alone when the push named nobody). */
    fun title(base: String?, workspace: String?): String? {
      val w = workspace?.ifBlank { null } ?: return base
      val b = base?.ifBlank { null } ?: return w
      return "$b · $w"
    }
  }
}
