import { describe, expect, it } from 'vitest';

import { isCallOver, isStalePush, readPush } from '../src/voice/useVoipCalls.js';

// This decides whether a pushed call is dismissed right after being
// reported. Getting it wrong is silent and total: an over-eager window
// suppresses live calls with nothing in the app to explain it, which is
// exactly how "the phone never rings" happened once already.
describe('isStalePush', () => {
  const NOW = 1_700_000_000_000;
  const WINDOW = 120_000;

  it('treats a fresh push as live', () => {
    expect(isStalePush(NOW - 1_000, NOW, WINDOW)).toBe(false);
  });

  it('treats a clearly old push as stale', () => {
    expect(isStalePush(NOW - WINDOW - 1, NOW, WINDOW)).toBe(true);
  });

  it('never suppresses a call with no timestamp', () => {
    // An older server, or a payload shape that changed, must not cost
    // the user every incoming call.
    expect(isStalePush(undefined, NOW, WINDOW)).toBe(false);
  });

  it('never suppresses a call whose timestamp is in the future', () => {
    // Clock skew runs both ways; a handset behind the server would
    // otherwise see every push as impossibly old.
    expect(isStalePush(NOW + 60_000, NOW, WINDOW)).toBe(false);
  });

  it('tolerates skew smaller than the window', () => {
    expect(isStalePush(NOW - WINDOW + 1_000, NOW, WINDOW)).toBe(false);
  });

  it('ignores a nonsense timestamp rather than acting on it', () => {
    expect(isStalePush(Number.NaN, NOW, WINDOW)).toBe(false);
    expect(isStalePush(Number.POSITIVE_INFINITY, NOW, WINDOW)).toBe(false);
  });

  it('is exactly-at-the-boundary safe', () => {
    // Equal to the window is not past it — ties go to ringing.
    expect(isStalePush(NOW - WINDOW, NOW, WINDOW)).toBe(false);
  });
});

// Which phases tear down the CallKit call. Both directions of getting
// this wrong have shipped: ending on `active` pulled a connected call out
// of the Dynamic Island, and never ending it left a hung-up call still
// live on the phone with dead buttons.
describe('isCallOver', () => {
  it('keeps the system call while ringing', () => {
    expect(isCallOver('ringing-in')).toBe(false);
    expect(isCallOver('ringing-out')).toBe(false);
  });

  it('keeps the system call while connected', () => {
    // The whole point of CallKit: a call in progress belongs in the
    // Dynamic Island, Recents, and the audio routing.
    expect(isCallOver('active')).toBe(false);
  });

  it('ends the system call on every terminal phase', () => {
    for (const phase of ['idle', 'declined', 'busy', 'timed-out']) {
      expect(isCallOver(phase)).toBe(true);
    }
  });

  it('leaves the system call alone when there is no state machine', () => {
    // No `calls` means no phase to read. Guessing "over" here would end
    // calls the app is still handling itself.
    expect(isCallOver(undefined)).toBe(false);
  });

  it('ends the system call for an unrecognised phase', () => {
    // A phase added later is far likelier to be terminal than not, and
    // a stuck call on the lock screen is the worse failure.
    expect(isCallOver('something-new')).toBe(true);
  });
});

// What a push is asking for. The two mistakes are not symmetrical:
// reading a ring as a teardown loses the call silently, while reading a
// teardown as a ring leaves a phone ringing for a call nobody is on.
describe('readPush', () => {
  const RING = {
    event: 'incoming' as const,
    call_id: 'call-1',
    conversation_id: 'conv-1',
    caller_user_id: 'u-them',
    caller_name: 'Zana',
    media: 'audio',
    sent_at: 1_700_000_000_000,
  };

  it('reads a ring', () => {
    const intent = readPush(RING);
    expect(intent.kind).toBe('ring');
    if (intent.kind !== 'ring') return;
    expect(intent.call.callerName).toBe('Zana');
    expect(intent.call.media).toBe('audio');
    expect(intent.sentAt).toBe(RING.sent_at);
  });

  it('reads a push with no event as a ring', () => {
    // Servers that predate the field send nothing, and for them every
    // call push was a ring. Reading those as teardowns would mean no
    // incoming calls at all.
    const { event: _event, ...older } = RING;
    expect(readPush(older).kind).toBe('ring');
  });

  it('reads a teardown', () => {
    expect(readPush({ event: 'ended', call_id: 'call-1' })).toEqual({
      kind: 'teardown',
      callId: 'call-1',
    });
  });

  it('accepts a teardown with no conversation', () => {
    // Ending a call needs only its id — requiring a conversation would
    // drop the teardown and leave the phone ringing.
    expect(readPush({ event: 'ended', call_id: 'call-1' }).kind).toBe('teardown');
  });

  it('ignores a push with no call id', () => {
    expect(readPush({ conversation_id: 'conv-1' }).kind).toBe('ignore');
    expect(readPush({ event: 'ended' }).kind).toBe('ignore');
  });

  it('ignores a ring with nowhere to answer into', () => {
    expect(readPush({ event: 'incoming', call_id: 'call-1' }).kind).toBe('ignore');
  });

  it('offers video when either field says so', () => {
    // The key is omitted rather than set to undefined: the payload type
    // uses exactOptionalPropertyTypes, and "absent" is what a server
    // that doesn't send the field actually produces.
    const { media: _media, ...noMedia } = RING;
    const asMedia = readPush({ ...RING, media: 'video' });
    const asFlag = readPush({ ...noMedia, has_video: true });
    expect(asMedia.kind === 'ring' && asMedia.call.media).toBe('video');
    expect(asFlag.kind === 'ring' && asFlag.call.media).toBe('video');
  });

  it('falls back to a usable caller name', () => {
    const { caller_name: _name, ...anonymous } = RING;
    const intent = readPush(anonymous);
    expect(intent.kind === 'ring' && intent.call.callerName).toBe('Incoming call');
  });
});
