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
/// push carried, so they work from the lock screen with the app killed.
final class MessageNotifications: NSObject, NotificationDelegate {
  static let shared = MessageNotifications()

  static let category = "poolse_message"
  static let replyAction = "reply"
  static let markReadAction = "mark_read"

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
    let reply = UNTextInputNotificationAction(
      identifier: Self.replyAction,
      title: "Reply",
      options: [],
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
    guard content.categoryIdentifier == Self.category,
          let grant = content.userInfo["reply_grant"] as? String, !grant.isEmpty else { return false }
    let conversationId = content.userInfo["conversation_id"] as? String

    switch response.actionIdentifier {
    case Self.replyAction:
      let text = (response as? UNTextInputNotificationResponse)?.userText
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      guard !text.isEmpty else { return true }
      post(path: "/v1/notifications/reply", grant: grant,
           body: ["body": text, "id": UUID().uuidString.lowercased()]) { ok in
        if ok, let conversationId = conversationId { Self.clear(conversationId: conversationId) }
      }
      return true
    case Self.markReadAction:
      if let conversationId = conversationId { Self.clear(conversationId: conversationId) }
      post(path: "/v1/notifications/read", grant: grant, body: [:]) { _ in }
      return true
    default:
      // A plain tap opens the app; the host routes it to the conversation.
      return false
    }
  }

  /// A background push: the conversation was read on another device.
  func didReceive(_ userInfo: [AnyHashable: Any],
                  completionHandler: @escaping (UIBackgroundFetchResult) -> Void) -> Bool {
    guard userInfo["type"] as? String == "message_read",
          let conversationId = userInfo["conversation_id"] as? String else { return false }
    Self.clear(conversationId: conversationId)
    if let unread = (userInfo["unread_total"] as? NSNumber)?.intValue ?? Int(userInfo["unread_total"] as? String ?? "") {
      Self.setBadge(unread)
    }
    completionHandler(.newData)
    return true
  }

  // MARK: - helpers

  /// Remove every delivered notification of one conversation.
  static func clear(conversationId: String) {
    let center = UNUserNotificationCenter.current()
    center.getDeliveredNotifications { delivered in
      let ids = delivered
        .filter { $0.request.content.threadIdentifier == conversationId ||
                  ($0.request.content.userInfo["conversation_id"] as? String) == conversationId }
        .map { $0.request.identifier }
      if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
    }
  }

  static func setBadge(_ count: Int) {
    if #available(iOS 16.0, *) {
      UNUserNotificationCenter.current().setBadgeCount(max(count, 0))
    } else {
      DispatchQueue.main.async { UIApplication.shared.applicationIconBadgeNumber = max(count, 0) }
    }
  }

  /// A grant-authorized POST that survives the app being suspended: the
  /// action may have launched the app in the background just for this.
  private func post(path: String, grant: String, body: [String: Any], done: @escaping (Bool) -> Void) {
    guard let base = CallCore.config?.apiBaseUrl, let url = URL(string: base + path) else {
      done(false)
      return
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("Bearer \(grant)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    request.timeoutInterval = 20

    var task: UIBackgroundTaskIdentifier = .invalid
    let finish: (Bool) -> Void = { ok in
      done(ok)
      DispatchQueue.main.async {
        if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
        task = .invalid
      }
    }
    DispatchQueue.main.async {
      task = UIApplication.shared.beginBackgroundTask(withName: "poolse-notification-action") {
        if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
        task = .invalid
      }
      URLSession.shared.dataTask(with: request) { _, response, error in
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if error != nil || !(200..<300).contains(status) {
          pcTrace("notification action \(path) failed status=\(status) error=\(String(describing: error))")
        }
        finish(error == nil && (200..<300).contains(status))
      }.resume()
    }
  }
}
