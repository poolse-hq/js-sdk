package dev.poolse.callcore.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import dev.poolse.callcore.RingContext
import dev.poolse.callcore.RingSurfacePort

/**
 * The incoming-call UX: a CallStyle notification with a full-screen
 * intent, so a locked phone lights up with a call screen the way the
 * dialer does, plus the ringtone and the caller's ringback.
 *
 * Tones are owned here, not delegated to react-native-incall-manager,
 * whose stream handling without its full lifecycle played the ringback
 * on the loudspeaker and the ringtone in the earpiece. Both players use
 * explicit [AudioAttributes]: ringtone on the ringtone stream (loud,
 * speaker), ringback on voice-communication (quiet, follows the call
 * route).
 *
 * Tap actions resolve to broadcasts handled by [CallActionReceiver],
 * which forwards into the single native entry point so that notification
 * button, full-screen button and app-closed cold-launch all funnel to
 * one place.
 */
internal class AndroidRingSurface(
  private val context: Context,
  private val config: RingSurfaceConfig,
) : RingSurfacePort {

  private var ringtone: Ringtone? = null
  private var ringback: MediaPlayer? = null

  override fun show(ring: RingContext) {
    ensureChannel()
    val extras = ring.toBundle()

    fun actionPending(action: String, requestOffset: Int): PendingIntent {
      val intent = Intent(context, CallActionReceiver::class.java)
        .setAction("$ACTION_PREFIX.$action")
        .putExtra(EXTRA_RING, extras)
      return PendingIntent.getBroadcast(
        context,
        ring.callId.hashCode() + requestOffset,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    val fullScreen = PendingIntent.getActivity(
      context,
      ring.callId.hashCode(),
      Intent(context, IncomingCallActivity::class.java)
        .putExtra(EXTRA_RING, extras)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val caller = Person.Builder()
      .setName(ring.conversationName ?: ring.callerName ?: "Incoming call")
      .setImportant(true)
      .build()

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(config.smallIcon)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setFullScreenIntent(fullScreen, true)
      .setStyle(
        NotificationCompat.CallStyle.forIncomingCall(
          caller,
          actionPending(ACTION_DECLINE, 1),
          actionPending(ACTION_ANSWER, 2),
        ),
      )
      .build()

    runCatching {
      NotificationManagerCompat.from(context).notify(ring.callId.notificationId(), notification)
    }
  }

  override fun dismiss(callId: String) {
    NotificationManagerCompat.from(context).cancel(callId.notificationId())
  }

  override fun ringtoneStart() {
    ringtoneStop()
    runCatching {
      val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE) ?: return
      ringtone = RingtoneManager.getRingtone(context, uri)?.apply {
        audioAttributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) isLooping = true
        play()
      }
    }
  }

  override fun ringtoneStop() {
    runCatching { ringtone?.stop() }
    ringtone = null
  }

  override fun ringbackStart() {
    ringbackStop()
    val resId = config.ringbackRawRes
    if (resId == 0) return
    runCatching {
      ringback = MediaPlayer.create(
        context,
        resId,
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build(),
        /* audioSessionId = */ 0,
      )?.apply {
        isLooping = true
        start()
      }
    }
  }

  override fun ringbackStop() {
    runCatching {
      ringback?.stop()
      ringback?.release()
    }
    ringback = null
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    // Silent channel: the ringtone is ours (looping, controllable). A
    // channel sound on top would double-ring and could not be stopped
    // the instant the ring resolves.
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
        setSound(null, null)
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 400, 300, 400)
        lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
      },
    )
  }

  companion object {
    const val CHANNEL_ID = "poolse_incoming_calls"
    const val ACTION_PREFIX = "dev.poolse.callcore.action"
    const val ACTION_ANSWER = "ANSWER"
    const val ACTION_DECLINE = "DECLINE"
    const val ACTION_OPEN = "OPEN"
    const val EXTRA_RING = "poolse_ring"

    /** Stable per-call notification id, so teardown targets the right one. */
    fun String.notificationId(): Int = hashCode()
  }
}

/** Host-supplied, platform-specific bits the core cannot know. */
data class RingSurfaceConfig(
  val smallIcon: Int,
  /** `R.raw.incallmanager_ringback`, or 0 to fall back to silence. */
  val ringbackRawRes: Int,
)
