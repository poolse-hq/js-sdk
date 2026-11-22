package expo.modules.poolsecalls

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import dev.poolse.callcore.android.CallCore
import dev.poolse.callcore.android.MeetingNotification
import dev.poolse.callcore.android.MessageNotifications
import dev.poolse.callcore.android.MissedCallNotification
import dev.poolse.callcore.android.ServerRegistry
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The React Native face of the native call core. Deliberately thin: it
 * forwards commands to [CallCore] and streams snapshots out. All call
 * logic lives in the core; this class only crosses the JS boundary.
 *
 * `configure` is the single required setup call — the host passes the
 * API base URL; the icon and ringback resources are resolved by name so
 * the JS side needs no R references. The SFU factory defaults to the
 * shipped LiveKit adapter when present, else a no-op (audio-less), so a
 * build without the LiveKit source set still rings and signals.
 *
 * Nothing here throws before `configure`: reads return idle, commands
 * no-op (a fresh install renders its UI before JS has configured).
 */
class PoolseCallsModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("PoolseCalls")

    Events("onCallState", "onCallAction", "onPictureInPicture", "onNotificationAction")

    // <CallVideoView>: renders a participant's (or our own) camera.
    View(PoolseCallVideoView::class) {
      Name("PoolseCallVideo")
      Prop("participantId") { view: PoolseCallVideoView, id: String? -> view.participantId = id }
      Prop("local") { view: PoolseCallVideoView, local: Boolean? -> view.local = local ?: false }
      Prop("mirror") { view: PoolseCallVideoView, mirror: Boolean? -> view.mirror = mirror }
      Prop("fit") { view: PoolseCallVideoView, fit: String? -> view.fit = fit ?: "cover" }
      // `camera` (default) or `screen`: their shared screen instead of their face.
      Prop("source") { view: PoolseCallVideoView, source: String? -> view.source = source ?: "camera" }
      // iOS's picture-in-picture source; Android floats the whole activity.
      Prop("pictureInPicture") { _: PoolseCallVideoView, _: Boolean? -> }
      OnViewDestroys { view: PoolseCallVideoView -> view.detachSurface() }
    }

    // Snapshots → the single JS event. Null (idle) becomes an explicit
    // cleared payload so the JS side always has a definite state. The
    // listener is process-level, so subscribing before configure works.
    OnStartObserving {
      CallCore.listener = { snapshot -> sendEvent("onCallState", mapOf("snapshot" to snapshot)) }
      CallPictureInPicture.listener = { active -> sendEvent("onPictureInPicture", mapOf("active" to active)) }
      MessageNotifications.actionListener = { event -> sendEvent("onNotificationAction", event) }
    }
    OnStopObserving {
      CallCore.listener = null
      CallPictureInPicture.listener = null
      MessageNotifications.actionListener = null
    }

    // Picture-in-picture: armed while a video call shows someone. Android
    // 12+ enters by itself on Home; older versions enter here.
    Function("setPictureInPictureEnabled") { on: Boolean ->
      val activity = appContext.currentActivity
      activity?.runOnUiThread { CallPictureInPicture.setEnabled(activity, on) }
    }
    Function("isInPictureInPicture") { CallPictureInPicture.active }
    Function("pictureInPictureSupported") { CallPictureInPicture.supported(appContext.currentActivity) }
    OnUserLeavesActivity { CallPictureInPicture.onUserLeave(appContext.currentActivity) }
    OnActivityEntersForeground { CallPictureInPicture.refresh(appContext.currentActivity) }

    AsyncFunction("configure") { apiBaseUrl: String, options: Map<String, Any?>? ->
      val ctx = context ?: return@AsyncFunction null
      // Resource NAMES go to the core, which resolves + persists them —
      // so a killed app woken by a ring can rebuild this without JS.
      CallCore.configure(
        ctx,
        apiBaseUrl,
        options?.get("smallIcon") as? String,
        options?.get("ringback") as? String,
        options?.get("ringtone") as? String,
        (options?.get("incomingCall") as? Map<*, *>)
          ?.entries
          ?.associate { (k, v) -> k.toString() to (v as? String) }
          ?: emptyMap(),
      )
      // Materialise the core now, so a call already in flight (cold
      // answer) is visible to the first getCallState.
      CallCore.getOrNull(ctx)
      null
    }

    // Several workspaces: each server the app is signed in to. Persisted,
    // so a ring or a notification action with no JS finds its server.
    AsyncFunction("addServer") { server: Map<String, Any?> ->
      val ctx = context ?: return@AsyncFunction null
      val entry = ServerRegistry.fromMap(server) ?: return@AsyncFunction null
      CallCore.ensureConfigured(ctx)
      ServerRegistry.upsert(ctx, entry)
      CallCore.getOrNull(ctx)
      null
    }

    // Signed out of one workspace: forget it and take its notifications
    // down. A call in progress on it carries on to its end.
    AsyncFunction("removeServer") { id: String ->
      val ctx = context ?: return@AsyncFunction null
      MessageNotifications.removeServer(ctx, id)
      ServerRegistry.remove(ctx, id)
      null
    }

    Function("listServers") {
      context?.let { ctx -> ServerRegistry.servers(ctx).all.map(ServerRegistry::toMap) } ?: emptyList<Map<String, Any?>>()
    }

    // The server a push / notification of `tenantId` belongs to — the
    // same rule the native side routes rings and actions by.
    Function("serverForTenant") { tenantId: String? ->
      context?.let { ServerRegistry.resolve(it, tenantId)?.id }
    }

    Function("getCallState") {
      mapOf("snapshot" to (CallCore.peek() ?: context?.let(CallCore::getOrNull))?.snapshot())
    }

    AsyncFunction("place") { conversationId: String, media: String, sessionToken: String, serverId: String? ->
      core()?.place(conversationId, media, sessionToken, serverId)
      null
    }
    AsyncFunction("join") { callId: String, conversationId: String?, sessionToken: String, serverId: String? ->
      core()?.join(callId, conversationId, sessionToken, serverId)
      null
    }
    Function("answer") { core()?.answer() }
    Function("decline") { core()?.decline() }
    Function("hangUp") { core()?.hangUp() }
    Function("answerWaiting") { callId: String? -> core()?.answerWaiting(callId) }
    Function("declineWaiting") { callId: String? -> core()?.declineWaiting(callId) }
    Function("setMuted") { muted: Boolean -> core()?.setMuted(muted) }
    Function("setCamera") { on: Boolean -> core()?.setCamera(on) }

    // Screen sharing: the system asks the user first (only an Activity
    // can), then the core publishes with that answer. Resolves whether
    // the user allowed it; the snapshot's `screenSharing` follows once
    // the screen is actually published.
    Function("screenShareSupported") { core()?.screenShareSupported ?: false }
    AsyncFunction("startScreenShare") { promise: Promise ->
      val activity = appContext.currentActivity
      val core = core()
      if (activity == null || core == null || !core.screenShareSupported) {
        promise.resolve(false)
        return@AsyncFunction
      }
      pendingShare?.resolve(false)
      pendingShare = promise
      val manager = activity.getSystemService(MediaProjectionManager::class.java)
      activity.runOnUiThread {
        runCatching { activity.startActivityForResult(manager.createScreenCaptureIntent(), SCREEN_SHARE_REQUEST) }
          .onFailure {
            Log.w(TAG, "screen capture prompt failed", it)
            pendingShare?.resolve(false)
            pendingShare = null
          }
      }
    }
    Function("stopScreenShare") { core()?.setScreenShare(false, null) }
    OnActivityResult { _, payload ->
      if (payload.requestCode != SCREEN_SHARE_REQUEST) return@OnActivityResult
      val promise = pendingShare
      pendingShare = null
      val data = payload.data
      if (payload.resultCode == Activity.RESULT_OK && data != null) {
        promise?.resolve(core()?.setScreenShare(true, data) ?: false)
      } else {
        promise?.resolve(false)
      }
    }
    // Capture processing (CL7). Blur is not available on Android yet.
    Function("noiseSuppressionSupported") { core()?.noiseSuppressionSupported ?: false }
    Function("setNoiseSuppression") { on: Boolean -> core()?.setNoiseSuppression(on) ?: false }
    Function("backgroundBlurSupported") { core()?.backgroundBlurSupported ?: false }
    Function("setBackgroundBlur") { on: Boolean -> core()?.setBackgroundBlur(on) ?: false }
    Function("switchCamera") { core()?.switchCamera() }
    Function("setSpeaker") { on: Boolean -> core()?.setSpeaker(on) }
    Function("setAudioOutput") { id: String -> core()?.setAudioOutput(id) }
    // Recording consent accepted: mic and camera back as they were.
    Function("republish") { core()?.republish() }

    // What authorizes acting on the call itself (ringing people in).
    AsyncFunction("callControl") {
      val core = core() ?: return@AsyncFunction null
      core.control?.let { (callId, token) ->
        // Where the call runs: ringing people in goes to that server.
        val serverId = core.currentServerId
        mapOf(
          "callId" to callId,
          "controlToken" to token,
          "serverId" to serverId,
          "apiBaseUrl" to context?.let { ServerRegistry.baseUrl(it, serverId) }?.ifEmpty { null },
        )
      }
    }

    // Socket forwarding (open app): idempotent with the FCM path.
    Function("onRingEnded") { callId: String, reason: String -> core()?.onRingEnded(callId, reason) }
    Function("onCallFinished") { callId: String, reason: String? ->
      core()?.onCallFinished(callId, reason?.ifEmpty { null })
    }

    // A missed-call notification's tap / Call back. Cold start: the
    // launch intent still carries it — the host reads it once on mount.
    // Running app: the tap arrives as a new intent.
    Function("takeCallAction") { appContext.currentActivity?.intent?.let(::consumeCallAction) }
    OnNewIntent { intent ->
      consumeCallAction(intent)?.let { sendEvent("onCallAction", it) }
    }

    // The chat on screen: its messages are not notified, and opening it
    // clears what was already shown for it.
    Function("setActiveConversation") { conversationId: String?, serverId: String? ->
      MessageNotifications.activeServerId = serverId
      MessageNotifications.activeConversationId = conversationId
      if (conversationId != null) context?.let { MessageNotifications.clear(it, conversationId, serverId) }
    }

    // Reply / Mark as read done from a notification while JS was not
    // listening (usually: the app was not running). Oldest first, once.
    Function("takeNotificationActions") {
      context?.let { MessageNotifications.takePendingActions(it) } ?: emptyList<Map<String, Any?>>()
    }
    Function("observeNotificationActions") { on: Boolean -> MessageNotifications.actionsObserved = on }

    // While a call rings or runs the app may sit over the lock screen.
    Function("setShowOnLockscreen") { enabled: Boolean ->
      CallLockscreen.set(appContext.currentActivity, enabled)
    }

    // Android 14+: full-screen intents need a user grant for non-dialer apps.
    Function("canUseFullScreenIntent") {
      val ctx = context ?: return@Function true
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        ctx.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
      } else {
        true
      }
    }
    Function("openFullScreenIntentSettings") {
      val ctx = context ?: return@Function null
      val pkg = Uri.parse("package:${ctx.packageName}")
      val intents = buildList {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
          add(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg))
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          add(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName))
        }
        add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg))
      }
      val opener = appContext.currentActivity
      for (intent in intents) {
        val ok = runCatching {
          if (opener != null) opener.startActivity(intent)
          else ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }.onFailure { Log.w(TAG, "settings intent ${intent.action} unavailable", it) }.isSuccess
        if (ok) break
      }
      null
    }
  }

  private val context: Context? get() = appContext.reactContext

  private fun core(): CallCore? = context?.let(CallCore::getOrNull)

  /** The startScreenShare waiting on the system's capture prompt. */
  private var pendingShare: Promise? = null

  /**
   * The call action an intent carries, removed from it so a later read
   * (rotation, re-mount) cannot replay it. Acting on it from the app
   * clears its notification too: action buttons do not auto-cancel.
   */
  private fun consumeCallAction(intent: Intent): Map<String, Any?>? {
    val action = intent.getStringExtra(MissedCallNotification.EXTRA_ACTION) ?: return null
    val conversationId = intent.getStringExtra(MissedCallNotification.EXTRA_CONVERSATION_ID) ?: return null
    val callId = intent.getStringExtra(MissedCallNotification.EXTRA_CALL_ID)
    val media = intent.getStringExtra(MissedCallNotification.EXTRA_MEDIA) ?: "audio"
    // Null on a notification posted before servers: the default one.
    val serverId = intent.getStringExtra(MissedCallNotification.EXTRA_SERVER_ID)
      ?: context?.let { ServerRegistry.servers(it).get(null)?.id }
    // A meeting notice's tap / Join (MeetingNotification).
    val meetingId = intent.getStringExtra(MeetingNotification.EXTRA_SCHEDULED_MEETING_ID)
    for (key in listOf(
      MissedCallNotification.EXTRA_SERVER_ID,
      MissedCallNotification.EXTRA_ACTION,
      MissedCallNotification.EXTRA_CONVERSATION_ID,
      MissedCallNotification.EXTRA_CALL_ID,
      MissedCallNotification.EXTRA_MEDIA,
      MeetingNotification.EXTRA_SCHEDULED_MEETING_ID,
    )) intent.removeExtra(key)
    if (meetingId != null) {
      context?.let { MeetingNotification.cancel(it, meetingId) }
    } else if (callId != null) {
      context?.let { MissedCallNotification.cancel(it, callId) }
    }
    return mapOf(
      "type" to action,
      "conversationId" to conversationId,
      "callId" to callId,
      "media" to media,
      "serverId" to serverId,
      "scheduledMeetingId" to meetingId,
    )
  }

  private companion object {
    const val TAG = "PoolseCalls"
    const val SCREEN_SHARE_REQUEST = 0x5C5E
  }
}
