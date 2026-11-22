import ExpoModulesCore

/// The React Native face of the native call core on iOS — PoolseCallsModule.kt's
/// twin, with the same names, arity and return shapes (src/index.ts is shared).
/// Deliberately thin: commands go to CallCore, snapshots stream out.
///
/// Nothing here throws before `configure`: reads return idle, commands no-op.
public class PoolseCallsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PoolseCalls")

    Events("onCallState", "onVoipToken", "onPictureInPicture", "onNotificationAction", "onCallAction", "onCallData")

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
        MessageNotifications.callActionListener = { [weak self] event in
          self?.sendEvent("onCallAction", event)
        }
        MessageNotifications.actionListener = { [weak self] event in
          self?.sendEvent("onNotificationAction", event)
        }
        CallCore.dataListener = { [weak self] message in
          self?.sendEvent("onCallData", message)
        }
      }
    }

    OnStopObserving {
      DispatchQueue.main.async {
        CallCore.listener = nil
        VoipPush.tokenListener = nil
        CallPictureInPicture.listener = nil
        MessageNotifications.actionListener = nil
        MessageNotifications.callActionListener = nil
        CallCore.dataListener = nil
      }
    }

    AsyncFunction("configure") { (apiBaseUrl: String, options: [String: Any]?) in
      let env = (options?["apnsEnvironment"] as? String).flatMap { $0 == "production" || $0 == "sandbox" ? $0 : nil }
      CallCore.configure(
        apiBaseUrl: apiBaseUrl,
        ringback: options?["ringback"] as? String,
        apnsEnvironment: env
      )
      CallRingtone.configure(options?["ringtone"] as? String)
      CallKitController.shared.refreshRingtone()
      // Materialise the core now (and PushKit, if launch did not), so a
      // call already in flight (cold answer) is visible to getCallState.
      PoolseCallsSetup.registerVoipEarly()
      _ = CallCore.getOrNull()
    }.runOnQueue(.main)

    // Several workspaces: each server the app is signed in to. Persisted,
    // so a ring or a notification action with no JS finds its server.
    AsyncFunction("addServer") { (server: [String: Any]) in
      guard let s = CallServer(dict: server) else { return }
      var entry = s
      while entry.apiBaseUrl.hasSuffix("/") { entry.apiBaseUrl.removeLast() }
      CallCore.ensureConfigured()
      ServerRegistry.shared.upsert(entry)
      PoolseCallsSetup.registerVoipEarly()
      _ = CallCore.getOrNull()
    }.runOnQueue(.main)

    // Signed out of one workspace: forget it and take its notifications
    // down. A call in progress on it carries on to its end.
    AsyncFunction("removeServer") { (id: String) in
      let tenant = ServerRegistry.shared.servers.get(id)?.tenantId
      ServerRegistry.shared.remove(id)
      if let tenant = tenant { MessageNotifications.clearTenant(tenant) }
    }.runOnQueue(.main)

    Function("listServers") { () -> [[String: Any]] in
      ServerRegistry.shared.servers.all.map(\.dict)
    }

    // The server a push / notification of `tenantId` belongs to — the
    // same rule the native side routes rings and actions by.
    Function("serverForTenant") { (tenantId: String?) -> String? in
      ServerRegistry.shared.servers.resolve(tenantId: tenantId.flatMap { $0.isEmpty ? nil : $0 })?.id
    }

    Function("getCallState") { () -> [String: Any] in
      ["snapshot": CallCore.peek()?.snapshot() ?? NSNull()]
    }

    AsyncFunction("place") { (conversationId: String, media: String, sessionToken: String, serverId: String?) in
      CallCore.getOrNull()?.place(conversationId: conversationId, media: media, sessionToken: sessionToken,
                                  serverId: serverId)
    }.runOnQueue(.main)

    AsyncFunction("join") { (callId: String, conversationId: String?, sessionToken: String, serverId: String?) in
      CallCore.getOrNull()?.join(callId: callId, conversationId: conversationId, sessionToken: sessionToken,
                                 serverId: serverId)
    }.runOnQueue(.main)

    Function("answer") { onCore { $0.answer() } }
    Function("decline") { onCore { $0.decline() } }
    Function("hangUp") { onCore { $0.hangUp() } }
    Function("answerWaiting") { (callId: String?) in onCore { $0.answerWaiting(callId: callId) } }
    Function("declineWaiting") { (callId: String?) in onCore { $0.declineWaiting(callId: callId) } }
    Function("setMuted") { (muted: Bool) in onCore { $0.setMuted(muted) } }
    Function("setCamera") { (on: Bool) in onCore { $0.setCamera(on) } }
    Function("switchCamera") { onCore { $0.switchCamera() } }
    // Sharing from iOS goes through the app's broadcast upload extension
    // (the config plugin's `screenShare` option); without it this is false.
    Function("screenShareSupported") { () -> Bool in LiveKitMediaPort.screenShareSupported }
    // Shows the system's broadcast picker; the snapshot's `screenSharing`
    // turns true once the user taps Start Broadcast. Resolves whether the
    // picker could be shown at all.
    AsyncFunction("startScreenShare") { () -> Bool in
      guard LiveKitMediaPort.screenShareSupported, CallCore.getOrNull() != nil else { return false }
      onCore { $0.setScreenShare(true) }
      return true
    }
    Function("stopScreenShare") { onCore { $0.setScreenShare(false) } }
    // Capture processing (CL7). Noise suppression is Apple's voice
    // processing; blur is Vision person segmentation (iOS 15+).
    Function("noiseSuppressionSupported") { () -> Bool in true }
    Function("setNoiseSuppression") { (on: Bool) -> Bool in
      guard CallCore.getOrNull() != nil else { return false }
      onCore { $0.setNoiseSuppression(on) }
      return true
    }
    Function("backgroundBlurSupported") { () -> Bool in true }
    Function("setBackgroundBlur") { (on: Bool) -> Bool in
      guard CallCore.getOrNull() != nil else { return false }
      onCore { $0.setBackgroundBlur(on) }
      return true
    }
    Function("setSpeaker") { (on: Bool) in onCore { $0.setSpeaker(on) } }
    Function("setAudioOutput") { (id: String) in onCore { $0.setAudioOutput(id) } }
    // Recording consent accepted: mic and camera back as they were.
    Function("republish") { onCore { $0.republish() } }

    // The call's data channel (CL4, CL6): `data` is UTF-8 text, or bytes
    // as base64 with `options.base64`. Resolves false when not connected,
    // over 14 000 bytes, or refused.
    AsyncFunction("publishData") { (topic: String, data: String, options: [String: Any]?, promise: Promise) in
      let bytes = (options?["base64"] as? Bool == true) ? Data(base64Encoded: data) : data.data(using: .utf8)
      guard let bytes = bytes, let core = CallCore.getOrNull() else { return promise.resolve(false) }
      core.publishData(topic: topic, data: bytes, reliable: options?["reliable"] as? Bool ?? true,
                       to: options?["to"] as? [String] ?? []) { ok in promise.resolve(ok) }
    }.runOnQueue(.main)

    // Breakout rooms (MEETINGS.md §5): the live call's media to another
    // room of the same call, keeping the CallKit call. `session` is the
    // JSON of POST /breakouts/:room/join or /calls/:id/breakouts/return.
    AsyncFunction("moveToRoom") { (session: String, promise: Promise) in
      guard let core = CallCore.getOrNull() else { return promise.resolve(false) }
      core.moveToRoom(payload: session) { ok in promise.resolve(ok) }
    }.runOnQueue(.main)

    // Picture-in-picture: armed while a video call shows someone; the
    // <CallVideoView pictureInPicture> on screen is what it grows out of.
    Function("setPictureInPictureEnabled") { (on: Bool) in
      DispatchQueue.main.async { CallPictureInPicture.shared.setEnabled(on) }
    }
    Function("isInPictureInPicture") { () -> Bool in CallPictureInPicture.shared.active }
    Function("pictureInPictureSupported") { () -> Bool in CallPictureInPicture.supported }

    // What authorizes acting on the call itself (ringing people in).
    AsyncFunction("callControl") { () -> [String: String]? in
      guard let core = CallCore.getOrNull(), let c = core.control else { return nil }
      var out = ["callId": c.callId, "controlToken": c.controlToken]
      // Where the call runs: ringing people in goes to that server.
      if let id = core.currentServerId {
        out["serverId"] = id
        out["apiBaseUrl"] = ServerRegistry.shared.baseUrl(id)
      }
      return out
    }.runOnQueue(.main)

    // The chat on screen: opening it clears what was already shown for it.
    // (Suppressing new ones while it is open happens in the app's
    // notification handler — see shouldPresentMessage in src/index.ts.)
    Function("setActiveConversation") { (conversationId: String?, serverId: String?) in
      guard let conversationId = conversationId else { return }
      let tenant = serverId.flatMap { ServerRegistry.shared.servers.get($0)?.tenantId }
      MessageNotifications.clear(conversationId: conversationId, tenantId: tenant)
    }

    // Reply / Mark as read done from a notification while JS was not
    // listening (usually: the app was not running). Oldest first, once.
    // A meeting notice's tap / Join that launched the app (cold start), once.
    Function("takeCallAction") { () -> [String: Any]? in
      var out: [String: Any]?
      let take = { out = MessageNotifications.pendingCallAction; MessageNotifications.pendingCallAction = nil }
      if Thread.isMainThread { take() } else { DispatchQueue.main.sync(execute: take) }
      return out
    }
    Function("takeNotificationActions") { () -> [[String: Any]] in
      MessageNotifications.takePending()
    }
    Function("observeNotificationActions") { (on: Bool) in
      DispatchQueue.main.async { MessageNotifications.actionsObserved = on }
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
      // `camera` (default) or `screen`: their shared screen instead of their face.
      Prop("source") { (view: PoolseCallVideoView, source: String?) in view.source = source ?? "camera" }
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
