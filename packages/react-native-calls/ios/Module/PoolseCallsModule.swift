import ExpoModulesCore

/// The React Native face of the native call core on iOS — PoolseCallsModule.kt's
/// twin, with the same names, arity and return shapes (src/index.ts is shared).
/// Deliberately thin: commands go to CallCore, snapshots stream out.
///
/// Nothing here throws before `configure`: reads return idle, commands no-op.
public class PoolseCallsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PoolseCalls")

    Events("onCallState", "onVoipToken", "onPictureInPicture")

    // Normally done at launch by PoolseCallsAppDelegateSubscriber; this is
    // the backstop for a host whose AppDelegate does not forward to Expo.
    OnCreate {
      PoolseCallsSetup.registerVoipEarly()
    }

    // The listeners are process-level statics read on main: assign and
    // clear them on main too (these closures run on the module's queue).
    OnStartObserving {
      DispatchQueue.main.async { [weak self] in
        guard self != nil else { return }
        CallCore.listener = { [weak self] snapshot in
          self?.sendEvent("onCallState", ["snapshot": snapshot ?? NSNull()])
        }
        VoipPush.tokenListener = { [weak self] token in
          self?.sendEvent("onVoipToken", ["token": token, "environment": PoolseCallsModule.environment()])
        }
        CallPictureInPicture.listener = { [weak self] active in
          self?.sendEvent("onPictureInPicture", ["active": active])
        }
      }
    }

    OnStopObserving {
      DispatchQueue.main.async {
        CallCore.listener = nil
        VoipPush.tokenListener = nil
        CallPictureInPicture.listener = nil
      }
    }

    AsyncFunction("configure") { (apiBaseUrl: String, options: [String: Any]?) in
      let env = (options?["apnsEnvironment"] as? String).flatMap { $0 == "production" || $0 == "sandbox" ? $0 : nil }
      CallCore.configure(
        apiBaseUrl: apiBaseUrl,
        ringback: options?["ringback"] as? String,
        apnsEnvironment: env
      )
      // Materialise the core now (and PushKit, if launch did not), so a
      // call already in flight (cold answer) is visible to getCallState.
      PoolseCallsSetup.registerVoipEarly()
      _ = CallCore.getOrNull()
    }.runOnQueue(.main)

    Function("getCallState") { () -> [String: Any] in
      ["snapshot": CallCore.peek()?.snapshot() ?? NSNull()]
    }

    AsyncFunction("place") { (conversationId: String, media: String, sessionToken: String) in
      CallCore.getOrNull()?.place(conversationId: conversationId, media: media, sessionToken: sessionToken)
    }.runOnQueue(.main)

    AsyncFunction("join") { (callId: String, conversationId: String?, sessionToken: String) in
      CallCore.getOrNull()?.join(callId: callId, conversationId: conversationId, sessionToken: sessionToken)
    }.runOnQueue(.main)

    Function("answer") { onCore { $0.answer() } }
    Function("decline") { onCore { $0.decline() } }
    Function("hangUp") { onCore { $0.hangUp() } }
    Function("answerWaiting") { (callId: String?) in onCore { $0.answerWaiting(callId: callId) } }
    Function("declineWaiting") { (callId: String?) in onCore { $0.declineWaiting(callId: callId) } }
    Function("setMuted") { (muted: Bool) in onCore { $0.setMuted(muted) } }
    Function("setCamera") { (on: Bool) in onCore { $0.setCamera(on) } }
    Function("switchCamera") { onCore { $0.switchCamera() } }
    Function("setSpeaker") { (on: Bool) in onCore { $0.setSpeaker(on) } }
    Function("setAudioOutput") { (id: String) in onCore { $0.setAudioOutput(id) } }

    // Picture-in-picture: armed while a video call shows someone; the
    // <CallVideoView pictureInPicture> on screen is what it grows out of.
    Function("setPictureInPictureEnabled") { (on: Bool) in
      DispatchQueue.main.async { CallPictureInPicture.shared.setEnabled(on) }
    }
    Function("isInPictureInPicture") { () -> Bool in CallPictureInPicture.shared.active }
    Function("pictureInPictureSupported") { () -> Bool in CallPictureInPicture.supported }

    // What authorizes acting on the call itself (ringing people in).
    AsyncFunction("callControl") { () -> [String: String]? in
      guard let c = CallCore.getOrNull()?.control else { return nil }
      return ["callId": c.callId, "controlToken": c.controlToken]
    }.runOnQueue(.main)

    // The chat on screen: opening it clears what was already shown for it.
    // (Suppressing new ones while it is open happens in the app's
    // notification handler — see shouldPresentMessage in src/index.ts.)
    Function("setActiveConversation") { (conversationId: String?) in
      if let conversationId = conversationId { MessageNotifications.clear(conversationId: conversationId) }
    }

    // Android-only: CallKit owns the lock screen on iOS.
    Function("setShowOnLockscreen") { (_: Bool) in }

    // Socket forwarding (open app): idempotent with the push path.
    Function("onRingEnded") { (callId: String, reason: String) in
      onCore { $0.onRingEnded(callId: callId, reason: reason) }
    }
    Function("onCallFinished") { (callId: String, reason: String?) in
      let r = (reason?.isEmpty ?? true) ? nil : reason
      onCore { $0.onCallFinished(callId: callId, reason: r) }
    }

    // Android-only concepts: CallKit owns the lock-screen ring on iOS.
    Function("canUseFullScreenIntent") { () -> Bool in true }
    Function("openFullScreenIntentSettings") { () -> Void in }

    Function("getVoipToken") { () -> [String: Any]? in
      guard let token = VoipPush.shared.token else { return nil }
      return ["token": token, "environment": PoolseCallsModule.environment()]
    }

    // <CallVideoView>: a participant's (or our own) camera.
    View(PoolseCallVideoView.self) {
      ViewName("PoolseCallVideo")
      Prop("participantId") { (view: PoolseCallVideoView, id: String?) in view.participantId = id }
      Prop("local") { (view: PoolseCallVideoView, local: Bool?) in view.local = local ?? false }
      Prop("mirror") { (view: PoolseCallVideoView, mirror: Bool?) in view.mirror = mirror }
      Prop("fit") { (view: PoolseCallVideoView, fit: String?) in view.fit = fit ?? "cover" }
      Prop("pictureInPicture") { (view: PoolseCallVideoView, on: Bool?) in view.pictureInPicture = on ?? false }
      OnViewDidUpdateProps { (view: PoolseCallVideoView) in view.apply() }
    }
  }

  /// The configured APNs environment; unconfigured → the build's default.
  static func environment() -> String {
    if let env = CallCore.apnsEnvironment { return env }
    #if DEBUG
    return "sandbox"
    #else
    return "production"
    #endif
  }
}

/// Run on main against the core; a no-op when never configured.
private func onCore(_ block: @escaping (CallCore) -> Void) {
  let run = { if let core = CallCore.getOrNull() { block(core) } }
  if Thread.isMainThread { run() } else { DispatchQueue.main.async(execute: run) }
}
