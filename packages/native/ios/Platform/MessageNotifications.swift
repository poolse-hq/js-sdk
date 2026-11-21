import EXNotifications
import Foundation
import UIKit
import UserNotifications

/// Chat notifications on iOS (CALL_CONTRACT.md §5.5) — the parts that must work
/// with the app not running: Reply and Mark as read from the notification,
/// and clearing a conversation's notifications once it was read elsewhere.
///
/// iOS itself shows the message (an alert push with `thread-id` =
/// conversation, so a chat's messages stack together). This class only
/// acts on them. It plugs into expo-notifications rather than taking over
/// the notification-center delegate: expo-notifications owns that delegate
/// in an Expo app, and fanning out to registered delegates is its
/// supported extension point — taking it would break every other
/// notification feature in the app.
///
/// Reply and Mark as read run natively, authorized by the reply grant the
/// push carried (`reply_grant`, kept by iOS in the delivered notification's
/// userInfo — so no Notification Service Extension is needed to store it),
/// against the API origin `configure` persisted. They work from the lock
/// screen with the app killed: iOS launches the app in the background for
/// the action, and a background task keeps it alive for the request.
///
/// Lock screen: Mark as read never asks for the passcode. Reply does not
/// either by default (the WhatsApp / Messages behaviour); an app sets
/// `PoolseMessageReplyRequiresUnlock` (the config plugin's
/// `messageReplyRequiresUnlock` option) to make Reply demand Face ID /
/// the passcode first.
final class MessageNotifications: NSObject, NotificationDelegate {
  static let shared = MessageNotifications()

  static let category = "poolse_message"
  static let replyAction = "reply"
  static let markReadAction = "mark_read"

  /// The bridge's subscriber for finished notification actions; main thread.
  static var actionListener: (([String: Any]) -> Void)?

  private static let defaults = UserDefaults(suiteName: "dev.poolse.callcore") ?? .standard
  private static let pendingKey = "notificationActions"
  private static let maxPending = 50

  private var installed = false

  /// Main thread, at launch (PoolseCallsSetup.registerVoipEarly).
  func install() {
    guard !installed else { return }
    installed = true
    registerCategory()
    NotificationCenterManager.shared.addDelegate(self)
  }

  /// Add the message category beside whatever the app (or expo) declared:
  /// setNotificationCategories REPLACES the whole set.
  private func registerCategory() {
    let requireUnlock = Bundle.main.object(forInfoDictionaryKey: "PoolseMessageReplyRequiresUnlock") as? Bool ?? false
    let reply = UNTextInputNotificationAction(
      identifier: Self.replyAction,
      title: "Reply",
      options: requireUnlock ? [.authenticationRequired] : [],
      textInputButtonTitle: "Send",
      textInputPlaceholder: "Message"
    )
    let markRead = UNNotificationAction(identifier: Self.markReadAction, title: "Mark as read", options: [])
    let category = UNNotificationCategory(
      identifier: Self.category,
      actions: [reply, markRead],
      intentIdentifiers: [],
      hiddenPreviewsBodyPlaceholder: "New message",
      categorySummaryFormat: "%u more messages from %@",
      options: []
    )
    let center = UNUserNotificationCenter.current()
    center.getNotificationCategories { existing in
      var all = existing.filter { $0.identifier != Self.category }
      all.insert(category)
      center.setNotificationCategories(all)
    }
  }

  // MARK: - NotificationDelegate (expo-notifications)

  func didReceive(_ response: UNNotificationResponse, completionHandler: @escaping () -> Void) -> Bool {
    let content = response.notification.request.content
    guard content.categoryIdentifier == Self.category else { return false }
    let action = response.actionIdentifier
    guard action == Self.replyAction || action == Self.markReadAction else {
      // A plain tap opens the app; the host routes it to the conversation.
      return false
    }
    let info = content.userInfo
    guard let conversationId = (info["conversation_id"] as? String) ?? nilIfEmpty(content.threadIdentifier) else {
      return true
    }
    let grant = (info["reply_grant"] as? String).flatMap(nilIfEmpty)
    let payloadUnread = Self.int(info["unread_total"])

    // Started before anything async: expo-notifications calls the
    // completion handler as soon as we return, and iOS may suspend a
    // background-launched app right after it.
    let background = BackgroundTask(name: "poolse-notification-\(action)")

    if action == Self.markReadAction {
      // Optimistic: the notifications go now, the server catches up. A
      // failed read is only logged — the message stays unread, nothing
      // was lost.
      Self.clear(conversationId: conversationId, fallbackUnread: payloadUnread, adjustBadge: true)
      guard let grant = grant else {
        Self.report(["action": "mark_read", "conversationId": conversationId, "ok": false, "error": "no_grant"])
        background.end()
        return true
      }
      send(path: "/v1/notification-actions/read", grant: grant, body: [:], background: background) { result in
        Self.report(result.event(action: "mark_read", conversationId: conversationId))
        background.end()
      }
      return true
    }

    // Reply.
    let text = (response as? UNTextInputNotificationResponse)?.userText
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !text.isEmpty else {
      background.end()
      return true
    }
    // One id per reply, reused by every retry: the server answers a
    // repeat with the original message (200), never a second one.
    let clientId = UUID().uuidString.lowercased()
    guard let grant = grant else {
      Self.postFailure(conversationId: conversationId, text: text, reason: "Open the app to reply.", userInfo: info)
      Self.report(["action": "reply", "conversationId": conversationId, "ok": false, "text": text,
                   "clientId": clientId, "error": "no_grant"])
      background.end()
      return true
    }
    send(path: "/v1/notification-actions/reply", grant: grant,
         body: ["text": text, "id": clientId], background: background) { result in
      var event = result.event(action: "reply", conversationId: conversationId)
      event["text"] = text
      event["clientId"] = clientId
      if result.ok {
        event["messageId"] = (result.json?["id"] as? String) ?? clientId
        // Replying marked the conversation read on the server.
        Self.clear(conversationId: conversationId, fallbackUnread: payloadUnread, adjustBadge: true)
        Self.report(event)
        background.end()
      } else {
        Self.postFailure(conversationId: conversationId, text: text, reason: result.reason, userInfo: info)
        Self.report(event)
        // Give the failure notification a moment to be scheduled.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { background.end() }
      }
    }
    return true
  }

  /// A background push: the conversation was read on another device.
  func didReceive(_ userInfo: [AnyHashable: Any],
                  completionHandler: @escaping (UIBackgroundFetchResult) -> Void) -> Bool {
    guard userInfo["type"] as? String == "message_read",
          let conversationId = userInfo["conversation_id"] as? String else { return false }
    Self.clear(conversationId: conversationId, fallbackUnread: nil, adjustBadge: false)
    if let unread = Self.int(userInfo["unread_total"]) {
      Self.setBadge(unread)
    }
    completionHandler(.newData)
    return true
  }

  // MARK: - helpers

  /// Remove every delivered notification of one conversation. With
  /// `adjustBadge` (a read done here, whose exact count the server only
  /// sends in its read-sync push) the badge becomes the newest delivered
  /// message's `unread_total` less this conversation's notifications — the
  /// read-sync push, when it reaches a running app, sets the exact value.
  static func clear(conversationId: String, fallbackUnread: Int? = nil, adjustBadge: Bool = false) {
    let center = UNUserNotificationCenter.current()
    center.getDeliveredNotifications { delivered in
      let mine = delivered.filter {
        $0.request.content.threadIdentifier == conversationId ||
          ($0.request.content.userInfo["conversation_id"] as? String) == conversationId
      }
      let ids = mine.map { $0.request.identifier }
      if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
      guard adjustBadge else { return }
      let newest = delivered
        .filter { $0.request.content.categoryIdentifier == Self.category && Self.int($0.request.content.userInfo["unread_total"]) != nil }
        .max { $0.date < $1.date }
      guard let total = newest.flatMap({ Self.int($0.request.content.userInfo["unread_total"]) }) ?? fallbackUnread else { return }
      let cleared = mine.filter { $0.request.content.userInfo["poolse_reply_failed"] == nil }.count
      Self.setBadge(total - max(cleared, 1))
    }
  }

  static func setBadge(_ count: Int) {
    if #available(iOS 16.0, *) {
      UNUserNotificationCenter.current().setBadgeCount(max(count, 0))
    } else {
      DispatchQueue.main.async { UIApplication.shared.applicationIconBadgeNumber = max(count, 0) }
    }
  }

  /// "Couldn't send" — in the conversation's stack, with the same Reply
  /// action (and the grant it came with) so the user can try again
  /// right there, or tap to open the chat.
  private static func postFailure(conversationId: String, text: String, reason: String, userInfo: [AnyHashable: Any]) {
    let content = UNMutableNotificationContent()
    content.title = "Couldn't send your reply"
    content.body = "\u{201C}\(text)\u{201D} — \(reason)"
    content.threadIdentifier = conversationId
    content.sound = .default
    var info: [String: Any] = [
      "type": "message",
      "conversation_id": conversationId,
      "poolse_reply_failed": "1",
      // expo-notifications reads a push's data from `body`; keep tap routing working.
      "body": ["type": "message", "conversation_id": conversationId],
    ]
    if let grant = userInfo["reply_grant"] as? String, !grant.isEmpty {
      info["reply_grant"] = grant
      content.categoryIdentifier = Self.category
    }
    content.userInfo = info
    let request = UNNotificationRequest(identifier: "poolse-reply-failed-\(conversationId)", content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request) { error in
      if let error = error { pcTrace("reply failure notification refused: \(error)") }
    }
  }

  // MARK: - JS events

  /// Hand a finished action to JS — live when the bridge listens, else
  /// queued (persisted) until the app opens and drains it.
  static func report(_ event: [String: Any]) {
    var event = event
    event["at"] = Int(Date().timeIntervalSince1970 * 1000)
    DispatchQueue.main.async {
      if let listener = Self.actionListener {
        listener(event)
        return
      }
      var queue = Self.defaults.array(forKey: Self.pendingKey) as? [[String: Any]] ?? []
      queue.append(event)
      if queue.count > Self.maxPending { queue.removeFirst(queue.count - Self.maxPending) }
      Self.defaults.set(queue, forKey: Self.pendingKey)
    }
  }

  /// The queued actions, oldest first, removed. UserDefaults is thread-safe.
  static func takePending() -> [[String: Any]] {
    let queue = defaults.array(forKey: pendingKey) as? [[String: Any]] ?? []
    defaults.removeObject(forKey: pendingKey)
    return queue
  }

  // MARK: - HTTP

  struct ActionResult {
    var ok: Bool
    var status: Int
    var code: String?
    var json: [String: Any]?

    /// What the user reads in the "couldn't send" notification.
    var reason: String {
      switch (status, code) {
      case (0, _): return "No connection. Try again."
      case (401, "device_signed_out"): return "This phone is signed out. Open the app to sign in."
      case (401, "user_blocked"): return "Your account is blocked."
      case (401, _): return "The notification expired. Open the app to reply."
      case (402, _): return "Your workspace is full this month."
      case (403, _): return "You're no longer in this conversation."
      case (404, _): return "This conversation is gone."
      case (422, _): return "The message couldn't be sent."
      case (429, _): return "Too many replies. Try again in a moment."
      default: return "Something went wrong. Try again."
      }
    }

    func event(action: String, conversationId: String) -> [String: Any] {
      var e: [String: Any] = ["action": action, "conversationId": conversationId, "ok": ok]
      if !ok {
        e["error"] = code ?? (status == 0 ? "network" : "http_\(status)")
        if status != 0 { e["status"] = status }
      }
      return e
    }
  }

  private let session: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 15
    config.waitsForConnectivity = false
    return URLSession(configuration: config)
  }()

  /// A grant-authorized POST, retried with the SAME body (so the same
  /// reply id) on a network error, a 5xx or a 429 while the background
  /// task has time left. The grant rides as the bearer and as `token`.
  private func send(path: String, grant: String, body: [String: Any], background: BackgroundTask,
                    attempt: Int = 1, done: @escaping (ActionResult) -> Void) {
    guard let base = CallCore.persistedApiBaseUrl(), let url = URL(string: base + path) else {
      pcTrace("notification action \(path): never configured")
      done(ActionResult(ok: false, status: 0, code: "not_configured", json: nil))
      return
    }
    var payload = body
    payload["token"] = grant
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("Bearer \(grant)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

    session.dataTask(with: request) { [weak self] data, response, error in
      let http = response as? HTTPURLResponse
      let status = error == nil ? (http?.statusCode ?? 0) : 0
      let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
      let code = (json?["error"] as? [String: Any])?["code"] as? String
      let result = ActionResult(ok: (200..<300).contains(status), status: status, code: code, json: json)
      if result.ok {
        done(result)
        return
      }
      pcTrace("notification action \(path) failed status=\(status) code=\(code ?? "-") error=\(String(describing: error))")

      let retryable = status == 0 || status == 429 || status >= 500
      var delay = attempt == 1 ? 1.0 : 3.0
      if status == 429, let s = http?.value(forHTTPHeaderField: "Retry-After").flatMap(Double.init) { delay = s }
      DispatchQueue.main.async {
        guard let self = self, retryable, attempt < 3,
              background.remaining > delay + 16 else {
          done(result)
          return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
          self.send(path: path, grant: grant, body: body, background: background, attempt: attempt + 1, done: done)
        }
      }
    }.resume()
  }

  static func int(_ value: Any?) -> Int? {
    if let n = value as? NSNumber { return n.intValue }
    if let s = value as? String { return Int(s) }
    return nil
  }
}

private func nilIfEmpty(_ s: String) -> String? { s.isEmpty ? nil : s }

/// UIApplication's background task, begun at once (on main) and ended
/// exactly once — by `end()` or by iOS's expiry.
final class BackgroundTask {
  private var id: UIBackgroundTaskIdentifier = .invalid

  init(name: String) {
    let begin = {
      self.id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in self?.endNow() }
    }
    if Thread.isMainThread { begin() } else { DispatchQueue.main.sync(execute: begin) }
  }

  /// Seconds iOS still grants; generous while the app is in the foreground. Main thread.
  var remaining: TimeInterval {
    let r = UIApplication.shared.backgroundTimeRemaining
    return r.isFinite ? r : 60
  }

  func end() {
    if Thread.isMainThread { endNow() } else { DispatchQueue.main.async { self.endNow() } }
  }

  private func endNow() {
    guard id != .invalid else { return }
    UIApplication.shared.endBackgroundTask(id)
    id = .invalid
  }
}
