package dev.poolse.callcore.android

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import dev.poolse.callcore.CallSessionPort

/**
 * Keeps the process alive while a call needs it:
 *
 * - **ring** mode (`phoneCall` type only) for the length of an incoming
 *   ring, so an OEM freezer (Samsung, Android 14 cached-app freezer)
 *   does not kill the ringtone and the ring-deadline timer of a closed
 *   app;
 * - **call** mode (`phoneCall|microphone`) for a live call's whole
 *   lifetime, so media keeps flowing with the screen off.
 *
 * [CallSessionPort] is driven by the runtime (CALL_SESSION_START/STOP),
 * ring mode by [CallCore]'s state reconcile; the service itself holds no
 * call logic — it is the OS contract that says "a call is happening".
 *
 * Robustness rules, each one a crash seen in the field:
 * - every `startForegroundService` MUST be answered by `startForeground`,
 *   even if the call already ended before `onStartCommand` ran — so a
 *   stop never calls `stopService` on a not-yet-started service; the
 *   service starts foreground and then stops itself;
 * - the microphone type is claimed only with RECORD_AUDIO granted
 *   (Android 14 throws otherwise);
 * - `startForeground` failures are caught and the service stops, never
 *   taking the app down with it.
 */
class CallForegroundService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    pendingStarts = (pendingStarts - 1).coerceAtLeast(0)
    reconcile(desired)
    // Sticky-less: if the system kills us, the call is already gone with
    // the process; a relaunched empty service would be a ghost.
    return START_NOT_STICKY
  }

  /** Bring the service in line with [want]; null = stop (after honouring the start). */
  internal fun reconcile(want: Desired?) {
    // Always answer the start with startForeground — a placeholder ring
    // notification if the call is already gone.
    val ok = tryStartForeground(want ?: Desired(Mode.RING, "", "audio"))
    if (want == null || !ok) {
      if (pendingStarts == 0) stopNow()
    }
  }

  internal fun stopNow() {
    runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
    shownId = null
    stopSelf()
  }

  /** The notification id we are currently foreground with. */
  private var shownId: Int? = null

  /**
   * Start (or switch) foreground. If the full type is refused — the
   * microphone type can be, on Android 14, when the app is not in a
   * while-in-use state — fall back to phoneCall only rather than stop:
   * stopping dropped the ring-mode service that was already working.
   * Stop only when even that fails.
   */
  private fun tryStartForeground(want: Desired): Boolean {
    val (id, notification) = notificationFor(want)
    val full = typeFor(want.mode)
    val attempts = if (full != ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL) {
      listOf(full, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
    } else listOf(full)
    for (type in attempts) {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(id, notification, type)
        else startForeground(id, notification)
        // Switching id (ring → call) leaves the old one as a plain
        // notification; the ring is over, so remove it.
        shownId?.takeIf { it != id }?.let { old ->
          runCatching { getSystemService(android.app.NotificationManager::class.java).cancel(old) }
        }
        shownId = id
        return true
      } catch (t: Throwable) {
        // ForegroundServiceStartNotAllowedException, SecurityException
        // (missing type permission), InvalidForegroundServiceTypeException…
        Log.e(TAG, "startForeground(${want.mode}, type=$type) failed", t)
      }
    }
    return false
  }

  /**
   * Ring mode wears the CallStyle ring notification itself (same id),
   * so a ringing phone shows ONE notification, not the ring plus an
   * "Incoming call" service notice. Falls back to our own if the ring
   * surface has not posted yet.
   */
  private fun notificationFor(want: Desired): Pair<Int, Notification> {
    if (want.mode == Mode.RING) {
      AndroidRingSurface.shownRing?.let { (callId, n) ->
        if (callId == want.callId) {
          return with(AndroidRingSurface) { callId.notificationId() } to n
        }
      }
    }
    return NOTIFICATION_ID to buildNotification(want)
  }

  private fun typeFor(mode: Mode): Int {
    var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
    if (mode == Mode.CALL && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && micGranted()) {
      type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    }
    return type
  }

  private fun micGranted() =
    ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  private fun buildNotification(want: Desired): Notification {
    ensureChannel()
    val config = CallCore.peekConfig()
    val title: String
    val text: String
    if (want.mode == Mode.RING) {
      title = "Incoming call"; text = "Ringing…"
    } else {
      title = "Ongoing call"; text = if (want.media == "video") "Video call" else "Voice call"
    }
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(config?.smallIcon ?: android.R.drawable.sym_call_outgoing)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_LOW)
    // Tapping the ongoing-call notification returns to the call.
    if (want.mode == Mode.CALL) launchIntent(want.callId)?.let(builder::setContentIntent)
    return builder.build()
  }

  private fun launchIntent(callId: String): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    launch.putExtra(CallCore.EXTRA_LAUNCH_CALL, callId)
    return PendingIntent.getActivity(
      this,
      NOTIFICATION_ID,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  // The ongoing-call notification has its own channel, created here so it
  // exists on an OUTGOING call too — the incoming ring surface's channel
  // is only made when a ring shows, so a placed call would otherwise post
  // to a missing channel and startForeground would crash.
  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(android.app.NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      android.app.NotificationChannel(
        CHANNEL_ID,
        "Ongoing calls",
        android.app.NotificationManager.IMPORTANCE_LOW,
      ).apply { setSound(null, null) },
    )
  }

  internal enum class Mode { RING, CALL }
  internal data class Desired(val mode: Mode, val callId: String, val media: String)

  /**
   * All companion state is touched on the main thread only (the
   * runtime's thread and the service lifecycle's), so no locking.
   */
  companion object : CallSessionPort {
    private const val TAG = "PoolseCallFgs"
    private const val NOTIFICATION_ID = 0x9C0FE
    private const val CHANNEL_ID = "poolse_ongoing_call"

    private lateinit var appContext: Context
    private val main by lazy { Handler(Looper.getMainLooper()) }

    private var desired: Desired? = null
    private var instance: CallForegroundService? = null
    /** startForegroundService calls not yet delivered to onStartCommand. */
    private var pendingStarts = 0

    /** Wired once by [CallCore] so the port can start/stop the service. */
    fun attach(context: Context) { appContext = context.applicationContext }

    override fun start(callId: String, media: String) = onMain {
      desired = Desired(Mode.CALL, callId, media)
      launchOrSwitch()
    }

    override fun stop() = onMain {
      desired = null
      // Deferred to the end of this main-thread turn: a call handing over
      // to the next (call waiting: end & answer, or a promoted ring) stops
      // and starts in one dispatch, and must switch the RUNNING service
      // in place — a fresh start from the background is refused on
      // Android 12+ (and loses the microphone type on 14+). A start in
      // the same turn sets `desired` again and this does nothing.
      main.post {
        // Only a started instance with nothing pending may stop now; a
        // pending start stops itself after startForeground.
        if (desired == null && pendingStarts == 0) instance?.stopNow()
      }
    }

    /** Ring mode for [callId]; a no-op while a call holds the service. */
    fun startRing(callId: String) = onMain {
      val d = desired
      if (d?.mode == Mode.CALL) return@onMain
      if (d?.mode == Mode.RING && d.callId == callId) return@onMain
      desired = Desired(Mode.RING, callId, "audio")
      launchOrSwitch()
    }

    /**
     * The call's media became known/changed (a join's bundle said video):
     * refresh the notification and type in place — no new start needed.
     */
    fun updateCall(callId: String, media: String) = onMain {
      val d = desired
      if (d?.mode != Mode.CALL || (d.callId == callId && d.media == media)) return@onMain
      desired = d.copy(callId = callId, media = media)
      if (pendingStarts == 0) instance?.reconcile(desired)
    }

    /** Leave ring mode — never touches a call that took the service over. */
    fun stopRing() = onMain {
      if (desired?.mode == Mode.RING) stop()
    }

    /** A running, settled instance switches in place; otherwise start one. */
    private fun launchOrSwitch() {
      val running = instance
      if (running != null && pendingStarts == 0) running.reconcile(desired) else launch()
    }

    private fun launch() {
      if (!::appContext.isInitialized) return
      val intent = Intent(appContext, CallForegroundService::class.java)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          appContext.startForegroundService(intent)
        } else {
          appContext.startService(intent)
        }
        pendingStarts++
      } catch (t: Throwable) {
        // Background-start restriction (no FCM/user exemption at hand).
        // A running instance can still switch type in place.
        Log.w(TAG, "could not start the call service", t)
        instance?.reconcile(desired)
      }
    }

    private inline fun onMain(crossinline block: () -> Unit) {
      if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post { block() }
    }
  }
}
