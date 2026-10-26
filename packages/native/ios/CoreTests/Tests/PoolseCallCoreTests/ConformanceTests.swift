import Foundation
import XCTest
@testable import PoolseCallCore

/// Runs every vector from contracts/call-core/vectors.json against the
/// machine (port of the JVM ConformanceTest). A red test means the machine
/// or the contract must change — never "adjust the test".
final class ConformanceTests: XCTestCase {

  static var vectorsURL: URL {
    // .../packages/native/ios/CoreTests/Tests/PoolseCallCoreTests/ThisFile.swift
    var u = URL(fileURLWithPath: #filePath)
    for _ in 0..<7 { u.deleteLastPathComponent() }
    return u.appendingPathComponent("contracts/call-core/vectors.json")
  }

  func testMachineConformsToTheContractVectors() throws {
    let data = try Data(contentsOf: Self.vectorsURL)
    let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let vectors = try XCTUnwrap(root["vectors"] as? [[String: Any]])
    XCTAssertFalse(vectors.isEmpty)
    var failures: [String] = []
    for v in vectors {
      let name = v["name"] as! String
      let given = v["given"] as! [String: Any]
      let event = v["event"] as! [String: Any]
      let expect = v["expect"] as! [String: Any]
      let result = CallMachine.transition(parseState(given), try parseEvent(event, given))
      let problems = diff(expect, result)
      if !problems.isEmpty { failures.append("x \(name)\n   " + problems.joined(separator: "\n   ")) }
    }
    print("conformance: \(vectors.count - failures.count)/\(vectors.count) vectors passed")
    if !failures.isEmpty {
      XCTFail("\(failures.count)/\(vectors.count) vectors failed:\n" + failures.joined(separator: "\n"))
    }
  }

  private func phaseOf(_ wire: String) -> Phase { Phase(rawValue: wire.uppercased())! }

  private func parseState(_ g: [String: Any]) -> MachineState {
    let phase = phaseOf(g["phase"] as! String)
    if phase == .idle { return .IDLE }
    return MachineState(
      phase: phase,
      callId: (g["callId"] as? String) ?? "c1",
      direction: (g["direction"] as? String).map { Direction(rawValue: $0.uppercased())! },
      reason: (g["reason"] as? String).map { w in EndReason.allCasesList.first { $0.wire == w }! },
      httpAttempts: (g["httpAttempts"] as? Int) ?? 1,
      waiting: (g["waitingCallId"] as? String).map { WaitingCall(callId: $0, conversationId: nil, media: "audio") }
    )
  }

  struct UnknownEvent: Error { let type: String }

  private func parseEvent(_ e: [String: Any], _ g: [String: Any]) throws -> Event {
    let callId = (e["callId"] as? String) ?? (g["callId"] as? String) ?? "c1"
    let type = e["type"] as! String
    switch type {
    case "PUSH_RING", "SOCKET_RING":
      return .ring(callId: callId, media: (e["media"] as? String) ?? "audio", stale: (e["stale"] as? Bool) ?? false)
    case "RING_ENDED": return .ringEnded(callId: callId, reason: e["reason"] as! String)
    case "CALL_FINISHED": return .callFinished(callId: callId, reason: e["reason"] as? String)
    case "USER_ANSWER": return .userAnswer
    case "USER_DECLINE": return .userDecline
    case "USER_PLACE": return .userPlace(callId: callId, media: (e["media"] as? String) ?? "audio")
    case "USER_JOIN": return .userJoin(callId: callId)
    case "USER_HANGUP": return .userHangup
    case "HTTP_OK": return .httpOk(created: (e["created"] as? Bool) ?? true)
    case "HTTP_GONE": return .httpGone
    case "HTTP_TIMEOUT": return .httpTimeout
    case "HTTP_FAILED": return .httpFailed(code: (e["code"] as? String) ?? "failed")
    case "MEDIA_CONNECTED": return .mediaConnected
    case "MEDIA_FAILED": return .mediaFailed
    case "MEDIA_LOST": return .mediaLost
    case "MEDIA_RECONNECTING": return .mediaReconnecting
    case "MEDIA_RECOVERED": return .mediaRecovered
    case "REMOTE_JOINED": return .remoteJoined
    case "ALL_RINGS_RESOLVED": return .allRingsResolved(outcome: e["outcome"] as! String)
    case "RING_DEADLINE": return .ringDeadline
    case "RECONNECT_BUDGET_ELAPSED": return .reconnectBudgetElapsed
    case "LINGER_ELAPSED": return .lingerElapsed
    case "CONNECT_TIMEOUT": return .connectTimeout
    case "USER_ANSWER_WAITING": return .userAnswerWaiting
    case "USER_DECLINE_WAITING": return .userDeclineWaiting
    case "WAITING_DEADLINE": return .waitingDeadline
    default: throw UnknownEvent(type: type)
    }
  }

  private func diff(_ expect: [String: Any], _ actual: Transition) -> [String] {
    var problems: [String] = []
    let wantPhase = phaseOf(expect["phase"] as! String)
    if actual.state.phase != wantPhase { problems.append("phase: expected \(wantPhase), got \(actual.state.phase)") }
    if let want = expect["reason"] as? String, actual.state.reason?.wire != want {
      problems.append("reason: expected \(want), got \(String(describing: actual.state.reason?.wire))")
    }
    if let want = expect["callId"] as? String, actual.state.callId != want {
      problems.append("callId: expected \(want), got \(String(describing: actual.state.callId))")
    }
    if let want = expect["direction"] as? String, actual.state.direction?.wire != want {
      problems.append("direction: expected \(want), got \(String(describing: actual.state.direction))")
    }
    if expect.keys.contains("waitingCallId") {
      let want = expect["waitingCallId"] as? String // NSNull → nil: none waiting
      if actual.state.waiting?.callId != want {
        problems.append("waitingCallId: expected \(String(describing: want)), got \(String(describing: actual.state.waiting?.callId))")
      }
    }
    let wantEffects = expect["effects"] as! [String]
    let gotEffects = actual.effects.map { $0.wire }
    if wantEffects != gotEffects { problems.append("effects: expected \(wantEffects), got \(gotEffects)") }
    return problems
  }
}

extension EndReason {
  static let allCasesList: [EndReason] = [.left, .finished, .declinedAll, .busyAll, .noAnswer, .cancelled, .connectionLost, .failed]
}
