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
 * Contract: data-only messages — rings with `type: "call"`, control
 * pushes (`ring_ended`, `finished`) and the missed-call notification
 * (`missed`) with `type: "call_event"` (CALL_CONTRACT.md §5); meeting
 * notices with `type: "meeting"` (MEETINGS.md §11.3); an agent's question
 * with `type: "agent_escalation"` (AGENTS_IN_CALLS.md §5).
 */
class CallMessagingService : FirebaseMessagingService() {

  override fun onNewToken(token: String) {
    // Registration is the app's concern (it knows the session); it reads
    // the fresh token from the bridge's token API. Nothing to do here.
    forwardToHost { it.onNewToken(token) }
  }

  override fun onDeletedMessages() {
    // FCM dropped queued messages; the host's own sync logic needs to know.
    forwardToHost { it.onDeletedMessages() }
  }

  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    // Rings ride type=call; control pushes (ring_ended, finished) ride
    // type=call_event so old JS Android builds — which ring on ANY
    // type=call — ignore them. Everything else belongs to the host.
    val type = data["type"]
    if (type == "message") {
      // Chat notifications (§5.5): posted here so they appear with the
      // app killed, grouped per conversation.
      if (CallCore.getOrNull(this) == null) return
      val conversationId = data["conversation_id"] ?: return
      when (data["event"]) {
        "new" -> MessageNotifications.onNew(this, data, CallCore.smallIcon(this))
        "read" -> MessageNotifications.onRead(this, data)
      }
      return
    }
    if (type == "meeting") {
      // Scheduled-meeting notices (MEETINGS.md §11.3): "starting" with
      // Join, and the brief. Always shown, even for the open chat.
      if (CallCore.getOrNull(this) == null) return
      MeetingNotification.show(this, data, CallCore.smallIcon(this))
      return
    }
    if (type == "agent_escalation") {
      // Your agent, attending a meeting for you, asks something
      // (AGENTS_IN_CALLS.md §5): Approve / Decline / Answer from here.
      if (CallCore.getOrNull(this) == null) return
      EscalationNotification.show(this, data, CallCore.smallIcon(this))
      return
    }
    if (type != "call" && type != "call_event") {
      forwardToHost { it.onMessageReceived(message) }
      return
    }

    // Never configured on this install: nothing can answer a call, and
    // throwing here would crash the messaging process.
    val core = CallCore.getOrNull(this) ?: return
    if (data["event"] == "missed") {
      // A notification, not call state: the call is already over.
      MissedCallNotification.show(this, data, CallCore.smallIcon(this))
      return
    }
    // A type=call push without an event is a legacy-shaped ring.
    val event = data["event"]?.ifEmpty { null } ?: if (type == "call") "ring" else return
    when (event) {
      // ring_ended reasons: cancelled | answered_elsewhere | declined |
      // timeout | finished. The machine only lets them end a RINGING_IN,
      // so an answered_elsewhere echo of THIS device's own answer
      // (optional device_id) can never end a call we already answered.
      "ring" -> data.toRingContext()?.let(core::onRing)
      "ring_ended" -> {
        val callId = data["call_id"] ?: return
        core.onRingEnded(callId, data["reason"] ?: "finished")
      }
      // The call is over for everyone (CALL_CONTRACT.md §5.3). Ends an active
      // or ringing-out call, and tears down any ring surface still up.
      "finished" -> {
        val callId = data["call_id"] ?: return
        core.onCallFinished(callId, data["reason"]?.ifEmpty { null })
      }
    }
  }

  // The same payload rules as iOS (VoipPush.swift `media` / `deadlineMs`),
  // so both cores accept the same ring contract.

  /** "audio" or "video"; anything else falls back to `has_video`. */
  private fun Map<String, String>.ringMedia(): String {
    val m = this["media"]?.trim()?.lowercase()
    if (m == "video" || m == "audio") return m
    return if (this["has_video"]?.trim()?.lowercase() in setOf("1", "true", "yes")) "video" else "audio"
  }

  /**
   * Epoch ms; a seconds value (< 1e12) is scaled. Missing: sent_at (or now)
   * + 60 s — the server's ring_ended(timeout) is the real cut-off. A missing
   * deadline used to become 0, so the ring was stale and never shown.
   */
  private fun Map<String, String>.ringDeadlineMs(): Long {
    fun num(key: String): Long? = this[key]?.trim()?.let { it.toLongOrNull() ?: it.toDoubleOrNull()?.toLong() }
    fun ms(v: Long): Long = if (v < 1_000_000_000_000L) v * 1000 else v
    num("ring_deadline")?.takeIf { it > 0 }?.let { return ms(it) }
    val base = num("sent_at")?.takeIf { it > 0 }?.let { ms(it) } ?: System.currentTimeMillis()
    return base + 60_000
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
      media = ringMedia(),
      grant = grant,
      ringDeadlineEpochMs = ringDeadlineMs(),
      // The push's own picture if the server ever sends one, else the
      // app's template filled with the caller's ids.
      callerAvatarUrl = this["caller_avatar_url"]?.ifEmpty { null }
        ?: CallCore.incomingCallLook(this@CallMessagingService).avatarUrlFor(
          externalId = this["caller_external_id"],
          userId = this["caller_user_id"],
        ),
      // Signed in to several workspaces: the ring is answered (and
      // declined) on the server of its tenant.
      serverId = ServerRegistry.resolve(this@CallMessagingService, this["tenant_id"])?.id,
      workspaceName = this["workspace_name"]?.ifEmpty { null },
      // A scheduled meeting starting (CA4): "Weekly sync is starting".
      ringType = this["ring_type"]?.ifEmpty { null },
      meetingTitle = this["meeting_title"]?.ifEmpty { null },
      meetingId = this["meeting_id"]?.ifEmpty { null },
    )
  }

  /**
   * Forward to the host app's declared FirebaseMessagingService so its
   * own (non-call) pushes still arrive. The host names its class in the
   * manifest: `<meta-data android:name="dev.poolse.callcore.delegate"
   * android:value="com.app.MyMessagingService"/>` — on `<application>`
   * (where config plugins put it), or on this service.
   *
   * Reading only the SERVICE's meta-data missed the application-level
   * entry, so every chat push was silently dropped.
   */
  private fun forwardToHost(block: (FirebaseMessagingService) -> Unit) {
    val name = delegateName() ?: run {
      android.util.Log.w(TAG, "no $DELEGATE_META meta-data: non-call push dropped")
      return
    }

    runCatching {
      val delegate = Class.forName(name).getDeclaredConstructor().newInstance()
      if (delegate is FirebaseMessagingService) {
        // The delegate needs our context to do anything useful; FCM's
        // base class resolves it from the running service, so we attach
        // ours. Kept behind runCatching: a misconfigured delegate must
        // never crash the call path.
        delegate.attachForDelegation(this)
        block(delegate)
      } else {
        android.util.Log.w(TAG, "$name is not a FirebaseMessagingService")
      }
    }.onFailure { android.util.Log.e(TAG, "delegate $name failed", it) }
  }

  private fun delegateName(): String? {
    val pm = packageManager
    val fromApp = runCatching {
      pm.getApplicationInfo(packageName, android.content.pm.PackageManager.GET_META_DATA)
        .metaData?.getString(DELEGATE_META)
    }.getOrNull()
    if (!fromApp.isNullOrEmpty()) return fromApp
    return runCatching {
      pm.getServiceInfo(
        android.content.ComponentName(this, CallMessagingService::class.java),
        android.content.pm.PackageManager.GET_META_DATA,
      ).metaData?.getString(DELEGATE_META)
    }.getOrNull()?.ifEmpty { null }
  }

  private companion object {
    const val TAG = "PoolseCallFcm"
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
