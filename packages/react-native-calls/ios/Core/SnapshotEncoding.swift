import Foundation

/// One remote participant as the JS `Snapshot.participants[]` entry.
public struct SnapshotParticipant: Equatable {
  /// The LiveKit identity.
  public var userId: String
  public var externalId: String
  public var speaking: Bool
  public var muted: Bool
  /// True only with a published, subscribed, unmuted camera track.
  public var cameraOn: Bool

  public init(userId: String, externalId: String, speaking: Bool, muted: Bool, cameraOn: Bool) {
    self.userId = userId
    self.externalId = externalId
    self.speaking = speaking
    self.muted = muted
    self.cameraOn = cameraOn
  }

  public var dictionary: [String: Any] {
    ["userId": userId, "externalId": externalId, "speaking": speaking, "muted": muted, "cameraOn": cameraOn]
  }
}

public extension Phase {
  var wire: String {
    switch self {
    case .idle: return "idle"
    case .ringingIn: return "ringing_in"
    case .ringingOut: return "ringing_out"
    case .connecting: return "connecting"
    case .active: return "active"
    case .reconnecting: return "reconnecting"
    case .ended: return "ended"
    }
  }
}

public extension Direction {
  var wire: String { rawValue.lowercased() }
}

public extension MachineState {
  /// The one place a MachineState becomes the contract's `Snapshot`
  /// (CONTRACT.md §8; mirrors SnapshotJson.kt and src/index.ts). Returns nil
  /// for idle: the bridge sends `{ snapshot: null }`. The roster/route/self
  /// fields are merged in by the bridge from the media adapter.
  /// `conversationName` nil → NSNull; `reason`/`cameraFacing` omitted when nil.
  func toSnapshot(conversationName: String? = nil,
                  participants: [SnapshotParticipant] = [],
                  audioRoute: String = "earpiece",
                  mutedSelf: Bool = false,
                  cameraOn: Bool = false,
                  cameraFacing: String? = nil) -> [String: Any]? {
    if phase == .idle { return nil }
    var out: [String: Any] = [
      "cv": 1,
      "callId": callId.map { $0 as Any } ?? NSNull(),
      "conversationId": conversationId.map { $0 as Any } ?? NSNull(),
      "conversationName": conversationName.map { $0 as Any } ?? NSNull(),
      "direction": (direction ?? .incoming).wire,
      "media": media,
      "phase": phase.wire,
      "participants": participants.map { $0.dictionary },
      "audioRoute": audioRoute,
      "mutedSelf": mutedSelf,
      "cameraOn": cameraOn,
    ]
    if let reason = reason { out["reason"] = reason.wire }
    // Optional in the contract: present only while a camera is published.
    if let cameraFacing = cameraFacing { out["cameraFacing"] = cameraFacing }
    return out
  }
}
