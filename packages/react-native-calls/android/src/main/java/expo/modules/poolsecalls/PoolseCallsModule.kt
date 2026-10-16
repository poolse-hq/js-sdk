package expo.modules.poolsecalls

import dev.poolse.callcore.android.CallCore
import dev.poolse.callcore.android.toSnapshot
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
 */
class PoolseCallsModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("PoolseCalls")

    Events("onCallState")

    // Snapshots → the single JS event. Null (idle) becomes an explicit
    // cleared payload so the JS side always has a definite state.
    OnStartObserving {
      CallCore.get(context).snapshotListener = { state ->
        sendEvent("onCallState", mapOf("snapshot" to state.toSnapshot()))
      }
    }
    OnStopObserving {
      CallCore.get(context).snapshotListener = null
    }

    AsyncFunction("configure") { apiBaseUrl: String, options: Map<String, Any?>? ->
      // Resource NAMES go to the core, which resolves + persists them —
      // so a killed app woken by a ring can rebuild this without JS.
      CallCore.configure(
        context,
        apiBaseUrl,
        options?.get("smallIcon") as? String,
        options?.get("ringback") as? String,
      )
    }

    Function("getCallState") {
      mapOf("snapshot" to CallCore.get(context).snapshot().toSnapshot())
    }

    AsyncFunction("place") { conversationId: String, media: String, sessionToken: String ->
      CallCore.get(context).place(conversationId, media, sessionToken)
    }
    AsyncFunction("join") { callId: String, conversationId: String?, sessionToken: String ->
      CallCore.get(context).join(callId, conversationId, sessionToken)
    }
    Function("answer") { CallCore.get(context).answer() }
    Function("decline") { CallCore.get(context).decline() }
    Function("hangUp") { CallCore.get(context).hangUp() }
    Function("setMuted") { muted: Boolean -> CallCore.get(context).setMuted(muted) }
    Function("setCamera") { on: Boolean -> CallCore.get(context).setCamera(on) }
    Function("switchCamera") { CallCore.get(context).switchCamera() }
  }

  private val context get() = requireNotNull(appContext.reactContext) { "no react context" }
}
