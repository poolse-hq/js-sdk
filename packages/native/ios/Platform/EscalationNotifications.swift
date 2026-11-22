import Foundation
import UIKit
import UserNotifications

/// An agent attending a meeting for the user asks them something its brief
/// doesn't cover (server docs/AGENTS_IN_CALLS.md §5). The server sends an
/// alert push with category `poolse_agent_escalation`; iOS shows it, and
/// this answers its actions natively — Approve, Decline, and Answer (an
/// inline text field) — from the lock screen with the app killed.
///
/// The reply is `POST /v1/agent-escalations/:id/reply` with the push's
/// `reply_token` in the body and no Authorization header: the token names
/// that escalation and person only, works once, until `expires_at`. It
/// goes to the push's own server (its `tenant_id`), the push's
/// `reply_url` only when that server isn't configured here.
///
/// A failure posts "Couldn't send your answer" with the same actions
/// (while trying again can still work). Results reach JS as
/// `onNotificationAction` with `action: "escalation"`.
///
/// `PoolseMessageReplyRequiresUnlock` (the config plugin's
/// `messageReplyRequiresUnlock`) makes these actions ask for Face ID / the
/// passcode first too.
enum EscalationNotifications {
  static let category = "poolse_agent_escalation"
  static let approveAction = "poolse_escalation_approve"
  static let declineAction = "poolse_escalation_decline"
  static let answerAction = "poolse_escalation_answer"

  /// The category, registered with the message one (MessageNotifications).
  static func makeCategory(requireUnlock: Bool) -> UNNotificationCategory {
    let options: UNNotificationActionOptions = requireUnlock ? [.authenticationRequired] : []
    let approve = UNNotificationAction(identifier: approveAction, title: "Approve", options: options)
    let decline = UNNotificationAction(identifier: declineAction, title: "Decline", options: options)
    let answer = UNTextInputNotificationAction(
      identifier: answerAction,
      title: "Answer",
      options: options,
      textInputButtonTitle: "Send",
      textInputPlaceholder: "Your answer"
    )
    return UNNotificationCategory(
      identifier: category,
      actions: [approve, decline, answer],
      intentIdentifiers: [],
      hiddenPreviewsBodyPlaceholder: "Your agent has a question",
      options: []
    )
  }

  /// An action on an escalation notification. False for a plain tap (the
  /// host opens the conversation) or a dismissal.
  static func didReceive(_ response: UNNotificationResponse) -> Bool {
    let decision: String
    switch response.actionIdentifier {
    case approveAction: decision = "approve"
    case declineAction: decision = "decline"
    case answerAction: decision = "answer"
    default: return false
    }
    let content = response.notification.request.content
    let info = content.userInfo
    func str(_ key: String) -> String? { (info[key] as? String).flatMap { $0.isEmpty ? nil : $0 } }
    guard let id = str("escalation_id") else { return true }
    let server = ServerRegistry.shared.servers.resolve(tenantId: str("tenant_id"))
    var event: [String: Any] = [
      "action": "escalation",
      "escalationId": id,
      "decision": decision,
      "conversationId": str("conversation_id") ?? "",
      "callId": str("call_id") ?? NSNull(),
    ]
    if let sid = server?.id { event["serverId"] = sid }

    var body: [String: Any] = [:]
    if decision == "answer" {
      let text = String(((response as? UNTextInputNotificationResponse)?.userText ?? "")
        .trimmingCharacters(in: .whitespacesAndNewlines).prefix(1000))
      guard !text.isEmpty else { return true }
      body["answer"] = text
      event["text"] = text
    } else {
      body["decision"] = decision
    }

    guard let token = str("reply_token") else {
      event["ok"] = false
      event["error"] = "no_token"
      MessageNotifications.report(event)
      postFailure(content, reason: "Open the app to answer.", retry: false)
      return true
    }
    body["token"] = token

    var origin = server?.apiBaseUrl ?? ServerRegistry.shared.baseUrl(nil)
    if origin.isEmpty { origin = CallCore.persistedApiBaseUrl() ?? "" }
    let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
    let url = !origin.isEmpty
      ? URL(string: "\(origin)/v1/agent-escalations/\(encodedId)/reply")
      : str("reply_url").flatMap(URL.init(string:))
    guard let url = url else {
      event["ok"] = false
      event["error"] = "not_configured"
      MessageNotifications.report(event)
      postFailure(content, reason: "Open the app to answer.", retry: false)
      return true
    }

    // Started before anything async: iOS may suspend a background-launched
    // app right after the delegate returns.
    let background = BackgroundTask(name: "poolse-escalation-\(decision)")
    send(url: url, body: body, background: background) { status, code in
      let ok = (200..<300).contains(status)
      event["ok"] = ok
      if !ok {
        event["error"] = code ?? (status == 0 ? "network" : "http_\(status)")
        if status != 0 { event["status"] = status }
        let retry = ![401, 404, 409, 410].contains(status)
        postFailure(content, reason: reason(status), retry: retry)
      }
      MessageNotifications.report(event)
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { background.end() }
    }
    return true
  }

  /// "Couldn't send your answer" — with the same actions and token while
  /// trying again can still work.
  private static func postFailure(_ original: UNNotificationContent, reason: String, retry: Bool) {
    let content = UNMutableNotificationContent()
    content.title = "Couldn't send your answer"
    content.body = "\(original.body)\n\(reason)"
    content.threadIdentifier = original.threadIdentifier
    content.sound = .default
    var info = original.userInfo
    info["poolse_escalation_failed"] = "1"
    if !retry { info.removeValue(forKey: "reply_token") }
    content.userInfo = info
    if retry { content.categoryIdentifier = category }
    let id = (original.userInfo["escalation_id"] as? String) ?? UUID().uuidString
    let request = UNNotificationRequest(identifier: "poolse-escalation-failed-\(id)", content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request) { error in
      if let error = error { pcTrace("escalation failure notification refused: \(error)") }
    }
  }

  private static func reason(_ status: Int) -> String {
    switch status {
    case 0: return "No connection. Try again."
    case 401: return "This notification expired. Open the app to answer."
    case 404: return "This question is gone."
    case 409: return "It was already answered."
    case 410: return "Too late — the question expired."
    case 422: return "The answer couldn't be sent (1 to 1000 characters)."
    case 429: return "Too many tries. Wait a moment."
    default: return "Something went wrong. Try again."
    }
  }

  private static let session: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 15
    config.waitsForConnectivity = false
    return URLSession(configuration: config)
  }()

  /// The POST, retried once after a second only when nothing came back
  /// (the token works once: an answered request is never sent again).
  private static func send(url: URL, body: [String: Any], background: BackgroundTask, attempt: Int = 1,
                           done: @escaping (Int, String?) -> Void) {
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    session.dataTask(with: request) { data, response, error in
      let status = error == nil ? ((response as? HTTPURLResponse)?.statusCode ?? 0) : 0
      let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
      let code = (json?["error"] as? [String: Any])?["code"] as? String
      if status == 0 && attempt < 2 {
        DispatchQueue.main.async {
          guard background.remaining > 20 else { return done(status, code) }
          DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            send(url: url, body: body, background: background, attempt: attempt + 1, done: done)
          }
        }
        return
      }
      if !(200..<300).contains(status) {
        pcTrace("escalation reply failed status=\(status) code=\(code ?? "-") error=\(String(describing: error))")
      }
      done(status, code)
    }.resume()
  }
}
