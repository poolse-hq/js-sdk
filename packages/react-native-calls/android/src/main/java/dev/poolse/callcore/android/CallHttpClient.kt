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
 * (CONTRACT.md §4). Every call is a bare REST request with a bearer
 * token — no session state, no SDK coupling — so the core can answer a
 * call on a cold process with nothing but the grant from the push.
 *
 * Fire-and-forget methods (`decline`, `hangup`) retry transient
 * failures a few times on OkHttp's dispatcher; request/response methods
 * surface `HttpResult` to the runtime, which owns the retry policy for
 * those (one retry, then media decides).
 */
internal class CallHttpClient(
  private val baseUrl: String,
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

  override fun reconnect(callId: String, controlToken: String, cb: (HttpResult) -> Unit) =
    post("calls/$callId/reconnect", controlToken, body = null, cb = cb)

  override fun decline(callId: String, auth: String, busy: Boolean) =
    postBestEffort(
      "calls/$callId/decline",
      auth,
      JSONObject().put("reason", if (busy) "busy" else "declined"),
    )

  override fun hangup(callId: String, controlToken: String) =
    postBestEffort("calls/$callId/hangup", controlToken, body = null)

  // ── request/response ────────────────────────────────────────────────

  private fun post(path: String, token: String, body: JSONObject?, cb: (HttpResult) -> Unit) {
    client.newCall(request(path, token, body)).enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) = cb(HttpResult.Timeout)

      override fun onResponse(call: Call, response: Response) {
        response.use {
          val payload = it.body?.string()
          cb(
            when (it.code) {
              in 200..299 -> runCatching { HttpResult.Ok(parseBundle(payload)) }
                .getOrElse { HttpResult.Timeout }
              410 -> HttpResult.Gone
              401, 403 -> HttpResult.AuthFailed(reasonOf(payload, it.code))
              408, 429, in 500..599 -> HttpResult.Timeout
              else -> HttpResult.AuthFailed("http_${it.code}")
            },
          )
        }
      }
    })
  }

  // ── fire-and-forget with bounded retry ──────────────────────────────

  private fun postBestEffort(path: String, token: String, body: JSONObject?, attempt: Int = 0) {
    client.newCall(request(path, token, body)).enqueue(object : Callback {
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
      .url("$baseUrl/v1/$path")
      .header("Authorization", "Bearer $token")
      .header("Accept", "application/json")
      .post((body?.toString() ?: "{}").toRequestBody(JSON))
      .build()

  private fun parseBundle(payload: String?): CallSessionBundle {
    val root = JSONObject(requireNotNull(payload) { "empty success body" })
    val call = root.getJSONObject("call")
    val livekit = root.getJSONObject("livekit")
    return CallSessionBundle(
      callId = call.getString("id"),
      conversationId = call.getString("conversation_id"),
      conversationName = call.optStringOrNull("conversation_name"),
      media = call.optString("media", "audio"),
      created = root.optBoolean("created", true),
      livekitUrl = livekit.getString("url"),
      livekitToken = livekit.getString("token"),
      controlToken = root.getString("control_token"),
    )
  }

  private fun reasonOf(payload: String?, code: Int): String =
    payload?.let { runCatching { JSONObject(it).optStringOrNull("error") }.getOrNull() }
      ?: "http_$code"

  private fun JSONObject.optStringOrNull(key: String): String? =
    if (isNull(key)) null else optString(key, "").ifEmpty { null }

  private companion object {
    const val MAX_BEST_EFFORT_RETRIES = 3
    val JSON = "application/json; charset=utf-8".toMediaType()

    fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
      // A call action must not hang the ring surface. Short, deliberate
      // ceilings; the runtime retries answer/place once on top of these.
      .callTimeout(java.time.Duration.ofSeconds(12))
      .connectTimeout(java.time.Duration.ofSeconds(6))
      .build()
  }
}
