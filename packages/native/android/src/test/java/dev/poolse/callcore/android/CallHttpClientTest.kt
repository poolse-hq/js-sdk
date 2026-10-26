package dev.poolse.callcore.android

import dev.poolse.callcore.CallSessionBundle
import dev.poolse.callcore.HttpResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The HTTP classifier/parser, without a network: status + body →
 * HttpResult exactly as CALL_CONTRACT.md §4 maps them.
 */
class CallHttpClientTest {

  private val full = """
    {"cv":1,"created":false,
     "call":{"id":"c1","conversation_id":"v1","conversation_name":"Boiler","media":"video"},
     "livekit":{"url":"wss://sfu","token":"lk-new"},
     "control_token":"ctl-new"}
  """.trimIndent()

  private val current = CallSessionBundle(
    callId = "c1", conversationId = "v1", conversationName = "Boiler", media = "audio",
    created = true, livekitUrl = "wss://old", livekitToken = "lk-old", controlToken = "ctl-old",
  )

  @Test fun `full bundle parses (answer, join, place and now reconnect)`() {
    val r = CallHttpClient.classify(200, full, current) as HttpResult.Ok
    assertEquals("c1", r.bundle.callId)
    assertEquals("lk-new", r.bundle.livekitToken)
    assertEquals("ctl-new", r.bundle.controlToken)
    assertEquals("video", r.bundle.media)
    assertEquals(false, r.bundle.created)
  }

  @Test fun `old reconnect shape is applied onto the current bundle`() {
    val r = CallHttpClient.classify(200, """{"cv":1,"livekit":{"url":"wss://sfu2","token":"lk-2"}}""", current)
      as HttpResult.Ok
    assertEquals(current.copy(livekitUrl = "wss://sfu2", livekitToken = "lk-2"), r.bundle)
  }

  @Test fun `unparseable 2xx is a failure, not a retry`() {
    assertTrue(CallHttpClient.classify(200, "<html>", null) is HttpResult.Failed)
    assertTrue(CallHttpClient.classify(200, """{"livekit":{"token":"x"}}""", null) is HttpResult.Failed)
  }

  @Test fun `error envelope code is read`() {
    val r = CallHttpClient.classify(401, """{"error":{"code":"grant_spent","message":"…"}}""")
    assertEquals(HttpResult.AuthFailed("grant_spent"), r)
    assertEquals(HttpResult.AuthFailed("http_403"), CallHttpClient.classify(403, null))
  }

  @Test fun `status mapping`() {
    assertEquals(HttpResult.Gone, CallHttpClient.classify(410, null))
    assertEquals(HttpResult.Gone, CallHttpClient.classify(404, """{"error":{"code":"no_call"}}"""))
    assertEquals(HttpResult.Failed("http_503"), CallHttpClient.classify(503, null))
    assertEquals(HttpResult.Timeout, CallHttpClient.classify(502, null))
    assertEquals(HttpResult.Timeout, CallHttpClient.classify(429, null))
    assertEquals(HttpResult.Failed("bad"), CallHttpClient.classify(422, """{"error":{"code":"bad"}}"""))
  }
}
