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
import android.util.Log
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
 * route). The ringback waits for [setCommunicationReady]: before the
 * SFU's audio handler has switched the device into communication mode,
 * a voice-communication stream still routes to the loudspeaker — the
 * "ringback blares from the speaker" bug.
 *
 * Tap actions resolve to broadcasts handled by [CallActionReceiver],
 * which forwards into the single native entry point so that notification
 * button, full-screen button and app-closed cold-launch all funnel to
 * one place.
 */
internal class AndroidRingSurface(
  private val context: Context,
  /** Read per use, so a re-configure (icon, ringback) applies at once. */
  private val configOf: () -> RingSurfaceConfig,
) : RingSurfacePort {

  private val config get() = configOf()

  private var ringtone: Ringtone? = null
  private var ringback: MediaPlayer? = null
  private var ringbackWanted = false
  private var communicationReady = false

  /**
   * The call's audio path is (or is no longer) in communication mode.
   * A ringback requested earlier starts now, through the call route.
   */
  fun setCommunicationReady(ready: Boolean) {
    communicationReady = ready
    if (ready && ringbackWanted && ringback == null) playRingback()
  }

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

    fun incomingActivity(autoAnswer: Boolean, requestOffset: Int): PendingIntent {
      val intent = Intent(context, IncomingCallActivity::class.java)
        .putExtra(EXTRA_RING, extras)
        .putExtra(EXTRA_AUTO_ANSWER, autoAnswer)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      return PendingIntent.getActivity(
        context,
        ring.callId.hashCode() + requestOffset,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    val fullScreen = incomingActivity(autoAnswer = false, requestOffset = 0)

    // Answer launches an ACTIVITY, not a broadcast: a background receiver
    // cannot start an activity (Android 10+), so answering from the
    // notification used to connect audio while the app stayed hidden. An
    // activity launched from a notification tap is allowed to come
    // forward — it answers and brings the app up. Decline stays a
    // broadcast; it needs no UI.
    val answer = incomingActivity(autoAnswer = true, requestOffset = 2)

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
      // Tapping the heads-up (not a button) opens the ring screen too;
      // without this the tap did nothing.
      .setContentIntent(fullScreen)
      .setStyle(
        NotificationCompat.CallStyle.forIncomingCall(
          caller,
          actionPending(ACTION_DECLINE, 1),
          answer,
        ),
      )
      .build()

    try {
      NotificationManagerCompat.from(context).notify(ring.callId.notificationId(), notification)
    } catch (e: SecurityException) {
      // POST_NOTIFICATIONS denied: the ringtone still plays, but there is
      // no surface. Loud in the log — this is a support question.
      Log.e(TAG, "ring notification refused (POST_NOTIFICATIONS?)", e)
    }
  }

  override fun dismiss(callId: String) {
    runCatching { NotificationManagerCompat.from(context).cancel(callId.notificationId()) }
    // The full-screen activity is its own window: tell it to close.
    runCatching {
      context.sendBroadcast(
        Intent(ACTION_RING_CLOSED).setPackage(context.packageName).putExtra(EXTRA_CALL_ID, callId),
      )
    }
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
    ringbackWanted = true
    if (communicationReady) playRingback()
  }

  private fun playRingback() {
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
    ringbackWanted = false
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
    const val EXTRA_AUTO_ANSWER = "poolse_auto_answer"
    /** Package-local broadcast: the ring for [EXTRA_CALL_ID] is over. */
    const val ACTION_RING_CLOSED = "dev.poolse.callcore.RING_CLOSED"
    const val EXTRA_CALL_ID = "poolse_call_id"
    private const val TAG = "PoolseRingSurface"

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
