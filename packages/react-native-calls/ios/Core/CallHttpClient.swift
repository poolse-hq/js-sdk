import Foundation

/// The HTTP adapter for the contract's three token doors (CONTRACT.md §4).
/// Direct port of android/.../CallHttpClient.kt. Every call is a bare REST
/// request with a bearer token — no session state, no SDK coupling — so the
/// core can answer a call on a cold launch with nothing but the push's grant.
///
/// Fire-and-forget methods (`decline`, `hangup`) retry transient failures a
/// few times; request/response methods surface `HttpResult` to the runtime,
/// which owns the retry policy for those (one retry).
///
/// Callbacks arrive on URLSession's delegate queue; the runtime hops them
/// onto its own serial (main) queue.
public final class CallHttpClient: HttpPort {

  public static let MAX_BEST_EFFORT_RETRIES = 3

  /// Read per request: a later `configure()` with another origin takes effect on the next call.
  private let baseUrl: () -> String
  private let session: URLSession

  public init(baseUrl: @escaping () -> String, session: URLSession = CallHttpClient.defaultSession()) {
    self.baseUrl = baseUrl
    self.session = session
  }

  /// A call action must not hang the ring surface: 9 s total ceiling (6 s
  /// without any data); the runtime retries answer/place once on top, and
  /// both attempts fit inside its 20 s CONNECTING watchdog.
  public static func defaultSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 6
    config.timeoutIntervalForResource = 9
    config.waitsForConnectivity = false
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    return URLSession(configuration: config)
  }

  public func answer(callId: String, grant: String, cb: @escaping (HttpResult) -> Void) {
    post("calls/\(callId)/answer", token: grant, body: nil, current: nil, cb: cb)
  }

  public func join(callId: String, sessionToken: String, cb: @escaping (HttpResult) -> Void) {
    post("calls/\(callId)/join", token: sessionToken, body: nil, current: nil, cb: cb)
  }

  public func place(conversationId: String, media: String, sessionToken: String,
                    cb: @escaping (HttpResult) -> Void) {
    post("conversations/\(conversationId)/calls", token: sessionToken, body: ["media": media], current: nil, cb: cb)
  }

  public func reconnect(current: CallSessionBundle, cb: @escaping (HttpResult) -> Void) {
    post("calls/\(current.callId)/reconnect", token: current.controlToken, body: nil, current: current, cb: cb)
  }

  public func decline(callId: String, auth: String, busy: Bool) {
    postBestEffort("calls/\(callId)/decline", token: auth, body: ["reason": busy ? "busy" : "declined"], attempt: 0)
  }

  public func hangup(callId: String, controlToken: String) {
    postBestEffort("calls/\(callId)/hangup", token: controlToken, body: nil, attempt: 0)
  }

  // MARK: request/response

  private func post(_ path: String, token: String, body: [String: Any]?, current: CallSessionBundle?,
                    cb: @escaping (HttpResult) -> Void) {
    guard let req = request(path, token: token, body: body) else {
      // A malformed base URL is a configuration error, not a timeout.
      cb(.failed(code: "bad_url"))
      return
    }
    session.dataTask(with: req) { data, response, error in
      if error != nil {
        cb(.timeout)
        return
      }
      guard let http = response as? HTTPURLResponse else {
        cb(.timeout)
        return
      }
      let payload = data.flatMap { String(data: $0, encoding: .utf8) }
      cb(CallHttpClient.classify(code: http.statusCode, payload: payload, current: current))
    }.resume()
  }

  // MARK: fire-and-forget with bounded retry

  private func postBestEffort(_ path: String, token: String, body: [String: Any]?, attempt: Int) {
    guard let req = request(path, token: token, body: body) else { return }
    session.dataTask(with: req) { [weak self] _, response, error in
      guard let self = self else { return }
      let retry: Bool
      if error != nil || !(response is HTTPURLResponse) {
        retry = true
      } else {
        let code = (response as! HTTPURLResponse).statusCode
        // 2xx and 4xx are both terminal here. Only transient 5xx/408/429 retries.
        retry = code == 408 || code == 429 || (500...599).contains(code)
      }
      if retry && attempt < CallHttpClient.MAX_BEST_EFFORT_RETRIES {
        self.postBestEffort(path, token: token, body: body, attempt: attempt + 1)
      }
    }.resume()
  }

  private func request(_ path: String, token: String, body: [String: Any]?) -> URLRequest? {
    var base = baseUrl()
    while base.hasSuffix("/") { base.removeLast() }
    guard let url = URL(string: "\(base)/v1/\(path)"), url.scheme != nil, url.host != nil else { return nil }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    req.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
    req.httpBody = (try? JSONSerialization.data(withJSONObject: body ?? [String: Any]())) ?? Data("{}".utf8)
    req.timeoutInterval = 9
    return req
  }

  // MARK: pure classification (unit tested without a network)

  private struct ParseError: Error { let what: String }

  /// Status + body → HttpResult (CONTRACT.md §4).
  /// 2xx that will not parse → failed("bad_body"); 404/410 → gone;
  /// 401/403 → authFailed; 503 → failed; 408/429/5xx → timeout; other → failed.
  public static func classify(code: Int, payload: String?, current: CallSessionBundle? = nil) -> HttpResult {
    switch code {
    case 200...299:
      if let b = try? parseBundle(payload, current: current) { return .ok(b) }
      return .failed(code: "bad_body")
    case 404, 410:
      return .gone
    case 401, 403:
      return .authFailed(code: errorCode(payload) ?? "http_\(code)")
    case 503:
      return .failed(code: errorCode(payload) ?? "http_503")
    case 408, 429, 500...599:
      return .timeout
    default:
      return .failed(code: errorCode(payload) ?? "http_\(code)")
    }
  }

  /// One parser for answer, join, place AND reconnect. An older server's
  /// reconnect answered only `{livekit:{url,token}}` (maybe a fresh
  /// `control_token`); with `current`, that is applied onto the existing bundle.
  public static func parseBundle(_ payload: String?, current: CallSessionBundle? = nil) throws -> CallSessionBundle {
    guard let payload = payload, let data = payload.data(using: .utf8),
          let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { throw ParseError(what: "empty or non-object body") }
    guard let livekit = root["livekit"] as? [String: Any] else { throw ParseError(what: "no livekit") }
    let call = root["call"] as? [String: Any]
    guard let call = call else {
      guard let current = current else { throw ParseError(what: "bundle without call") }
      var b = current
      b.livekitUrl = optString(livekit, "url") ?? current.livekitUrl
      b.livekitToken = try getString(livekit, "token")
      b.controlToken = optString(root, "control_token") ?? current.controlToken
      return b
    }
    guard let controlToken = optString(root, "control_token") ?? current?.controlToken else {
      throw ParseError(what: "bundle without control_token")
    }
    return CallSessionBundle(
      callId: try getString(call, "id"),
      conversationId: try getString(call, "conversation_id"),
      conversationName: optString(call, "conversation_name") ?? current?.conversationName,
      media: optString(call, "media") ?? current?.media ?? "audio",
      created: optBool(root, "created", fallback: true),
      livekitUrl: try getString(livekit, "url"),
      livekitToken: try getString(livekit, "token"),
      controlToken: controlToken,
      kind: optString(call, "kind") ?? current?.kind ?? "call"
    )
  }

  /// The server's envelope is `{"error":{"code":"…"}}`; tolerate a bare string too.
  public static func errorCode(_ payload: String?) -> String? {
    guard let payload = payload, let data = payload.data(using: .utf8),
          let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { return nil }
    if let err = root["error"] as? [String: Any] { return optString(err, "code") ?? nil }
    return optString(root, "error")
  }

  /// org.json `optString`-or-null semantics: present, non-null, a String, non-empty.
  private static func optString(_ o: [String: Any], _ key: String) -> String? {
    guard let s = o[key] as? String, !s.isEmpty else { return nil }
    return s
  }

  /// org.json (Android) `getString`: required, non-null; numbers/bools coerce to text.
  private static func getString(_ o: [String: Any], _ key: String) throws -> String {
    guard let v = o[key], !(v is NSNull) else { throw ParseError(what: "missing \(key)") }
    if let s = v as? String { return s }
    if let n = v as? NSNumber { return n.stringValue }
    throw ParseError(what: "bad \(key)")
  }

  /// org.json `optBoolean(key, fallback)`: a Bool, or "true"/"false" text.
  private static func optBool(_ o: [String: Any], _ key: String, fallback: Bool) -> Bool {
    if let n = o[key] as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue }
    if let s = (o[key] as? String)?.lowercased() {
      if s == "true" { return true }
      if s == "false" { return false }
    }
    return fallback
  }
}
