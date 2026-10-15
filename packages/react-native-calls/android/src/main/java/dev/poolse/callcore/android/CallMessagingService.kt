package dev.poolse.callcore.android

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dev.poolse.callcore.RingContext

/**
 * Native FCM intake — the point of the whole architecture. A call data
 * message is handled here, in native code, the instant it arrives: no
 * headless JS, no boot race, no millisecond budget spent waiting for
 * Hermes. Non-call messages are forwarded to the host app's own
 * messaging service (declared via metadata), so chat notifications and
 * everything else keep working unchanged.
 *
 * Contract: data-only messages with `type: "call"` (CONTRACT.md §5).
 */
class CallMessagingService : FirebaseMessagingService() {

  override fun onNewToken(token: String) {
    // Registration is the app's concern (it knows the session); it reads
    // the fresh token from the bridge's token API. Nothing to do here.
    forwardToHost { it.onNewToken(token) }
  }

  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    if (data["type"] != "call") {
      forwardToHost { it.onMessageReceived(message) }
      return
    }

    when (data["event"]) {
      "ring" -> data.toRingContext()?.let { CallCore.get(this).onRing(it) }
      "ring_ended" -> {
        val callId = data["call_id"] ?: return
        CallCore.get(this).onRingEnded(callId, data["reason"] ?: "finished")
      }
    }
  }

  private fun Map<String, String>.toRingContext(): RingContext? {
    val callId = this["call_id"] ?: return null
    val conversationId = this["conversation_id"] ?: return null
    val grant = this["grant"] ?: return null
    return RingContext(
      callId = callId,
      conversationId = conversationId,
      conversationName = this["conversation_name"]?.ifEmpty { null },
      callerName = this["caller_name"]?.ifEmpty { null },
      media = this["media"] ?: "audio",
      grant = grant,
      ringDeadlineEpochMs = this["ring_deadline"]?.toLongOrNull() ?: 0L,
    )
  }

  /**
   * Forward to the host app's declared FirebaseMessagingService so its
   * own (non-call) pushes still arrive. The host names its class in the
   * manifest: `<meta-data android:name="dev.poolse.callcore.delegate"
   * android:value="com.app.MyMessagingService"/>`.
   */
  private fun forwardToHost(block: (FirebaseMessagingService) -> Unit) {
    val name = runCatching {
      packageManager.getServiceInfo(
        android.content.ComponentName(this, CallMessagingService::class.java),
        android.content.pm.PackageManager.GET_META_DATA,
      ).metaData?.getString(DELEGATE_META)
    }.getOrNull() ?: return

    runCatching {
      val delegate = Class.forName(name).getDeclaredConstructor().newInstance()
      if (delegate is FirebaseMessagingService) {
        // The delegate needs our context to do anything useful; FCM's
        // base class resolves it from the running service, so we attach
        // ours. Kept behind runCatching: a misconfigured delegate must
        // never crash the call path.
        delegate.attachForDelegation(this)
        block(delegate)
      }
    }
  }

  private companion object {
    const val DELEGATE_META = "dev.poolse.callcore.delegate"
  }
}

/**
 * Minimal context attach so a delegated [FirebaseMessagingService] can
 * run outside its own lifecycle. Uses the base ContextWrapper hook.
 */
private fun FirebaseMessagingService.attachForDelegation(host: FirebaseMessagingService) {
  runCatching {
    val m = android.content.ContextWrapper::class.java
      .getDeclaredMethod("attachBaseContext", android.content.Context::class.java)
    m.isAccessible = true
    m.invoke(this, host.applicationContext)
  }
}
