import XCTest
@testable import PoolseCallCore

/// What the ring surface names (CA4: a scheduled meeting rings as "… is starting").
final class RingContextTests: XCTestCase {
  private func ring(_ type: String?, meeting: String?, conversation: String?, caller: String? = "Ana") -> RingContext {
    RingContext(callId: "c1", conversationId: "conv", conversationName: conversation, callerName: caller,
                media: "video", grant: "g", ringDeadlineEpochMs: 0, ringType: type, meetingTitle: meeting)
  }

  func testCallNamesConversationThenCaller() {
    XCTAssertEqual(ring(nil, meeting: nil, conversation: "Boiler").displayTitle, "Boiler")
    XCTAssertEqual(ring("call", meeting: "Ignored", conversation: nil).displayTitle, "Ana")
    XCTAssertFalse(ring(nil, meeting: nil, conversation: nil).isMeeting)
  }

  func testMeetingIsStarting() {
    XCTAssertEqual(ring("meeting", meeting: "Weekly sync", conversation: "Eng").displayTitle, "Weekly sync is starting")
    XCTAssertEqual(ring("meeting", meeting: nil, conversation: "Eng").displayTitle, "Eng is starting")
    XCTAssertEqual(ring("meeting", meeting: nil, conversation: nil).displayTitle, "Meeting is starting")
  }
}
