package dev.poolse.callcore.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import org.json.JSONArray
import org.json.JSONObject

/**
 * Chat notifications on Android (CALL_CONTRACT.md §5.5), WhatsApp-style.
 *
 * One notification per conversation, in MessagingStyle: each new message
 * becomes a line in it ("Ana: on my way") rather than a new card, and a
 * group summary collects every chat. Reply (inline text) and Mark as
 * read run natively, authorized by the reply grant the push carried, so
 * they work with the app killed and the phone locked.
 *
 * The HTTP side ([MessageActionWorker]) runs in WorkManager, so a reply
 * typed with no signal, or into a process Android kills a second later,
 * still goes out — with the same idempotency id on every retry.
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
  private const val ACTIONS_PREFS = "dev.poolse.messages.actions"
  private const val MAX_PENDING_ACTIONS = 50
  private const val META_REPLY_UNLOCK = "dev.poolse.messages.reply_requires_unlock"

  // A message notification that waited this long for the phone to come
  // online is history.
  private const val STALE_MS = 24 * 60 * 60 * 1000L

  /**
   * The conversation on screen in the app, set by the host. Its messages
   * are not notified — the user is reading them.
   */
  @Volatile var activeConversationId: String? = null

  /** The bridge's subscriber for finished Reply / Mark as read actions. */
  @Volatile var actionListener: ((Map<String, Any?>) -> Unit)? = null

  /**
   * True while JS has an `onNotificationAction` subscriber; until then
   * results queue, even with the bridge observing other events.
   */
  @Volatile var actionsObserved = false

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

  /**
   * A `type: "message", event: "read"` push: read on some device (maybe
   * this one, after a Reply or Mark as read). Launcher badges follow the
   * notifications' numbers, so dropping the conversation's is the badge
   * update; `unread_total` has no Android API to go to.
   */
  fun onRead(context: Context, data: Map<String, String>) {
    val conversationId = data["conversation_id"] ?: return
    clear(context, conversationId)
  }

  /** The conversation was read (here, or on another device): clear it. */
  fun clear(context: Context, conversationId: String) {
    prefs(context).edit().remove(key(conversationId)).apply()
    runCatching { NotificationManagerCompat.from(context).cancel(notificationId(conversationId)) }
    refreshSummary(context, CallCore.smallIcon(context))
  }

  /** Repost a conversation's notification as it is, silently. */
  internal fun refresh(context: Context, conversationId: String) {
    val state = load(context, conversationId) ?: return
    post(context, state, CallCore.smallIcon(context), alert = false)
  }

  /**
   * Reply tapped: show the user's line at once ("Sending…") — Android
   * keeps the reply field spinning until the notification is updated.
   */
  internal fun onReplying(context: Context, conversationId: String, clientId: String, text: String) {
    val state = load(context, conversationId) ?: Conversation(conversationId)
    state.lines.removeAll { it.self && it.id == clientId }
    state.lines += Line(
      id = clientId,
      sender = "You",
      senderKey = null,
      text = text,
      at = System.currentTimeMillis(),
      self = true,
      status = STATUS_SENDING,
    )
    while (state.lines.size > MAX_LINES) state.lines.removeAt(0)
    save(context, state)
    post(context, state, CallCore.smallIcon(context), alert = false)
  }

  /**
   * The reply's outcome. Sent: the line stays (the server's read-sync
   * push then clears the conversation — replying is reading). Failed:
   * the line reads "Not sent", with why underneath, and the
   * notification alerts again; Reply stays on it to try again.
   */
  internal fun onReplied(context: Context, conversationId: String, clientId: String, text: String, ok: Boolean, reason: String?, grant: String?) {
    val state = load(context, conversationId) ?: if (ok) return else Conversation(conversationId, grant = grant)
    val index = state.lines.indexOfFirst { it.self && it.id == clientId }
    val line = Line(
      id = clientId,
      sender = "You",
      senderKey = null,
      text = text,
      at = if (index >= 0) state.lines[index].at else System.currentTimeMillis(),
      self = true,
      status = if (ok) STATUS_SENT else STATUS_FAILED,
    )
    if (index >= 0) state.lines[index] = line else state.lines += line
    while (state.lines.size > MAX_LINES) state.lines.removeAt(0)
    state.failure = if (ok) null else reason
    save(context, state)
    post(context, state, CallCore.smallIcon(context), alert = !ok)
  }

  internal const val STATUS_SENDING = "sending"
  internal const val STATUS_SENT = "sent"
  internal const val STATUS_FAILED = "failed"

  // ── JS events ───────────────────────────────────────────────────────

  /** A finished action, to JS: live when the bridge listens, else queued on disk. */
  internal fun report(context: Context, event: Map<String, Any?>) {
    val full = event + ("at" to System.currentTimeMillis())
    val listener = actionListener.takeIf { actionsObserved }
    if (listener != null && runCatching { listener(full) }.isSuccess) return
    val p = context.applicationContext.getSharedPreferences(ACTIONS_PREFS, Context.MODE_PRIVATE)
    synchronized(this) {
      val queue = runCatching { JSONArray(p.getString("queue", "[]")) }.getOrDefault(JSONArray())
      queue.put(JSONObject(full.filterValues { it != null }))
      val trimmed = JSONArray()
      for (i in maxOf(0, queue.length() - MAX_PENDING_ACTIONS) until queue.length()) trimmed.put(queue.get(i))
      p.edit().putString("queue", trimmed.toString()).apply()
    }
  }

  /** The queued actions, oldest first, removed. */
  fun takePendingActions(context: Context): List<Map<String, Any?>> {
    val p = context.applicationContext.getSharedPreferences(ACTIONS_PREFS, Context.MODE_PRIVATE)
    val raw = synchronized(this) {
      p.getString("queue", null).also { p.edit().remove("queue").apply() }
    } ?: return emptyList()
    val queue = runCatching { JSONArray(raw) }.getOrNull() ?: return emptyList()
    return List(queue.length()) { i ->
      val o = queue.getJSONObject(i)
      o.keys().asSequence().associateWith { k -> o.get(k).takeUnless { it == JSONObject.NULL } }
    }
  }

  private fun replyRequiresUnlock(context: Context): Boolean = runCatching {
    context.packageManager
      .getApplicationInfo(context.packageName, android.content.pm.PackageManager.GET_META_DATA)
      .metaData?.getBoolean(META_REPLY_UNLOCK, false) ?: false
  }.getOrDefault(false)

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
      val text = if (line.self && line.status == STATUS_FAILED) "Not sent: ${line.text}" else line.text
      style.addMessage(NotificationCompat.MessagingStyle.Message(text, line.at, person))
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
    when {
      state.failure != null -> builder.setSubText(state.failure)
      state.lines.lastOrNull()?.let { it.self && it.status == STATUS_SENDING } == true -> builder.setSubText("Sending…")
    }
    openIntent(context, state.id, id)?.let(builder::setContentIntent)

    if (state.grant != null) {
      val remoteInput = RemoteInput.Builder(KEY_REPLY).setLabel("Message").build()
      val reply = NotificationCompat.Action.Builder(0, "Reply", actionIntent(context, ACTION_REPLY, state.id, id + 1, mutable = true))
        .addRemoteInput(remoteInput)
        .setAllowGeneratedReplies(true)
        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
        .setShowsUserInterface(false)
        .setAuthenticationRequired(replyRequiresUnlock(context))
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
    /** The user's own replies: sending | sent | failed (`id` is the reply's client id). */
    val status: String? = null,
  )

  internal class Conversation(
    val id: String,
    var title: String? = null,
    var group: Boolean = false,
    var grant: String? = null,
    val lines: MutableList<Line> = mutableListOf(),
    var hidden: Boolean = false,
    /** Why the last reply was not sent, shown under the conversation. */
    var failure: String? = null,
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
        failure = o.optString("failure").ifBlank { null },
        lines = MutableList(lines.length()) { i ->
          val l = lines.getJSONObject(i)
          Line(
            id = l.optString("id").ifBlank { null },
            sender = l.optString("sender"),
            senderKey = l.optString("key").ifBlank { null },
            text = l.optString("text"),
            at = l.optLong("at"),
            self = l.optBoolean("self"),
            status = l.optString("status").ifBlank { null },
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
          .put("self", l.self)
          .put("status", l.status ?: ""),
      )
    }
    val o = JSONObject()
      .put("title", c.title ?: "")
      .put("group", c.group)
      .put("grant", c.grant ?: "")
      .put("hidden", c.hidden)
      .put("failure", c.failure ?: "")
      .put("lines", lines)
    prefs(context).edit().putString(key(c.id), o.toString()).apply()
  }
}
