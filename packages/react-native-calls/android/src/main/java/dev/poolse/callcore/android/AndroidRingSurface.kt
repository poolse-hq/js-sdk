package dev.poolse.callcore.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
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

  /** The call waiting beside the current one, while its surface is up. */
  private var waitingCallId: String? = null
  private var waitingTone: ToneGenerator? = null
  private val main = Handler(Looper.getMainLooper())
  private val waitingBeep = object : Runnable {
    override fun run() {
      if (waitingCallId == null) return
      runCatching { waitingTone?.startTone(ToneGenerator.TONE_SUP_CALL_WAITING, WAITING_BEEP_MS) }
      main.postDelayed(this, WAITING_BEEP_EVERY_MS)
    }
  }

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

    // The ring-mode foreground service adopts this exact notification.
    shownRing = ring.callId to notification
    try {
      NotificationManagerCompat.from(context).notify(ring.callId.notificationId(), notification)
    } catch (e: SecurityException) {
      // POST_NOTIFICATIONS denied: the ringtone still plays, but there is
      // no surface. Loud in the log — this is a support question.
      Log.e(TAG, "ring notification refused (POST_NOTIFICATIONS?)", e)
    }
  }

  /**
   * A call waiting beside the one in progress: a quiet heads-up — not
   * the full-screen ring, which would cover the call — with Decline and
   * End & answer, and the call-waiting beep through the call's own
   * audio route (the ringtone would blare over the conversation).
   */
  override fun showWaiting(ring: RingContext) {
    ensureWaitingChannel()
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

    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
      PendingIntent.getActivity(
        context,
        ring.callId.hashCode() + 5,
        it.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    // End & answer launches an ACTIVITY, like the ring's Answer: only an
    // activity started from the tap may bring the app forward (Android
    // 10+), and the call that connects should be seen.
    val answerWaiting = PendingIntent.getActivity(
      context,
      ring.callId.hashCode() + 4,
      Intent(context, IncomingCallActivity::class.java)
        .putExtra(EXTRA_RING, extras)
        .putExtra(EXTRA_WAITING_ANSWER, true)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val who = ring.conversationName ?: ring.callerName ?: "Someone"
    val what = if (ring.media == "video") "video call" else "call"
    val notification = NotificationCompat.Builder(context, WAITING_CHANNEL_ID)
      .setSmallIcon(config.smallIcon)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentTitle("$who — incoming $what")
      .setContentText("You're on a call. Answering ends it.")
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)
      .apply { if (open != null) setContentIntent(open) }
      .addAction(0, "Decline", actionPending(ACTION_WAITING_DECLINE, 3))
      .addAction(0, "End & answer", answerWaiting)
      // Never outlive the ring: if its ring_ended/finished push is lost,
      // the system takes the heads-up down at the deadline anyway.
      .setTimeoutAfter((ring.ringDeadlineEpochMs - System.currentTimeMillis()).coerceAtLeast(10_000L))
      .build()

    waitingCallId = ring.callId
    try {
      NotificationManagerCompat.from(context).notify(ring.callId.notificationId(), notification)
    } catch (e: SecurityException) {
      Log.e(TAG, "call-waiting notification refused (POST_NOTIFICATIONS?)", e)
    }
    startWaitingBeep()
  }

  override fun dismissWaiting(callId: String) {
    if (waitingCallId != callId) return
    stopWaitingBeep()
    runCatching { NotificationManagerCompat.from(context).cancel(callId.notificationId()) }
  }

  /** SHOW_RING follows, reposting under the same id as the full ring. */
  override fun promoteWaiting(callId: String) = dismissWaiting(callId)

  private fun startWaitingBeep() {
    main.removeCallbacks(waitingBeep)
    if (waitingTone == null) {
      waitingTone = runCatching { ToneGenerator(AudioManager.STREAM_VOICE_CALL, WAITING_BEEP_VOLUME) }.getOrNull()
    }
    main.post(waitingBeep)
  }

  private fun stopWaitingBeep() {
    waitingCallId = null
    main.removeCallbacks(waitingBeep)
    runCatching { waitingTone?.stopTone(); waitingTone?.release() }
    waitingTone = null
  }

  private fun ensureWaitingChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(WAITING_CHANNEL_ID) != null) return
    // Silent: the beep is ours, through the call route. A channel sound
    // would play on the notification stream over the conversation.
    manager.createNotificationChannel(
      NotificationChannel(WAITING_CHANNEL_ID, "Calls while on a call", NotificationManager.IMPORTANCE_HIGH).apply {
        setSound(null, null)
        enableVibration(false)
        lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
      },
    )
  }

  override fun dismiss(callId: String) {
    // Every teardown for a call (ring_ended, finished) also ends its
    // waiting surface, even after a restart lost the in-memory state.
    if (waitingCallId == callId) stopWaitingBeep()
    if (shownRing?.first == callId) shownRing = null
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
    const val ACTION_WAITING_ANSWER = "WAITING_ANSWER"
    const val ACTION_WAITING_DECLINE = "WAITING_DECLINE"
    const val WAITING_CHANNEL_ID = "poolse_call_waiting"
    private const val WAITING_BEEP_MS = 400
    private const val WAITING_BEEP_EVERY_MS = 3_000L
    private const val WAITING_BEEP_VOLUME = 70
    const val EXTRA_RING = "poolse_ring"
    const val EXTRA_AUTO_ANSWER = "poolse_auto_answer"
    const val EXTRA_WAITING_ANSWER = "poolse_waiting_answer"
    /** Package-local broadcast: the ring for [EXTRA_CALL_ID] is over. */
    const val ACTION_RING_CLOSED = "dev.poolse.callcore.RING_CLOSED"
    const val EXTRA_CALL_ID = "poolse_call_id"
    private const val TAG = "PoolseRingSurface"

    /** The CallStyle notification on screen, for the ring-mode service to wear. */
    @Volatile internal var shownRing: Pair<String, android.app.Notification>? = null

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
