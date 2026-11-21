package dev.poolse.callcore

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Several servers behind one HttpPort: each request goes where its call came from. */
class RoutedHttpPortTest {

  private class Recorder : HttpPort {
    val log = mutableListOf<String>()
    var lastCb: ((HttpResult) -> Unit)? = null
    override fun answer(callId: String, grant: String, cb: (HttpResult) -> Unit) { log += "answer:$callId"; lastCb = cb }
    override fun join(callId: String, sessionToken: String, cb: (HttpResult) -> Unit) { log += "join:$callId"; lastCb = cb }
    override fun place(conversationId: String, media: String, sessionToken: String, cb: (HttpResult) -> Unit) {
      log += "place:$conversationId"; lastCb = cb
    }
    override fun decline(callId: String, auth: String, busy: Boolean) { log += "decline:$callId:busy=$busy" }
    override fun hangup(callId: String, controlToken: String) { log += "hangup:$callId" }
    override fun reconnect(current: CallSessionBundle, cb: (HttpResult) -> Unit) { log += "reconnect:${current.callId}" }
  }

  private val a = Recorder()
  private val b = Recorder()
  private val router = RoutedHttpPort { if (it == "b") b else a }

  private fun bundle(callId: String) = CallSessionBundle(
    callId = callId, conversationId = "conv", conversationName = null, media = "audio",
    created = true, livekitUrl = "wss://sfu", livekitToken = "lk", controlToken = "ctl",
  )

  @Test
  fun unboundCallsGoToTheDefaultServer() {
    router.answer("c1", "g") {}
    assertEquals(listOf("answer:c1"), a.log)
    assertTrue(b.log.isEmpty())
  }

  @Test
  fun aBoundCallIsAnsweredDeclinedAndHungUpOnItsServer() {
    router.bindCall("c1", "b")
    router.answer("c1", "g") {}
    router.decline("c1", "g", busy = true)
    router.hangup("c1", "ctl")
    router.reconnect(bundle("c1")) {}
    assertEquals(listOf("answer:c1", "decline:c1:busy=true", "hangup:c1", "reconnect:c1"), b.log)
    assertTrue(a.log.isEmpty())
  }

  @Test
  fun aPlacedCallKeepsItsServerOnceTheIdIsMinted() {
    router.bindPlace("conv-1", "b")
    assertEquals("b", router.serverFor("pending:conv-1"))
    router.place("conv-1", "audio", "sess") {}
    b.lastCb!!(HttpResult.Ok(bundle("out-1")))
    assertEquals("b", router.serverFor("out-1"))
    router.hangup("out-1", "ctl")
    assertEquals(listOf("place:conv-1", "hangup:out-1"), b.log)
  }

  @Test
  fun bindingsAreBoundedAndForgettable() {
    for (i in 0 until 100) router.bindCall("c$i", "b")
    assertNull(router.serverFor("c0"))
    assertEquals("b", router.serverFor("c99"))
    router.bindCall("c99", null)
    assertNull(router.serverFor("c99"))
  }
}
