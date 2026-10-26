package dev.poolse.callcore.android

import dev.poolse.callcore.CallSessionBundle
import dev.poolse.callcore.HttpPort
import dev.poolse.callcore.HttpResult
import java.io.IOException
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject

/**
 * The HTTP adapter for the contract's three token doors
 * (CALL_CONTRACT.md §4). Every call is a bare REST request with a bearer
 * token — no session state, no SDK coupling — so the core can answer a
 * call on a cold process with nothing but the grant from the push.
 *
 * Fire-and-forget methods (`decline`, `hangup`) retry transient
 * failures a few times on OkHttp's dispatcher; request/response methods
 * surface `HttpResult` to the runtime, which owns the retry policy for
 * those (one retry, then media decides).
 */
internal class CallHttpClient(
  /**
   * Read per request, not captured: a later `configure()` with another
   * API origin (staging ↔ prod switch) takes effect on the next call
   * without rebuilding the process-wide runtime.
   */
  private val baseUrl: () -> String,
  private val client: OkHttpClient = defaultClient(),
) : HttpPort {

  override fun answer(callId: String, grant: String, cb: (HttpResult) -> Unit) =
    post("calls/$callId/answer", grant, body = null, cb = cb)

  override fun join(callId: String, sessionToken: String, cb: (HttpResult) -> Unit) =
    post("calls/$callId/join", sessionToken, body = null, cb = cb)

  override fun place(
    conversationId: String,
    media: String,
    sessionToken: String,
    cb: (HttpResult) -> Unit,
  ) = post(
    "conversations/$conversationId/calls",
    sessionToken,
    body = JSONObject().put("media", media),
    cb = cb,
  )

  override fun reconnect(current: CallSessionBundle, cb: (HttpResult) -> Unit) =
    post("calls/${current.callId}/reconnect", current.controlToken, body = null, current = current, cb = cb)

  override fun decline(callId: String, auth: String, busy: Boolean) =
    postBestEffort(
      "calls/$callId/decline",
      auth,
      JSONObject().put("reason", if (busy) "busy" else "declined"),
    )

  override fun hangup(callId: String, controlToken: String) =
    postBestEffort("calls/$callId/hangup", controlToken, body = null)

  // ── request/response ────────────────────────────────────────────────

  private fun post(
    path: String,
    token: String,
    body: JSONObject?,
    current: CallSessionBundle? = null,
    cb: (HttpResult) -> Unit,
  ) {
    val req = runCatching { request(path, token, body) }.getOrElse {
      // A malformed base URL is a configuration error, not a timeout:
      // retrying cannot fix it.
      cb(HttpResult.Failed("bad_url")); return
    }
    client.newCall(req).enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) = cb(HttpResult.Timeout)

      override fun onResponse(call: Call, response: Response) {
        val result = runCatching {
          response.use { classify(it.code, it.body?.string(), current) }
        }.getOrElse { HttpResult.Timeout } // body read failed mid-stream: transient
        cb(result)
      }
    })
  }

  // ── fire-and-forget with bounded retry ──────────────────────────────

  private fun postBestEffort(path: String, token: String, body: JSONObject?, attempt: Int = 0) {
    val req = runCatching { request(path, token, body) }.getOrNull() ?: return
    client.newCall(req).enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
        if (attempt < MAX_BEST_EFFORT_RETRIES) postBestEffort(path, token, body, attempt + 1)
      }

      override fun onResponse(call: Call, response: Response) {
        response.use {
          // 2xx and 4xx are both terminal here — the server either acted
          // or will never act. Only transient 5xx/timeout retries.
          if ((it.code == 408 || it.code == 429 || it.code in 500..599) &&
            attempt < MAX_BEST_EFFORT_RETRIES
          ) {
            postBestEffort(path, token, body, attempt + 1)
          }
        }
      }
    })
  }

  private fun request(path: String, token: String, body: JSONObject?): Request =
    Request.Builder()
      .url("${baseUrl().trimEnd('/')}/v1/$path")
      .header("Authorization", "Bearer $token")
      .header("Accept", "application/json")
      .post((body?.toString() ?: "{}").toRequestBody(JSON))
      .build()

  internal companion object {
    const val MAX_BEST_EFFORT_RETRIES = 3
    val JSON = "application/json; charset=utf-8".toMediaType()

    fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
      // A call action must not hang the ring surface. Short, deliberate
      // ceilings; the runtime retries answer/place once on top of these,
      // and both attempts fit inside its 20 s CONNECTING watchdog.
      .callTimeout(java.time.Duration.ofSeconds(9))
      .connectTimeout(java.time.Duration.ofSeconds(6))
      .build()

    /**
     * Status + body → [HttpResult] (CALL_CONTRACT.md §4). Pure, so it is unit
     * tested without a network.
     *
     * - 2xx that will not parse is [HttpResult.Failed], NOT a timeout:
     *   retrying an identical request returns the identical body, and
     *   treating it as transient left the UI stuck in connecting.
     * - 404/410: the call (or this device's place in it) is gone.
     * - 401/403: auth refused — `failed`, never `finished`.
     * - 503: no SFU capacity / maintenance — terminal for this attempt.
     */
    fun classify(code: Int, payload: String?, current: CallSessionBundle? = null): HttpResult =
      when (code) {
        in 200..299 -> runCatching { HttpResult.Ok(parseBundle(payload, current)) }
          .getOrElse { HttpResult.Failed("bad_body") }
        404, 410 -> HttpResult.Gone
        401, 403 -> HttpResult.AuthFailed(errorCode(payload) ?: "http_$code")
        503 -> HttpResult.Failed(errorCode(payload) ?: "http_503")
        408, 429, in 500..599 -> HttpResult.Timeout
        else -> HttpResult.Failed(errorCode(payload) ?: "http_$code")
      }

    /**
     * One parser for answer, join, place AND reconnect: the server now
     * returns the full bundle on reconnect too. An older server's
     * reconnect answered only `{livekit:{url,token}}` (maybe a fresh
     * `control_token`); with [current] given, that is applied onto the
     * existing bundle instead of failing.
     */
    fun parseBundle(payload: String?, current: CallSessionBundle? = null): CallSessionBundle {
      val root = JSONObject(requireNotNull(payload) { "empty success body" })
      val livekit = root.getJSONObject("livekit")
      val call = root.optJSONObject("call")
      if (call == null) {
        requireNotNull(current) { "bundle without call" }
        return current.copy(
          livekitUrl = livekit.optStringOrNull("url") ?: current.livekitUrl,
          livekitToken = livekit.getString("token"),
          controlToken = root.optStringOrNull("control_token") ?: current.controlToken,
          ringing = 0,
        )
      }
      return CallSessionBundle(
        callId = call.getString("id"),
        conversationId = call.getString("conversation_id"),
        conversationName = call.optStringOrNull("conversation_name") ?: current?.conversationName,
        media = call.optStringOrNull("media") ?: current?.media ?: "audio",
        created = root.optBoolean("created", true),
        livekitUrl = livekit.getString("url"),
        livekitToken = livekit.getString("token"),
        controlToken = root.optStringOrNull("control_token")
          ?: requireNotNull(current?.controlToken) { "bundle without control_token" },
        kind = call.optStringOrNull("kind") ?: current?.kind ?: "call",
        ringing = call.optJSONObject("ring_states")?.let { states ->
          states.keys().asSequence().count { states.optString(it) == "ringing" }
        } ?: 0,
      )
    }

    /** The server's envelope is `{"error":{"code":"…"}}`; tolerate a bare string too. */
    fun errorCode(payload: String?): String? = payload?.let {
      runCatching {
        val root = JSONObject(it)
        root.optJSONObject("error")?.optStringOrNull("code") ?: root.optStringOrNull("error")
      }.getOrNull()
    }

    private fun JSONObject.optStringOrNull(key: String): String? =
      if (!has(key) || isNull(key)) null else (opt(key) as? String)?.ifEmpty { null }
  }
}
