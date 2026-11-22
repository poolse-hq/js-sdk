package dev.poolse.callcore.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
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
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * An agent attending a meeting for the user asks them something its brief
 * doesn't cover (server docs/AGENTS_IN_CALLS.md §5): the FCM data push
 * `type: "agent_escalation"`, posted here natively so it shows with the
 * app killed — "Jasir's agent asks: They ask for 10% off, accept?" with
 * Approve, Decline and Answer (inline text).
 *
 * The actions reply natively, authorized by the push's short-lived
 * `reply_token` (that escalation only, once, until `expires_at`) in the
 * body — `POST /v1/agent-escalations/:id/reply`, no session, no JS — so
 * they work from the lock screen. The app's `messageReplyRequiresUnlock`
 * setting asks for the unlock first here too.
 *
 * Results reach JS like chat replies: `onNotificationAction` with
 * `action: "escalation"` (queued while nobody listens).
 */
object EscalationNotification {
  const val CHANNEL_ID = "poolse_agent_escalations"
  internal const val KEY_ANSWER = "poolse_escalation_answer"
  internal const val ACTION_APPROVE = "dev.poolse.callcore.escalation.APPROVE"
  internal const val ACTION_DECLINE = "dev.poolse.callcore.escalation.DECLINE"
  internal const val ACTION_ANSWER = "dev.poolse.callcore.escalation.ANSWER"
  internal const val EXTRA_ID = "poolse_escalation_id"
  private const val PREFS = "dev.poolse.escalations"
  private const val TAG = "PoolseEscalation"
  private const val META_UNLOCK = "dev.poolse.messages.reply_requires_unlock"

  /** A `type: "agent_escalation"` push. */
  fun show(context: Context, data: Map<String, String>, smallIcon: Int) {
    val id = data["escalation_id"]?.ifBlank { null } ?: return
    val token = data["reply_token"]?.ifBlank { null } ?: return
    val expiresAt = parseTime(data["expires_at"])
    if (expiresAt != null && expiresAt <= System.currentTimeMillis()) return
    val server = ServerRegistry.resolve(context, data["tenant_id"]?.ifBlank { null })
    val e = Escalation(
      id = id,
      token = token,
      serverId = server?.id,
      replyUrl = data["reply_url"]?.ifBlank { null },
      callId = data["call_id"]?.ifBlank { null },
      conversationId = data["conversation_id"]?.ifBlank { null },
      title = data["title"]?.ifBlank { null }
        ?: "${data["agent_name"]?.ifBlank { null } ?: "Your agent"} asks",
      question = data["question"]?.ifBlank { null } ?: data["body"].orEmpty(),
      options = (data["options"] ?: "approve,decline,answer").split(',').map { it.trim() }.filter { it.isNotEmpty() },
      workspace = ServerRegistry.servers(context).workspaceLabel(server?.id, data["workspace_name"]),
      expiresAt = expiresAt,
    )
    save(context, e)
    post(context, e, smallIcon, status = null, alert = true)
  }

  /** The user acted: show "Sending…" now (Android spins the reply field until the notification changes). */
  internal fun onSending(context: Context, id: String) {
    val e = load(context, id) ?: return
    post(context, e, CallCore.smallIcon(context), status = "Sending…", alert = false, actions = false)
  }

  /**
   * The reply's outcome. Sent: "Approved" (or what you answered), then gone
   * after a moment. Not sent: why, with the actions back when trying again
   * can still work.
   */
  internal fun onReplied(context: Context, id: String, ok: Boolean, label: String, retryable: Boolean) {
    val e = load(context, id) ?: return
    if (ok) {
      post(context, e, CallCore.smallIcon(context), status = label, alert = false, actions = false, timeoutMs = 4_000L)
      remove(context, id)
    } else {
      post(context, e, CallCore.smallIcon(context), status = label, alert = true, actions = retryable)
      if (!retryable) remove(context, id)
    }
  }

  internal fun find(context: Context, id: String): Escalation? = load(context, id)

  // ── building ────────────────────────────────────────────────────────

  private fun post(
    context: Context,
    e: Escalation,
    smallIcon: Int,
    status: String?,
    alert: Boolean,
    actions: Boolean = true,
    timeoutMs: Long? = null,
  ) {
    ensureChannel(context)
    val nid = notificationId(e.id)
    val body = if (status != null) "${e.question}\n\n$status" else e.question
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon)
      .setContentTitle(e.title)
      .setContentText(status ?: e.question)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setOnlyAlertOnce(!alert)
      .setAutoCancel(true)
      .apply { if (e.workspace != null) setSubText(e.workspace) }
    val left = e.expiresAt?.let { it - System.currentTimeMillis() }
    (timeoutMs ?: left?.takeIf { it > 0 })?.let(builder::setTimeoutAfter)
    openIntent(context, e, nid)?.let(builder::setContentIntent)

    if (actions) {
      val unlock = requiresUnlock(context)
      if ("approve" in e.options) {
        builder.addAction(
          NotificationCompat.Action.Builder(0, "Approve", actionIntent(context, ACTION_APPROVE, e.id, nid + 1, mutable = false))
            .setShowsUserInterface(false)
            .setAuthenticationRequired(unlock)
            .build(),
        )
      }
      if ("decline" in e.options) {
        builder.addAction(
          NotificationCompat.Action.Builder(0, "Decline", actionIntent(context, ACTION_DECLINE, e.id, nid + 2, mutable = false))
            .setShowsUserInterface(false)
            .setAuthenticationRequired(unlock)
            .build(),
        )
      }
      if ("answer" in e.options) {
        val input = RemoteInput.Builder(KEY_ANSWER).setLabel("Your answer").build()
        builder.addAction(
          NotificationCompat.Action.Builder(0, "Answer", actionIntent(context, ACTION_ANSWER, e.id, nid + 3, mutable = true))
            .addRemoteInput(input)
            .setAllowGeneratedReplies(false)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .setAuthenticationRequired(unlock)
            .build(),
        )
      }
    }
    try {
      NotificationManagerCompat.from(context).notify(nid, builder.build())
    } catch (err: SecurityException) {
      Log.w(TAG, "escalation notification refused (POST_NOTIFICATIONS?)", err)
    }
  }

  /** A tap opens the app on the call's conversation (`open` CallAction). */
  private fun openIntent(context: Context, e: Escalation, requestCode: Int): PendingIntent? {
    val conversationId = e.conversationId ?: return null
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      .putExtra(MissedCallNotification.EXTRA_ACTION, MissedCallNotification.ACTION_OPEN)
      .putExtra(MissedCallNotification.EXTRA_CONVERSATION_ID, conversationId)
      .putExtra(MissedCallNotification.EXTRA_CALL_ID, e.callId)
      .putExtra(MissedCallNotification.EXTRA_SERVER_ID, e.serverId)
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun actionIntent(context: Context, action: String, id: String, requestCode: Int, mutable: Boolean): PendingIntent {
    val intent = Intent(context, EscalationActionReceiver::class.java).setAction(action).putExtra(EXTRA_ID, id)
    // RemoteInput writes the typed text into the intent: it must be mutable.
    val mutability = if (mutable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      PendingIntent.FLAG_MUTABLE
    } else {
      PendingIntent.FLAG_IMMUTABLE
    }
    return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutability)
  }

  private fun requiresUnlock(context: Context): Boolean = runCatching {
    context.packageManager
      .getApplicationInfo(context.packageName, android.content.pm.PackageManager.GET_META_DATA)
      .metaData?.getBoolean(META_UNLOCK, false) ?: false
  }.getOrDefault(false)

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Questions from your agent", NotificationManager.IMPORTANCE_HIGH).apply {
        lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
      },
    )
  }

  private fun notificationId(id: String) = ("escalation:$id").hashCode()

  private fun parseTime(v: String?): Long? {
    if (v.isNullOrBlank()) return null
    v.toLongOrNull()?.let { return it }
    // ISO 8601 ("2026-11-22T10:00:00.123Z"); java.time needs API 26.
    val iso = v.trim().replace(Regex("\\.\\d+"), "").replace(Regex("Z$"), "+00:00")
    return runCatching {
      SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).parse(iso)?.time
    }.getOrNull()
  }

  // ── storage (the token outlives the push: actions read it from here) ─

  internal class Escalation(
    val id: String,
    val token: String,
    val serverId: String?,
    val replyUrl: String?,
    val callId: String?,
    val conversationId: String?,
    val title: String,
    val question: String,
    val options: List<String>,
    val workspace: String?,
    val expiresAt: Long?,
  )

  private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun save(context: Context, e: Escalation) {
    val o = JSONObject()
      .put("token", e.token)
      .put("server", e.serverId ?: "")
      .put("url", e.replyUrl ?: "")
      .put("call", e.callId ?: "")
      .put("conversation", e.conversationId ?: "")
      .put("title", e.title)
      .put("question", e.question)
      .put("options", e.options.joinToString(","))
      .put("workspace", e.workspace ?: "")
      .put("expires", e.expiresAt ?: 0L)
    val p = prefs(context)
    val edit = p.edit().putString(e.id, o.toString())
    // Drop the long-expired ones so the file never grows.
    val now = System.currentTimeMillis()
    for ((k, v) in p.all) {
      val exp = runCatching { JSONObject(v as String).optLong("expires") }.getOrDefault(0L)
      if (k != e.id && exp in 1 until now - 60 * 60 * 1000L) edit.remove(k)
    }
    edit.apply()
  }

  private fun load(context: Context, id: String): Escalation? {
    val raw = prefs(context).getString(id, null) ?: return null
    return runCatching {
      val o = JSONObject(raw)
      Escalation(
        id = id,
        token = o.getString("token"),
        serverId = o.optString("server").ifBlank { null },
        replyUrl = o.optString("url").ifBlank { null },
        callId = o.optString("call").ifBlank { null },
        conversationId = o.optString("conversation").ifBlank { null },
        title = o.optString("title"),
        question = o.optString("question"),
        options = o.optString("options").split(',').filter { it.isNotEmpty() },
        workspace = o.optString("workspace").ifBlank { null },
        expiresAt = o.optLong("expires").takeIf { it > 0 },
      )
    }.getOrNull()
  }

  private fun remove(context: Context, id: String) {
    prefs(context).edit().remove(id).apply()
  }
}

/** Approve / Decline / Answer tapped on an escalation notification. */
class EscalationActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(EscalationNotification.EXTRA_ID) ?: return
    val app = context.applicationContext
    val decision = when (intent.action) {
      EscalationNotification.ACTION_APPROVE -> "approve"
      EscalationNotification.ACTION_DECLINE -> "decline"
      EscalationNotification.ACTION_ANSWER -> "answer"
      else -> return
    }
    val answer = if (decision == "answer") {
      RemoteInput.getResultsFromIntent(intent)
        ?.getCharSequence(EscalationNotification.KEY_ANSWER)?.toString()?.trim().orEmpty().take(1000)
    } else {
      null
    }
    if (decision == "answer" && answer.isNullOrEmpty()) {
      // Nothing typed: repost so the field stops spinning.
      EscalationNotification.onReplied(app, id, ok = false, label = "Type an answer to send it.", retryable = true)
      return
    }
    EscalationNotification.onSending(app, id)
    EscalationActionWorker.enqueue(app, id, decision, answer)
  }
}

/**
 * The HTTP side: `POST /v1/agent-escalations/:id/reply` `{token,
 * decision}` / `{token, answer}`, no Authorization header, against the
 * escalation's own server. The token works once, so only a request that
 * never got an answer (no connection) is retried; a 5xx or 429 is retried
 * briefly too (the server did not take it).
 */
class EscalationActionWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    val app = applicationContext
    val id = inputData.getString(KEY_ID) ?: return@withContext Result.failure()
    val decision = inputData.getString(KEY_DECISION) ?: return@withContext Result.failure()
    val answer = inputData.getString(KEY_ANSWER)
    val e = EscalationNotification.find(app, id)
    val url = e?.let { urlOf(app, it) }
    val expired = e?.expiresAt?.let { it + 60_000L < System.currentTimeMillis() } ?: false

    val outcome = when {
      e == null -> Outcome(0, "no_token", null)
      url == null -> Outcome(0, "not_configured", null)
      expired -> Outcome(410, "expired", null)
      else -> {
        val body = JSONObject().put("token", e.token)
        if (decision == "answer") body.put("answer", answer.orEmpty()) else body.put("decision", decision)
        post(url, body)
      }
    }
    val ok = outcome.status in 200..299
    val retryable = !ok && e != null && url != null && !expired &&
      (outcome.status == 0 || outcome.status == 429 || outcome.status >= 500)
    if (retryable && runAttemptCount + 1 < MAX_ATTEMPTS) return@withContext Result.retry()

    val label = if (ok) {
      when (decision) {
        "approve" -> "Approved — your agent will say so."
        "decline" -> "Declined — your agent will say so."
        else -> "Sent: “${answer.orEmpty()}”"
      }
    } else {
      reason(outcome)
    }
    // Trying again from the notification still works only while it's pending.
    val canRetry = !ok && outcome.status !in setOf(401, 404, 409, 410) && outcome.code != "no_token"
    EscalationNotification.onReplied(app, id, ok, label, canRetry)

    val event = mutableMapOf<String, Any?>(
      "action" to "escalation",
      "escalationId" to id,
      "decision" to decision,
      "conversationId" to (e?.conversationId ?: ""),
      "callId" to e?.callId,
      "ok" to ok,
      "serverId" to (e?.serverId ?: ServerRegistry.servers(app).get(null)?.id),
    )
    if (decision == "answer") event["text"] = answer
    if (!ok) {
      event["error"] = outcome.code ?: if (outcome.status == 0) "network" else "http_${outcome.status}"
      if (outcome.status != 0) event["status"] = outcome.status
    }
    MessageNotifications.report(app, event)
    if (ok) Result.success() else Result.failure()
  }

  override suspend fun getForegroundInfo(): ForegroundInfo {
    val notification = NotificationCompat.Builder(applicationContext, EscalationNotification.CHANNEL_ID)
      .setSmallIcon(CallCore.smallIcon(applicationContext))
      .setContentTitle("Sending your answer…")
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setSilent(true)
      .setOngoing(true)
      .build()
    return ForegroundInfo(FOREGROUND_ID, notification)
  }

  /** Its own server's API (the one the push came from); the push's URL only when none is configured. */
  private fun urlOf(context: Context, e: EscalationNotification.Escalation): String? {
    val base = if (e.serverId != null) {
      ServerRegistry.baseUrl(context, e.serverId).ifEmpty { null }
    } else {
      ServerRegistry.baseUrl(context, null).ifEmpty { null } ?: CallCore.apiBaseUrl(context)
    }
    if (base != null) return "$base/v1/agent-escalations/${android.net.Uri.encode(e.id)}/reply"
    return e.replyUrl?.takeIf { it.startsWith("https://") || it.startsWith("http://") }
  }

  private class Outcome(val status: Int, val code: String?, val json: JSONObject?)

  private fun post(url: String, body: JSONObject): Outcome = runCatching {
    val request = Request.Builder()
      .url(url)
      .header("Accept", "application/json")
      .post(body.toString().toRequestBody("application/json".toMediaType()))
      .build()
    client.newCall(request).execute().use { res ->
      val json = runCatching { JSONObject(res.body?.string().orEmpty()) }.getOrNull()
      val code = json?.optJSONObject("error")?.optString("code")?.ifBlank { null }
      if (!res.isSuccessful) Log.w(TAG, "escalation reply ${res.code} ${code ?: ""}")
      Outcome(res.code, code, json)
    }
  }.getOrElse {
    Log.w(TAG, "escalation reply failed", it)
    Outcome(0, null, null)
  }

  private fun reason(o: Outcome): String = when {
    o.code == "not_configured" || o.code == "no_token" -> "Open the app to answer."
    o.status == 0 -> "No connection — try again."
    o.status == 409 -> "Already answered."
    o.status == 410 -> "Too late — the question expired."
    o.status == 401 -> "This notification expired. Open the app to answer."
    o.status == 404 -> "This question is gone."
    o.status == 422 -> "The answer couldn't be sent (1 to 1000 characters)."
    o.status == 429 -> "Too many tries — wait a moment."
    else -> "Couldn't send — try again."
  }

  companion object {
    private const val KEY_ID = "id"
    private const val KEY_DECISION = "decision"
    private const val KEY_ANSWER = "answer"
    private const val MAX_ATTEMPTS = 4
    private const val FOREGROUND_ID = 0x504F4F45
    private const val TAG = "PoolseEscalation"

    private val client: OkHttpClient by lazy {
      OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .callTimeout(20, TimeUnit.SECONDS)
        .build()
    }

    internal fun enqueue(context: Context, id: String, decision: String, answer: String?) {
      val data = Data.Builder()
        .putString(KEY_ID, id)
        .putString(KEY_DECISION, decision)
        .putString(KEY_ANSWER, answer)
        .build()
      val request = OneTimeWorkRequestBuilder<EscalationActionWorker>()
        .setInputData(data)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
        .addTag("poolse-notification-action")
        .build()
      runCatching {
        // One reply per escalation: a second tap while the first is on its way is dropped.
        WorkManager.getInstance(context).enqueueUniqueWork("poolse-escalation-$id", ExistingWorkPolicy.KEEP, request)
      }.onFailure { Log.e(TAG, "could not queue the escalation reply", it) }
    }
  }
}
