package dev.poolse.callcore

/**
 * One [HttpPort] for several API servers (signed in to several
 * workspaces): each request goes to the server its call belongs to.
 *
 * The runtime stays single-server — it only knows call ids. The platform
 * binds each call to its server as it enters (a ring's [RingContext.serverId],
 * a place/join with the host's server id), and this port looks the call
 * up per request. A placed call is keyed by its conversation until the
 * server mints its id; the answer binds that id too. Unbound calls go to
 * the default server (`null`), which is all a single-server app ever has.
 *
 * Thread-safe: rings are bound from the push thread, requests run on the
 * runtime's.
 */
class RoutedHttpPort(
  /** The HTTP port of one server (`null` = the default one). */
  private val portFor: (serverId: String?) -> HttpPort,
) : HttpPort {

  private val calls = LinkedHashMap<String, String>()
  private val places = HashMap<String, String>()

  /** The call [callId] belongs to [serverId] (`null` forgets it: the default server). */
  @Synchronized
  fun bindCall(callId: String, serverId: String?) {
    calls.remove(callId)
    if (serverId == null) return
    calls[callId] = serverId
    while (calls.size > MAX_BOUND) calls.remove(calls.keys.first())
  }

  /** The next call placed on [conversationId] goes to [serverId]. */
  @Synchronized
  fun bindPlace(conversationId: String, serverId: String?) {
    if (serverId == null) places.remove(conversationId) else places[conversationId] = serverId
    while (places.size > MAX_BOUND) places.remove(places.keys.first())
  }

  /** The server [callId] is bound to (a `pending:<conversation>` id: its place); null = the default. */
  @Synchronized
  fun serverFor(callId: String): String? =
    if (callId.startsWith(PENDING)) places[callId.removePrefix(PENDING)] else calls[callId]

  override fun answer(callId: String, grant: String, cb: (HttpResult) -> Unit) =
    portFor(serverFor(callId)).answer(callId, grant, cb)

  override fun join(callId: String, sessionToken: String, cb: (HttpResult) -> Unit) =
    portFor(serverFor(callId)).join(callId, sessionToken, cb)

  override fun place(conversationId: String, media: String, sessionToken: String, cb: (HttpResult) -> Unit) {
    val server = synchronized(this) { places[conversationId] }
    portFor(server).place(conversationId, media, sessionToken) { result ->
      // Everything after the answer (hangup, reconnect) names the minted id.
      if (result is HttpResult.Ok) bindCall(result.bundle.callId, server)
      cb(result)
    }
  }

  override fun decline(callId: String, auth: String, busy: Boolean) =
    portFor(serverFor(callId)).decline(callId, auth, busy)

  override fun hangup(callId: String, controlToken: String) =
    portFor(serverFor(callId)).hangup(callId, controlToken)

  override fun reconnect(current: CallSessionBundle, cb: (HttpResult) -> Unit) =
    portFor(serverFor(current.callId)).reconnect(current, cb)

  private companion object {
    const val PENDING = "pending:"
    const val MAX_BOUND = 64
  }
}
