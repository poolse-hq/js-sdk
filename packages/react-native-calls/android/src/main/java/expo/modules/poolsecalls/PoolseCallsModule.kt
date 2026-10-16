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
      CallCore.configure(buildConfig(apiBaseUrl, options))
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

  private fun buildConfig(apiBaseUrl: String, options: Map<String, Any?>?) =
    dev.poolse.callcore.android.CallCoreConfig(
      apiBaseUrl = apiBaseUrl.trimEnd('/'),
      smallIcon = resolveDrawable(options?.get("smallIcon") as? String),
      ringbackRawRes = resolveRaw(options?.get("ringback") as? String),
      mediaFactory = resolveMediaFactory(),
    )

  private fun resolveDrawable(name: String?): Int {
    val ctx = context
    val id = name?.let { ctx.resources.getIdentifier(it, "drawable", ctx.packageName) } ?: 0
    // Fall back to the app's launcher icon rather than crash on a typo.
    return if (id != 0) id else ctx.applicationInfo.icon
  }

  private fun resolveRaw(name: String?): Int {
    val ctx = context
    return name?.let { ctx.resources.getIdentifier(it, "raw", ctx.packageName) } ?: 0
  }

  /**
   * The shipped LiveKit adapter is loaded reflectively so the core
   * library does not statically depend on the SFU source set. Absent
   * (LiveKit not built in), calls still ring and signal; there is just
   * no media — a supported degraded mode, not a crash.
   */
  @Suppress("UNCHECKED_CAST")
  private fun resolveMediaFactory(): (android.content.Context, dev.poolse.callcore.android.MediaEvents) -> dev.poolse.callcore.MediaPort {
    return runCatching {
      val companion = Class.forName("dev.poolse.callcore.livekit.LiveKitMediaPort\$Companion")
      val instance = Class.forName("dev.poolse.callcore.livekit.LiveKitMediaPort")
        .getField("Companion").get(null)
      val getter = companion.getMethod("getFactory")
      getter.invoke(instance) as (android.content.Context, dev.poolse.callcore.android.MediaEvents) -> dev.poolse.callcore.MediaPort
    }.getOrElse {
      { _, _ -> NoMediaPort }
    }
  }

  /** Signalling-only fallback: the call rings and the state machine
   *  runs, there is simply no audio/video transport. */
  private object NoMediaPort : dev.poolse.callcore.MediaPort {
    override fun join(bundle: dev.poolse.callcore.CallSessionBundle) {}
    override fun leave() {}
    override fun setMuted(muted: Boolean) {}
    override fun setCamera(on: Boolean) {}
    override fun switchCamera() {}
  }
}
