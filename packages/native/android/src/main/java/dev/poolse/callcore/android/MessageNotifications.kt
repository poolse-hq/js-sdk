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
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Chat notifications on Android (CALL_CONTRACT.md §5.5), WhatsApp-style.
 *
 * One notification per conversation, in MessagingStyle: each new message
 * becomes a line in it ("Ana: on my way") rather than a new card, and a
 * group summary collects every chat. Reply (inline text) and Mark as
 * read run natively, authorized by the reply grant the push carried, so
 * they work with the app killed and the phone locked.
 *
 * Android cannot read back the lines of a posted notification, so the
 * last few lines per conversation are kept in a small preferences file
 * and the notification is rebuilt from them on every message. They are
 * dropped the moment the conversation is read, here or elsewhere.
 */
object MessageNotifications {
  const val CHANNEL_ID = "poolse_messages"
  private const val GROUP_KEY = "dev.poolse.messages"
  private const val SUMMARY_ID = 0x504F4F4C // "POOL"
  private const val PREFS = "dev.poolse.messages"
  private const val MAX_LINES = 7
  internal const val KEY_REPLY = "poolse_reply_text"
  internal const val ACTION_REPLY = "dev.poolse.callcore.message.REPLY"
  internal const val ACTION_READ = "dev.poolse.callcore.message.READ"
  internal const val EXTRA_CONVERSATION = "poolse_message_conversation"
  private const val TAG = "PoolseMessages"

  // A message notification that waited this long for the phone to come
  // online is history.
  private const val STALE_MS = 24 * 60 * 60 * 1000L

  /**
   * The conversation on screen in the app, set by the host. Its messages
   * are not notified — the user is reading them.
   */
  @Volatile var activeConversationId: String? = null

  /** A `type: "message", event: "new"` push. */
  fun onNew(context: Context, data: Map<String, String>, smallIcon: Int) {
    val conversationId = data["conversation_id"] ?: return
    if (conversationId == activeConversationId) return
    val sentAt = data["sent_at"]?.toLongOrNull() ?: System.currentTimeMillis()
    if (System.currentTimeMillis() - sentAt > STALE_MS) return

    val state = load(context, conversationId) ?: Conversation(conversationId)
    state.title = data["conversation_name"]?.ifBlank { null } ?: state.title
    state.group = data["group"] == "1"
    state.hidden = data["private"] == "1"
    data["reply_grant"]?.ifBlank { null }?.let { state.grant = it }
    val messageId = data["message_id"]
    if (messageId == null || state.lines.none { it.id == messageId }) {
      state.lines += Line(
        id = messageId,
        sender = data["sender_name"]?.ifBlank { null } ?: "Someone",
        senderKey = data["sender_user_id"],
        text = data["text"] ?: "",
        at = sentAt,
        self = false,
      )
      while (state.lines.size > MAX_LINES) state.lines.removeAt(0)
    }
    save(context, state)
    post(context, state, smallIcon, alert = true)
  }

  /** The conversation was read (here, or on another device): clear it. */
  fun clear(context: Context, conversationId: String) {
    prefs(context).edit().remove(key(conversationId)).apply()
    runCatching { NotificationManagerCompat.from(context).cancel(notificationId(conversationId)) }
    refreshSummary(context, CallCore.smallIcon(context))
  }

  /** The reply went through: show it as the user's line and stop the spinner. */
  internal fun onReplied(context: Context, conversationId: String, text: String, ok: Boolean) {
    val state = load(context, conversationId) ?: return
    state.lines += Line(
      id = null,
      sender = "You",
      senderKey = null,
      text = if (ok) text else "Not sent: $text",
      at = System.currentTimeMillis(),
      self = true,
    )
    while (state.lines.size > MAX_LINES) state.lines.removeAt(0)
    save(context, state)
    post(context, state, CallCore.smallIcon(context), alert = false)
  }

  internal fun grantFor(context: Context, conversationId: String): String? =
    load(context, conversationId)?.grant

  // ── building ────────────────────────────────────────────────────────

  private fun post(context: Context, state: Conversation, smallIcon: Int, alert: Boolean) {
    ensureChannel(context)
    val me = Person.Builder().setName("You").build()
    val style = NotificationCompat.MessagingStyle(me)
      .setGroupConversation(state.group)
    if (state.group) style.conversationTitle = state.title
    for (line in state.lines) {
      val person = if (line.self) null else Person.Builder().setName(line.sender).setKey(line.senderKey).build()
      style.addMessage(NotificationCompat.MessagingStyle.Message(line.text, line.at, person))
    }

    val id = notificationId(state.id)
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setGroup(GROUP_KEY)
      .setAutoCancel(true)
      .setOnlyAlertOnce(!alert)
      .setWhen(state.lines.lastOrNull()?.at ?: System.currentTimeMillis())
      .setNumber(state.lines.count { !it.self })
    if (state.hidden) {
      // The tenant hides previews: nothing about who or what — the app's
      // name and a count. The server never sent the text anyway.
      val unread = state.lines.count { !it.self }
      builder
        .setContentTitle(context.applicationInfo.loadLabel(context.packageManager))
        .setContentText(if (unread <= 1) "New message" else "$unread new messages")
    } else {
      builder.setStyle(style)
    }
    openIntent(context, state.id, id)?.let(builder::setContentIntent)

    if (state.grant != null) {
      val remoteInput = RemoteInput.Builder(KEY_REPLY).setLabel("Message").build()
      val reply = NotificationCompat.Action.Builder(0, "Reply", actionIntent(context, ACTION_REPLY, state.id, id + 1, mutable = true))
        .addRemoteInput(remoteInput)
        .setAllowGeneratedReplies(true)
        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
        .setShowsUserInterface(false)
        .build()
      val read = NotificationCompat.Action.Builder(0, "Mark as read", actionIntent(context, ACTION_READ, state.id, id + 2, mutable = false))
        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
        .setShowsUserInterface(false)
        .build()
      builder.addAction(reply).addAction(read)
    }

    try {
      NotificationManagerCompat.from(context).notify(id, builder.build())
    } catch (e: SecurityException) {
      Log.w(TAG, "message notification refused (POST_NOTIFICATIONS?)", e)
      return
    }
    refreshSummary(context, smallIcon)
  }

  /** The group's summary: "5 messages from 2 chats". Gone with the last chat. */
  private fun refreshSummary(context: Context, smallIcon: Int) {
    val all = prefs(context).all.keys.filter { it.startsWith("conv:") }
      .mapNotNull { load(context, it.removePrefix("conv:")) }
    val manager = NotificationManagerCompat.from(context)
    if (all.isEmpty()) {
      runCatching { manager.cancel(SUMMARY_ID) }
      return
    }
    val messages = all.sumOf { c -> c.lines.count { !it.self } }
    val text = if (all.size == 1) "$messages new messages" else "$messages messages from ${all.size} chats"
    val summary = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon)
      .setContentTitle(text)
      .setStyle(NotificationCompat.InboxStyle().setSummaryText(text))
      .setGroup(GROUP_KEY)
      .setGroupSummary(true)
      .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
      .setAutoCancel(true)
      .build()
    runCatching { manager.notify(SUMMARY_ID, summary) }
  }

  private fun openIntent(context: Context, conversationId: String, requestCode: Int): PendingIntent? {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      .putExtra(MissedCallNotification.EXTRA_ACTION, MissedCallNotification.ACTION_OPEN)
      .putExtra(MissedCallNotification.EXTRA_CONVERSATION_ID, conversationId)
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun actionIntent(context: Context, action: String, conversationId: String, requestCode: Int, mutable: Boolean): PendingIntent {
    val intent = Intent(context, MessageActionReceiver::class.java)
      .setAction(action)
      .putExtra(EXTRA_CONVERSATION, conversationId)
    // RemoteInput writes the typed text into the intent: it must be mutable.
    val mutability = if (mutable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      PendingIntent.FLAG_MUTABLE
    } else {
      PendingIntent.FLAG_IMMUTABLE
    }
    return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutability)
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
        lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
      },
    )
  }

  private fun notificationId(conversationId: String) = ("msg:$conversationId").hashCode()

  // ── storage ─────────────────────────────────────────────────────────

  internal data class Line(
    val id: String?,
    val sender: String,
    val senderKey: String?,
    val text: String,
    val at: Long,
    val self: Boolean,
  )

  internal class Conversation(
    val id: String,
    var title: String? = null,
    var group: Boolean = false,
    var grant: String? = null,
    val lines: MutableList<Line> = mutableListOf(),
    var hidden: Boolean = false,
  )

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun key(conversationId: String) = "conv:$conversationId"

  private fun load(context: Context, conversationId: String): Conversation? {
    val raw = prefs(context).getString(key(conversationId), null) ?: return null
    return runCatching {
      val o = JSONObject(raw)
      val lines = o.optJSONArray("lines") ?: JSONArray()
      Conversation(
        id = conversationId,
        title = o.optString("title").ifBlank { null },
        group = o.optBoolean("group"),
        grant = o.optString("grant").ifBlank { null },
        hidden = o.optBoolean("hidden"),
        lines = MutableList(lines.length()) { i ->
          val l = lines.getJSONObject(i)
          Line(
            id = l.optString("id").ifBlank { null },
            sender = l.optString("sender"),
            senderKey = l.optString("key").ifBlank { null },
            text = l.optString("text"),
            at = l.optLong("at"),
            self = l.optBoolean("self"),
          )
        },
      )
    }.getOrNull()
  }

  private fun save(context: Context, c: Conversation) {
    val lines = JSONArray()
    for (l in c.lines) {
      lines.put(
        JSONObject()
          .put("id", l.id ?: "")
          .put("sender", l.sender)
          .put("key", l.senderKey ?: "")
          .put("text", l.text)
          .put("at", l.at)
          .put("self", l.self),
      )
    }
    val o = JSONObject()
      .put("title", c.title ?: "")
      .put("group", c.group)
      .put("grant", c.grant ?: "")
      .put("hidden", c.hidden)
      .put("lines", lines)
    prefs(context).edit().putString(key(c.id), o.toString()).apply()
  }
}

/**
 * Reply / Mark as read, tapped on a message notification. Posts to the
 * notification-action endpoints with the conversation's reply grant —
 * no app, no session — on a background thread kept alive by goAsync().
 */
class MessageActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val conversationId = intent.getStringExtra(MessageNotifications.EXTRA_CONVERSATION) ?: return
    val app = context.applicationContext
    val grant = MessageNotifications.grantFor(app, conversationId)
    val base = CallCore.apiBaseUrl(app)

    when (intent.action) {
      MessageNotifications.ACTION_REPLY -> {
        val text = RemoteInput.getResultsFromIntent(intent)
          ?.getCharSequence(MessageNotifications.KEY_REPLY)?.toString()?.trim().orEmpty()
        if (text.isEmpty() || grant == null || base == null) return
        val pending = goAsync()
        Thread {
          val body = JSONObject().put("body", text).put("id", UUID.randomUUID().toString())
          val ok = post("$base/v1/notifications/reply", grant, body)
          MessageNotifications.onReplied(app, conversationId, text, ok)
          pending.finish()
        }.start()
      }
      MessageNotifications.ACTION_READ -> {
        // Optimistic: the notification goes now; the server catches up.
        MessageNotifications.clear(app, conversationId)
        if (grant == null || base == null) return
        val pending = goAsync()
        Thread {
          post("$base/v1/notifications/read", grant, JSONObject())
          pending.finish()
        }.start()
      }
    }
  }

  private fun post(url: String, grant: String, body: JSONObject): Boolean = runCatching {
    val request = Request.Builder()
      .url(url)
      .header("Authorization", "Bearer $grant")
      .post(body.toString().toRequestBody("application/json".toMediaType()))
      .build()
    CallHttpClient.defaultClient().newCall(request).execute().use { it.isSuccessful }
  }.onFailure { Log.w("PoolseMessages", "notification action failed", it) }.getOrDefault(false)
}
