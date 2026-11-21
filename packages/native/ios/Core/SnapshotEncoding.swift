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
  /// True with a published, subscribed, unmuted screen share.
  public var screenSharing: Bool
  /// Their link to the SFU: `good` | `poor` | `lost` (dropped, coming
  /// back — "Reconnecting…") | `unknown`.
  public var connectionQuality: String

  public init(userId: String, externalId: String, speaking: Bool, muted: Bool, cameraOn: Bool,
              connectionQuality: String = "unknown", screenSharing: Bool = false) {
    self.userId = userId
    self.externalId = externalId
    self.speaking = speaking
    self.muted = muted
    self.cameraOn = cameraOn
    self.connectionQuality = connectionQuality
    self.screenSharing = screenSharing
  }

  public var dictionary: [String: Any] {
    ["userId": userId, "externalId": externalId, "speaking": speaking, "muted": muted, "cameraOn": cameraOn,
     "connectionQuality": connectionQuality, "screenSharing": screenSharing]
  }
}

/// One place call audio can play, as a JS `Snapshot.audioOutputs[]` entry.
public struct AudioOutput: Equatable {
  /// Stable for the device's lifetime in this call; passed back to `setAudioOutput`.
  public var id: String
  /// `earpiece` | `speaker` | `bluetooth` | `headset`.
  public var kind: String
  /// What the device calls itself ("AirPods Pro"), or a plain default for built-ins.
  public var name: String

  public init(id: String, kind: String, name: String) {
    self.id = id
    self.kind = kind
    self.name = name
  }

  public var dictionary: [String: Any] { ["id": id, "kind": kind, "name": name] }
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

/// JSON object text → a dictionary for the bridge; NSNull when absent or not an object.
private func jsonObject(_ text: String?) -> Any {
  guard let text = text, let data = text.data(using: .utf8),
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return NSNull() }
  return obj
}

public extension MachineState {
  /// The one place a MachineState becomes the contract's `Snapshot`
  /// (CALL_CONTRACT.md §8; mirrors SnapshotJson.kt and src/index.ts). Returns nil
  /// for idle: the bridge sends `{ snapshot: null }`. The roster/route/self
  /// fields are merged in by the bridge from the media adapter.
  /// `conversationName` nil → NSNull; `reason`/`cameraFacing` omitted when nil.
  func toSnapshot(conversationName: String? = nil,
                  kind: String = "call",
                  participants: [SnapshotParticipant] = [],
                  audioRoute: String = "earpiece",
                  audioOutputs: [AudioOutput] = [],
                  audioOutputId: String? = nil,
                  mutedSelf: Bool = false,
                  cameraOn: Bool = false,
                  cameraFacing: String? = nil,
                  waiting: RingContext? = nil,
                  connectionQuality: String = "unknown",
                  videoPaused: Bool = false,
                  screenSharing: Bool = false,
                  canPublish: Bool = true,
                  recording: String? = nil,
                  transcription: String? = nil) -> [String: Any]? {
    if phase == .idle { return nil }
    var out: [String: Any] = [
      "cv": 1,
      "callId": callId.map { $0 as Any } ?? NSNull(),
      "conversationId": conversationId.map { $0 as Any } ?? NSNull(),
      "conversationName": conversationName.map { $0 as Any } ?? NSNull(),
      "kind": kind,
      "direction": (direction ?? .incoming).wire,
      "media": media,
      "phase": phase.wire,
      "participants": participants.map { $0.dictionary },
      "audioRoute": audioRoute,
      "audioOutputs": audioOutputs.map { $0.dictionary },
      "audioOutputId": audioOutputId.map { $0 as Any } ?? NSNull(),
      "mutedSelf": mutedSelf,
      "cameraOn": cameraOn,
      "connectionQuality": connectionQuality,
      "videoPaused": videoPaused,
      "screenSharing": screenSharing,
      // false while the server holds our media back (recording consent
      // not given yet, docs/RECORDING.md §5): listen-only until it lets go.
      "canPublish": canPublish,
      // The CallSummary's capture state, as of joining (null: not known).
      "recording": jsonObject(recording),
      "transcription": jsonObject(transcription),
    ]
    // The call waiting beside this one: null when none.
    if let w = self.waiting {
      out["waiting"] = [
        "callId": w.callId,
        "conversationId": (waiting?.conversationId ?? w.conversationId).map { $0 as Any } ?? NSNull(),
        "conversationName": waiting?.conversationName.map { $0 as Any } ?? NSNull(),
        "callerName": waiting?.callerName.map { $0 as Any } ?? NSNull(),
        "media": w.media,
      ] as [String: Any]
    } else {
      out["waiting"] = NSNull()
    }
    if let reason = reason { out["reason"] = reason.wire }
    // Optional in the contract: present only while a camera is published.
    if let cameraFacing = cameraFacing { out["cameraFacing"] = cameraFacing }
    return out
  }
}
