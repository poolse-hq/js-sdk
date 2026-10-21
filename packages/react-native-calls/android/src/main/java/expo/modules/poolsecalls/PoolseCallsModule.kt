package expo.modules.poolsecalls

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import dev.poolse.callcore.android.CallCore
import dev.poolse.callcore.android.MessageNotifications
import dev.poolse.callcore.android.MissedCallNotification
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

    Events("onCallState", "onCallAction")

    // <CallVideoView>: renders a participant's (or our own) camera.
    View(PoolseCallVideoView::class) {
      Name("PoolseCallVideo")
      Prop("participantId") { view: PoolseCallVideoView, id: String? -> view.participantId = id }
      Prop("local") { view: PoolseCallVideoView, local: Boolean? -> view.local = local ?: false }
      Prop("mirror") { view: PoolseCallVideoView, mirror: Boolean? -> view.mirror = mirror }
      Prop("fit") { view: PoolseCallVideoView, fit: String? -> view.fit = fit ?: "cover" }
      OnViewDestroys { view: PoolseCallVideoView -> view.detachSurface() }
    }

    // Snapshots → the single JS event. Null (idle) becomes an explicit
    // cleared payload so the JS side always has a definite state. The
    // listener is process-level, so subscribing before configure works.
    OnStartObserving {
      CallCore.listener = { snapshot -> sendEvent("onCallState", mapOf("snapshot" to snapshot)) }
    }
    OnStopObserving {
      CallCore.listener = null
    }

    AsyncFunction("configure") { apiBaseUrl: String, options: Map<String, Any?>? ->
      val ctx = context ?: return@AsyncFunction null
      // Resource NAMES go to the core, which resolves + persists them —
      // so a killed app woken by a ring can rebuild this without JS.
      CallCore.configure(
        ctx,
        apiBaseUrl,
        options?.get("smallIcon") as? String,
        options?.get("ringback") as? String,
      )
      // Materialise the core now, so a call already in flight (cold
      // answer) is visible to the first getCallState.
      CallCore.getOrNull(ctx)
      null
    }

    Function("getCallState") {
      mapOf("snapshot" to (CallCore.peek() ?: context?.let(CallCore::getOrNull))?.snapshot())
    }

    AsyncFunction("place") { conversationId: String, media: String, sessionToken: String ->
      core()?.place(conversationId, media, sessionToken)
    }
    AsyncFunction("join") { callId: String, conversationId: String?, sessionToken: String ->
      core()?.join(callId, conversationId, sessionToken)
    }
    Function("answer") { core()?.answer() }
    Function("decline") { core()?.decline() }
    Function("hangUp") { core()?.hangUp() }
    Function("answerWaiting") { callId: String? -> core()?.answerWaiting(callId) }
    Function("declineWaiting") { callId: String? -> core()?.declineWaiting(callId) }
    Function("setMuted") { muted: Boolean -> core()?.setMuted(muted) }
    Function("setCamera") { on: Boolean -> core()?.setCamera(on) }
    Function("switchCamera") { core()?.switchCamera() }
    Function("setSpeaker") { on: Boolean -> core()?.setSpeaker(on) }
    Function("setAudioOutput") { id: String -> core()?.setAudioOutput(id) }

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
    Function("setActiveConversation") { conversationId: String? ->
      MessageNotifications.activeConversationId = conversationId
      if (conversationId != null) context?.let { MessageNotifications.clear(it, conversationId) }
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
    for (key in listOf(
      MissedCallNotification.EXTRA_ACTION,
      MissedCallNotification.EXTRA_CONVERSATION_ID,
      MissedCallNotification.EXTRA_CALL_ID,
      MissedCallNotification.EXTRA_MEDIA,
    )) intent.removeExtra(key)
    if (callId != null) context?.let { MissedCallNotification.cancel(it, callId) }
    return mapOf(
      "type" to action,
      "conversationId" to conversationId,
      "callId" to callId,
      "media" to media,
    )
  }

  private companion object {
    const val TAG = "PoolseCalls"
  }
}
