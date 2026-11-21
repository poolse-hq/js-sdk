package dev.poolse.callcore.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Reply / Mark as read, tapped on a message notification (CALL_CONTRACT.md
 * §5.5). The receiver only does what must be instant — show the reply
 * line (Android spins the reply field until the notification changes),
 * or drop the notification for Mark as read — and hands the request to
 * [MessageActionWorker].
 */
class MessageActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val conversationId = intent.getStringExtra(MessageNotifications.EXTRA_CONVERSATION) ?: return
    // Null on a notification posted before servers (the default one).
    val serverId = intent.getStringExtra(MessageNotifications.EXTRA_SERVER)
    val app = context.applicationContext

    when (intent.action) {
      MessageNotifications.ACTION_REPLY -> {
        val text = RemoteInput.getResultsFromIntent(intent)
          ?.getCharSequence(MessageNotifications.KEY_REPLY)?.toString()?.trim().orEmpty()
        if (text.isEmpty()) {
          // Nothing typed; still repost so the field stops spinning.
          MessageNotifications.refresh(app, serverId, conversationId)
          return
        }
        // One id per reply, reused by every retry of it: the server
        // answers a repeat with the original message, never a second one.
        val clientId = UUID.randomUUID().toString()
        MessageNotifications.onReplying(app, serverId, conversationId, clientId, text)
        MessageActionWorker.enqueue(app, MessageActionWorker.REPLY, serverId, conversationId, text, clientId)
      }
      MessageNotifications.ACTION_READ -> {
        // Optimistic: the notification goes now; the server catches up.
        // Grant first: clearing drops it with the conversation.
        val grant = MessageNotifications.grantFor(app, serverId, conversationId)
        MessageNotifications.clear(app, conversationId, serverId ?: dev.poolse.callcore.CallServers.DEFAULT_ID)
        MessageActionWorker.enqueue(app, MessageActionWorker.READ, serverId, conversationId, null, null, grant)
      }
    }
  }
}

/**
 * The HTTP side of a notification action: `POST /v1/notification-actions/
 * {reply,read}` with the conversation's reply grant (bearer and `token`),
 * against its server's API origin (persisted by `configure` / `addServer`)
 * — no app, no session, no JS.
 *
 * WorkManager, expedited: it runs at once when there is a network, waits
 * for one when there is not, survives the process being killed, and
 * retries a network error / 5xx / 429 with backoff — always with the
 * reply's same `id`, so a retry after a lost response cannot post twice.
 * Gives up after [MAX_ATTEMPTS] or the grant's lifetime.
 */
class MessageActionWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    val app = applicationContext
    val action = inputData.getString(KEY_ACTION) ?: return@withContext Result.failure()
    val conversationId = inputData.getString(KEY_CONVERSATION) ?: return@withContext Result.failure()
    val text = inputData.getString(KEY_TEXT).orEmpty()
    val clientId = inputData.getString(KEY_CLIENT_ID).orEmpty()
    val serverId = inputData.getString(KEY_SERVER)
    // The newest grant this conversation got, else the one at tap time.
    val grant = MessageNotifications.grantFor(app, serverId, conversationId) ?: inputData.getString(KEY_GRANT)
    // Its own server; one signed out since has no address (never another
    // server's: the grant is for this one).
    val base = if (serverId != null) {
      ServerRegistry.baseUrl(app, serverId).ifEmpty { null }
    } else {
      ServerRegistry.baseUrl(app, null).ifEmpty { null } ?: CallCore.apiBaseUrl(app)
    }

    val outcome = when {
      base == null -> Outcome(0, "not_configured", null)
      grant == null -> Outcome(0, "no_grant", null)
      action == REPLY -> post("$base/v1/notification-actions/reply", grant, JSONObject().put("text", text).put("id", clientId))
      else -> post("$base/v1/notification-actions/read", grant, JSONObject())
    }
    val ok = outcome.status in 200..299
    val retryable = !ok && base != null && grant != null &&
      (outcome.status == 0 || outcome.status == 429 || outcome.status >= 500)
    val expired = System.currentTimeMillis() - inputData.getLong(KEY_AT, 0L) > GIVE_UP_MS
    // The line keeps reading "Sending…" meanwhile.
    if (retryable && runAttemptCount + 1 < MAX_ATTEMPTS && !expired) return@withContext Result.retry()

    val event = mutableMapOf<String, Any?>(
      "action" to if (action == REPLY) "reply" else "mark_read",
      "conversationId" to conversationId,
      "ok" to ok,
      "serverId" to (serverId ?: ServerRegistry.servers(app).get(null)?.id),
    )
    if (!ok) {
      event["error"] = outcome.code ?: if (outcome.status == 0) "network" else "http_${outcome.status}"
      if (outcome.status != 0) event["status"] = outcome.status
    }
    if (action == REPLY) {
      event["text"] = text
      event["clientId"] = clientId
      if (ok) event["messageId"] = outcome.json?.optString("id")?.ifBlank { null } ?: clientId
      MessageNotifications.onReplied(app, serverId, conversationId, clientId, text, ok, if (ok) null else reason(outcome), grant)
    } else if (!ok) {
      // A failed read is only logged: the message stays unread, nothing is lost.
      Log.w(TAG, "mark read failed status=${outcome.status} code=${outcome.code}")
    }
    MessageNotifications.report(app, event)
    if (ok) Result.success() else Result.failure()
  }

  /** Expedited work runs as a foreground service before Android 12: it needs a notification. */
  override suspend fun getForegroundInfo(): ForegroundInfo {
    val sending = inputData.getString(KEY_ACTION) == REPLY
    val notification = NotificationCompat.Builder(applicationContext, MessageNotifications.CHANNEL_ID)
      .setSmallIcon(CallCore.smallIcon(applicationContext))
      .setContentTitle(if (sending) "Sending reply…" else "Marking as read…")
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setSilent(true)
      .setOngoing(true)
      .build()
    return ForegroundInfo(FOREGROUND_ID, notification)
  }

  private class Outcome(val status: Int, val code: String?, val json: JSONObject?)

  private fun post(url: String, grant: String, body: JSONObject): Outcome = runCatching {
    val request = Request.Builder()
      .url(url)
      .header("Authorization", "Bearer $grant")
      .header("Accept", "application/json")
      .post(body.put("token", grant).toString().toRequestBody("application/json".toMediaType()))
      .build()
    client.newCall(request).execute().use { res ->
      val json = runCatching { JSONObject(res.body?.string().orEmpty()) }.getOrNull()
      val code = json?.optJSONObject("error")?.optString("code")?.ifBlank { null }
      if (!res.isSuccessful) Log.w(TAG, "notification action ${res.code} ${code ?: ""}")
      Outcome(res.code, code, json)
    }
  }.getOrElse {
    Log.w(TAG, "notification action failed", it)
    Outcome(0, null, null)
  }

  private fun reason(o: Outcome): String = when {
    o.code == "not_configured" || o.code == "no_grant" -> "Open the app to reply"
    o.status == 0 -> "No connection"
    o.status == 401 && o.code == "device_signed_out" -> "Signed out — open the app"
    o.status == 401 && o.code == "user_blocked" -> "Your account is blocked"
    o.status == 401 -> "Expired — open the app to reply"
    o.status == 402 -> "Your workspace is full this month"
    o.status == 403 -> "You're no longer in this chat"
    o.status == 404 -> "This chat is gone"
    o.status == 429 -> "Too many replies — try again soon"
    else -> "Couldn't send"
  }

  companion object {
    internal const val REPLY = "reply"
    internal const val READ = "read"
    private const val KEY_ACTION = "action"
    private const val KEY_CONVERSATION = "conversation_id"
    private const val KEY_SERVER = "server_id"
    private const val KEY_TEXT = "text"
    private const val KEY_CLIENT_ID = "client_id"
    private const val KEY_GRANT = "grant"
    private const val KEY_AT = "at"
    private const val MAX_ATTEMPTS = 6
    // The grant lives 24 h; well before that a stale reply is worse than none.
    private const val GIVE_UP_MS = 30 * 60 * 1000L
    private const val FOREGROUND_ID = 0x504F4F52
    private const val TAG = "PoolseMessages"

    private val client: OkHttpClient by lazy {
      OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .callTimeout(20, TimeUnit.SECONDS)
        .build()
    }

    internal fun enqueue(
      context: Context,
      action: String,
      serverId: String?,
      conversationId: String,
      text: String?,
      clientId: String?,
      grant: String? = MessageNotifications.grantFor(context, serverId, conversationId),
    ) {
      val data = Data.Builder()
        .putString(KEY_ACTION, action)
        .putString(KEY_CONVERSATION, conversationId)
        .putString(KEY_SERVER, serverId)
        .putString(KEY_TEXT, text)
        .putString(KEY_CLIENT_ID, clientId)
        .putString(KEY_GRANT, grant)
        .putLong(KEY_AT, System.currentTimeMillis())
        .build()
      val request = OneTimeWorkRequestBuilder<MessageActionWorker>()
        .setInputData(data)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
        .addTag("poolse-notification-action")
        .build()
      val name = "poolse-$action-" + (clientId ?: listOfNotNull(serverId, conversationId).joinToString("/"))
      runCatching {
        WorkManager.getInstance(context).enqueueUniqueWork(name, ExistingWorkPolicy.KEEP, request)
      }.onFailure { Log.e(TAG, "could not queue the notification action", it) }
    }
  }
}
