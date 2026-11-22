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

/**
 * Scheduled-meeting notices (server docs/MEETINGS.md §11.3), posted natively
 * from the FCM data push `type: "meeting"` so they show with the app
 * closed: `event: "starting"` ("Weekly sync is starting  [Join]") and
 * `event: "brief"` (the agenda and who's coming, a few minutes before).
 *
 * The tap and Join open the app through its launch activity, carrying the
 * action in [MissedCallNotification]'s extras — the same `CallAction`
 * plumbing: `takeCallAction()` on a cold start, `onCallAction` while
 * running. A tap is `open` (the conversation), Join is `join_meeting`; the
 * app joins the room with the user's session (only it has one), so Join
 * never connects from here.
 *
 * One notification per meeting: `starting` replaces that meeting's brief,
 * and a repeat of the same event is not alerted again.
 */
object MeetingNotification {
  const val CHANNEL_ID = "poolse_meetings"
  /** The scheduled meeting the action is for, beside [MissedCallNotification]'s extras. */
  const val EXTRA_SCHEDULED_MEETING_ID = "poolse_call_action_meeting"
  const val ACTION_JOIN = "join_meeting"
  private const val TAG = "PoolseMeeting"

  // A notice FCM held while the phone was off is about a meeting long over.
  private const val STALE_MS = 6 * 60 * 60 * 1000L

  /** Event + meeting already shown, so a redelivered push is not posted twice. */
  private val shown = java.util.Collections.synchronizedSet(LinkedHashSet<String>())

  fun show(context: Context, data: Map<String, String>, smallIcon: Int) {
    val meetingId = data["scheduled_meeting_id"]?.ifBlank { null } ?: return
    val conversationId = data["conversation_id"]?.ifBlank { null } ?: return
    val event = data["event"] ?: return
    if (event != "starting" && event != "brief") return
    val sentAt = data["sent_at"]?.toLongOrNull()
    if (sentAt != null && System.currentTimeMillis() - sentAt > STALE_MS) return
    if (!shown.add("$meetingId:$event")) return
    if (shown.size > 64) shown.iterator().let { it.next(); it.remove() }

    val callId = data["call_id"]?.ifBlank { null }
    val media = if (data["media"] == "video") "video" else "audio"
    val name = data["conversation_name"]?.ifBlank { null }
    val title = data["title"]?.ifBlank { null }
      ?: if (event == "starting") "${name ?: "Your meeting"} is starting" else name ?: "Meeting soon"
    val body = data["body"]?.ifBlank { null }
    val servers = ServerRegistry.servers(context)
    val server = servers.resolve(data["tenant_id"]?.ifBlank { null })
    // Several workspaces signed in: say which one it is in.
    val workspace = servers.workspaceLabel(server?.id, data["workspace_name"])

    ensureChannel(context)
    val id = notificationId(meetingId)

    fun launch(action: String, requestOffset: Int): PendingIntent? {
      val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra(MissedCallNotification.EXTRA_ACTION, action)
        .putExtra(MissedCallNotification.EXTRA_CONVERSATION_ID, conversationId)
        .putExtra(MissedCallNotification.EXTRA_CALL_ID, callId)
        .putExtra(MissedCallNotification.EXTRA_MEDIA, media)
        .putExtra(MissedCallNotification.EXTRA_SERVER_ID, server?.id)
        .putExtra(EXTRA_SCHEDULED_MEETING_ID, meetingId)
      return PendingIntent.getActivity(
        context,
        id + requestOffset,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon)
      .setContentTitle(title)
      .setCategory(NotificationCompat.CATEGORY_EVENT)
      .setPriority(
        if (event == "starting") NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT,
      )
      .setAutoCancel(true)
      .setWhen(sentAt ?: System.currentTimeMillis())
      .setShowWhen(true)
      .apply {
        if (body != null) {
          setContentText(body)
          setStyle(NotificationCompat.BigTextStyle().bigText(body))
        }
        if (workspace != null) setSubText(workspace)
      }
    launch(MissedCallNotification.ACTION_OPEN, 0)?.let(builder::setContentIntent)
    if (event == "starting") launch(ACTION_JOIN, 1)?.let { builder.addAction(0, "Join", it) }

    try {
      NotificationManagerCompat.from(context).notify(id, builder.build())
    } catch (e: SecurityException) {
      Log.w(TAG, "meeting notification refused (POST_NOTIFICATIONS?)", e)
    }
  }

  /** Clear it once the user acted on it from the app (its buttons do not auto-cancel). */
  fun cancel(context: Context, meetingId: String) {
    runCatching { NotificationManagerCompat.from(context).cancel(notificationId(meetingId)) }
  }

  private fun notificationId(meetingId: String) = ("meeting:$meetingId").hashCode()

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Meetings", NotificationManager.IMPORTANCE_HIGH).apply {
        lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
      },
    )
  }
}
