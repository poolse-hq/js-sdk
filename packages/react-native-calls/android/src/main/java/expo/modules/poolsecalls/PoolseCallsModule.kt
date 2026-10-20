package expo.modules.poolsecalls

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import dev.poolse.callcore.android.CallCore
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

    Events("onCallState")

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
    Function("setMuted") { muted: Boolean -> core()?.setMuted(muted) }
    Function("setCamera") { on: Boolean -> core()?.setCamera(on) }
    Function("switchCamera") { core()?.switchCamera() }
    Function("setSpeaker") { on: Boolean -> core()?.setSpeaker(on) }

    // Socket forwarding (open app): idempotent with the FCM path.
    Function("onRingEnded") { callId: String, reason: String -> core()?.onRingEnded(callId, reason) }
    Function("onCallFinished") { callId: String -> core()?.onCallFinished(callId) }

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

  private companion object {
    const val TAG = "PoolseCalls"
  }
}
