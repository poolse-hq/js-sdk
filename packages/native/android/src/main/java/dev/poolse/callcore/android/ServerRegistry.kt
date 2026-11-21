package dev.poolse.callcore.android

import android.content.Context
import dev.poolse.callcore.CallServer
import dev.poolse.callcore.CallServers
import org.json.JSONArray
import org.json.JSONObject

/**
 * The signed-in servers, persisted — so a ring or a notification action
 * that wakes a killed app (no JS) knows where each workspace's API
 * lives. No secrets in it: ids, URLs, tenant ids and names.
 *
 * Upgrading from a single-server build: no list yet, so the server
 * `configure` persisted becomes `default`.
 */
object ServerRegistry {
  private const val PREFS = "dev.poolse.callcore"
  private const val KEY = "servers"

  @Volatile private var loaded: CallServers? = null

  /** The current list. Any thread. */
  fun servers(context: Context): CallServers = loaded ?: synchronized(this) { loaded ?: load(context) }

  fun upsert(context: Context, server: CallServer) = mutate(context) { it.upsert(server) }

  fun remove(context: Context, id: String) = mutate(context) { it.remove(id) }

  /** The base URL of [serverId] (null = the default server); "" when unknown. */
  fun baseUrl(context: Context, serverId: String?): String {
    val s = servers(context)
    s.get(serverId)?.let { return it.apiBaseUrl }
    // A single-server app that never named its server: whatever it has.
    if (serverId == null && s.all.size == 1) return s.all[0].apiBaseUrl
    return ""
  }

  /** The server a push of [tenantId] belongs to (see [CallServers.resolve]). */
  fun resolve(context: Context, tenantId: String?): CallServer? =
    servers(context).resolve(tenantId?.ifBlank { null })

  private fun mutate(context: Context, change: (CallServers) -> CallServers) = synchronized(this) {
    val next = change(loaded ?: load(context))
    loaded = next
    val list = JSONArray()
    for (s in next.all) list.put(s.toJson())
    prefs(context).edit().putString(KEY, list.toString()).apply()
  }

  private fun load(context: Context): CallServers {
    val p = prefs(context)
    val raw = p.getString(KEY, null)
    val s = if (raw != null) {
      val list = runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
      CallServers((0 until list.length()).mapNotNull { list.optJSONObject(it)?.toServer() })
    } else {
      // Migrate: the one server a single-server build configured.
      val legacy = p.getString("apiBaseUrl", null)?.trimEnd('/')?.ifEmpty { null }
        ?: return CallServers() // nothing yet — not cached: configure may be about to run
      CallServers(listOf(CallServer(CallServers.DEFAULT_ID, legacy))).also { migrated ->
        val list = JSONArray().put(migrated.all[0].toJson())
        p.edit().putString(KEY, list.toString()).apply()
      }
    }
    loaded = s
    return s
  }

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun CallServer.toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("apiBaseUrl", apiBaseUrl)
    .apply {
      tenantId?.let { put("tenantId", it) }
      name?.let { put("name", it) }
    }

  private fun JSONObject.toServer(): CallServer? {
    val id = optString("id").ifBlank { null } ?: return null
    val url = optString("apiBaseUrl").ifBlank { null } ?: return null
    return CallServer(id, url, optString("tenantId").ifBlank { null }, optString("name").ifBlank { null })
  }

  /**
   * "Ana · Acme" for a ring surface: [base] (the conversation or caller)
   * with the ring's workspace — only while several servers are signed in.
   */
  fun ringTitle(context: Context, ring: dev.poolse.callcore.RingContext, base: String?): String? =
    CallServers.title(base, servers(context).workspaceLabel(ring.serverId, ring.workspaceName))

  /** A server from the bridge's `addServer` map; null when it lacks an id or URL. */
  fun fromMap(map: Map<String, Any?>): CallServer? {
    val id = (map["id"] as? String)?.ifBlank { null } ?: return null
    val url = (map["apiBaseUrl"] as? String)?.trimEnd('/')?.ifBlank { null } ?: return null
    return CallServer(id, url, (map["tenantId"] as? String)?.ifBlank { null }, (map["name"] as? String)?.ifBlank { null })
  }

  fun toMap(server: CallServer): Map<String, Any?> = buildMap {
    put("id", server.id)
    put("apiBaseUrl", server.apiBaseUrl)
    server.tenantId?.let { put("tenantId", it) }
    server.name?.let { put("name", it) }
  }
}
