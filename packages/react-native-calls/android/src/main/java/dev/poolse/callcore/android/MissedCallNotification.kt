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
 * "Jasir — Missed voice call  [Call back]", posted natively from the
 * missed-call push (`event: "missed"`) so it shows with the app closed.
 *
 * Both the tap and Call back open the app through its launch activity,
 * carrying the action in extras ([EXTRA_ACTION] …). The bridge reads
 * them — `takeCallAction()` on a cold start, `onCallAction` while
 * running — and the host opens the conversation or places the call.
 * Placing needs the user's session, which only the app has; that is
 * why Call back does not dial from here.
 */
object MissedCallNotification {
  const val CHANNEL_ID = "poolse_missed_calls"
  const val EXTRA_ACTION = "poolse_call_action"
  const val EXTRA_CONVERSATION_ID = "poolse_call_action_conversation"
  const val EXTRA_CALL_ID = "poolse_call_action_call"
  const val EXTRA_MEDIA = "poolse_call_action_media"
  const val ACTION_OPEN = "open"
  const val ACTION_CALL_BACK = "call_back"
  private const val TAG = "PoolseMissedCall"

  // A missed call FCM held while the phone was off for days is history.
  private const val STALE_MS = 24 * 60 * 60 * 1000L

  fun show(context: Context, data: Map<String, String>, smallIcon: Int) {
    val callId = data["call_id"] ?: return
    val conversationId = data["conversation_id"] ?: return
    val sentAt = data["sent_at"]?.toLongOrNull()
    if (sentAt != null && System.currentTimeMillis() - sentAt > STALE_MS) return
    val media = if (data["media"] == "video") "video" else "audio"
    val title = data["title"]?.ifBlank { null }
      ?: data["caller_name"]?.ifBlank { null }
      ?: "Missed call"
    val body = data["body"]?.ifBlank { null }
      ?: if (media == "video") "Missed video call" else "Missed voice call"

    ensureChannel(context)
    val id = notificationId(callId)

    fun launch(action: String, requestOffset: Int): PendingIntent? {
      val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra(EXTRA_ACTION, action)
        .putExtra(EXTRA_CONVERSATION_ID, conversationId)
        .putExtra(EXTRA_CALL_ID, callId)
        .putExtra(EXTRA_MEDIA, media)
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
      .setContentText(body)
      .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setAutoCancel(true)
      .setWhen(sentAt ?: System.currentTimeMillis())
      .setShowWhen(true)
    launch(ACTION_OPEN, 0)?.let(builder::setContentIntent)
    launch(ACTION_CALL_BACK, 1)?.let { builder.addAction(0, "Call back", it) }

    try {
      NotificationManagerCompat.from(context).notify(id, builder.build())
    } catch (e: SecurityException) {
      Log.w(TAG, "missed-call notification refused (POST_NOTIFICATIONS?)", e)
    }
  }

  /** Clear it once the user acted on it from the app (its buttons do not auto-cancel). */
  fun cancel(context: Context, callId: String) {
    runCatching { NotificationManagerCompat.from(context).cancel(notificationId(callId)) }
  }

  private fun notificationId(callId: String) = ("missed:$callId").hashCode()

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Missed calls", NotificationManager.IMPORTANCE_DEFAULT).apply {
        lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
      },
    )
  }
}
