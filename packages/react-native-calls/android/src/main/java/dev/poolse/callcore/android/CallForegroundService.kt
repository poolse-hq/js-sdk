package dev.poolse.callcore.android

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import dev.poolse.callcore.CallSessionPort

/**
 * Keeps a live call alive when the app is backgrounded or killed:
 * a `phoneCall|microphone` foreground service that owns the ongoing
 * notification for the call's whole lifetime. Android will not reclaim
 * the process while this runs, so media keeps flowing with the screen
 * off.
 *
 * [CallSessionPort] is driven by the runtime (CALL_SESSION_START/STOP);
 * the service itself holds no call logic — it is the OS contract that
 * says "a call is happening here".
 */
class CallForegroundService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

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

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val media = intent?.getStringExtra(EXTRA_MEDIA) ?: "audio"
    startInForeground(media)
    // Sticky-less: if the system kills us, the call is already gone with
    // the process; a relaunched empty service would be a ghost.
    return START_NOT_STICKY
  }

  private fun startInForeground(media: String) {
    ensureChannel()
    val config = CallCore.peekConfig()
    val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(config?.smallIcon ?: android.R.drawable.sym_call_outgoing)
      .setContentTitle("Ongoing call")
      .setContentText(if (media == "video") "Video call" else "Voice call")
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
      }
      startForeground(NOTIFICATION_ID, notification, type)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  companion object : CallSessionPort {
    private const val NOTIFICATION_ID = 0x9C0FE
    private const val EXTRA_MEDIA = "media"
    private const val CHANNEL_ID = "poolse_ongoing_call"

    private lateinit var appContext: Context

    /** Wired once by [CallCore] so the port can start/stop the service. */
    fun attach(context: Context) { appContext = context.applicationContext }

    override fun start(callId: String, media: String) {
      val intent = Intent(appContext, CallForegroundService::class.java).putExtra(EXTRA_MEDIA, media)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        appContext.startForegroundService(intent)
      } else {
        appContext.startService(intent)
      }
    }

    override fun stop() {
      appContext.stopService(Intent(appContext, CallForegroundService::class.java))
    }
  }
}
