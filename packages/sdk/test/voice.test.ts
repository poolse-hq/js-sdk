import type { Channel, Socket } from 'phoenix';
import { describe, expect, it, vi } from 'vitest';

import { CallsResource } from '../src/voice/calls.js';
import type {
  VoiceCandidate,
  VoiceDescription,
  VoiceIceServer,
  VoicePeerConnection,
  VoiceStream,
  VoiceTrack,
  WebRtcAdapter,
} from '../src/voice/types.js';
import { VoiceRoom } from '../src/voice/voice-room.js';

// No real socket or WebRTC stack here. What matters is the wire
// contract — the exact payload shapes poolse's VoiceChannel accepts —
// and the negotiation rules that decide who offers, so those are what
// these fakes let us observe.

interface Pushed {
  event: string;
  payload: Record<string, unknown>;
}

function fakeChannel(pushed: Pushed[]) {
  const handlers = new Map<string, (payload: unknown) => void>();
  const reply = {
    receive(status: string, cb: (arg: unknown) => void) {
      if (status === 'ok') cb({});
      return reply;
    },
  };

  const channel = {
    on(event: string, cb: (payload: unknown) => void) {
      handlers.set(event, cb);
    },
    push(event: string, payload: Record<string, unknown>) {
      pushed.push({ event, payload });
      return reply;
    },
    join: () => reply,
    leave: vi.fn(),
  } as unknown as Channel;

  return { channel, handlers, emit: (e: string, p: unknown) => handlers.get(e)?.(p) };
}

function fakeSocket(channel: Channel): Socket {
  return { channel: () => channel } as unknown as Socket;
}

/** `remoteDescription` is readonly on the real interface, so the fake is
 *  built through a mutable mirror and cast once at the end. */
type MutablePeerConnection = {
  -readonly [K in keyof VoicePeerConnection]: VoicePeerConnection[K];
};

function fakePeerConnection(): VoicePeerConnection {
  const pc: MutablePeerConnection = {
    remoteDescription: null,
    connectionState: 'new',
    onicecandidate: null,
    ontrack: null,
    onconnectionstatechange: null,
    addTrack: vi.fn(),
    createOffer: vi.fn(async (): Promise<VoiceDescription> => ({ type: 'offer', sdp: 'OFFER' })),
    createAnswer: vi.fn(async (): Promise<VoiceDescription> => ({ type: 'answer', sdp: 'ANSWER' })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async (d: VoiceDescription) => {
      pc.remoteDescription = d;
    }),
    addIceCandidate: vi.fn(async () => {}),
    close: vi.fn(),
  };
  return pc as VoicePeerConnection;
}

function fakeAdapter(pc: VoicePeerConnection): WebRtcAdapter {
  const track: VoiceTrack = { kind: 'audio', enabled: true, stop: vi.fn() };
  const stream: VoiceStream = {
    id: 'local',
    getTracks: () => [track],
    getAudioTracks: () => [track],
  };
  return {
    createPeerConnection: () => pc,
    getUserMedia: async () => stream,
    playRemoteStream: () => () => {},
  };
}

/** Join a room and settle it on a known self id. */
async function joinedRoom(selfId: string) {
  const pushed: Pushed[] = [];
  const { channel, emit } = fakeChannel(pushed);
  const pc = fakePeerConnection();
  const room = new VoiceRoom('conv-1', fakeSocket(channel), {
    webrtc: fakeAdapter(pc),
    detectSpeaking: false,
  });

  await room.join();
  emit('voice:joined', { user_id: selfId });
  return { room, pushed, emit, pc };
}

describe('VoiceRoom signalling', () => {
  it('wraps every signal body in `data`', async () => {
    // The server's validate_signal_data/1 rejects the whole push when
    // `data` is missing, and a rejected signal is never relayed — so a
    // top-level `sdp` silently produces a call with no audio.
    const { pushed, emit } = await joinedRoom('user-a');

    // "user-b" sorts after "user-a", so we are the offerer.
    emit('voice:joined', { user_id: 'user-b' });
    await vi.waitFor(() => expect(pushed.some((p) => p.event === 'voice:signal')).toBe(true));

    const signal = pushed.find((p) => p.event === 'voice:signal');
    expect(signal?.payload['type']).toBe('offer');
    expect(signal?.payload['target_user_id']).toBe('user-b');
    expect(signal?.payload['data']).toEqual({ sdp: 'OFFER' });
    expect(signal?.payload['sdp']).toBeUndefined();
  });

  it('only the lexicographically lower id offers, so the two never collide', async () => {
    const { pushed, emit } = await joinedRoom('user-z');

    // "user-b" sorts before us: they offer, we wait.
    emit('voice:joined', { user_id: 'user-b' });
    await new Promise((r) => setTimeout(r, 10));

    expect(pushed.filter((p) => p.event === 'voice:signal')).toHaveLength(0);
  });

  it('answers an inbound offer under `data`', async () => {
    const { pushed, emit } = await joinedRoom('user-a');

    emit('voice:signal', {
      from_user_id: 'user-b',
      target_user_id: 'user-a',
      type: 'offer',
      data: { sdp: 'REMOTE_OFFER' },
    });

    await vi.waitFor(() => {
      const answer = pushed.find((p) => p.payload['type'] === 'answer');
      expect(answer?.payload['data']).toEqual({ sdp: 'ANSWER' });
    });
  });

  it('queues ICE that arrives before the remote description, then flushes it', async () => {
    const { emit, pc } = await joinedRoom('user-a');
    const candidate: VoiceCandidate = { candidate: 'candidate:1', sdpMid: '0' };

    // Candidates routinely outrun their offer. Applying one now would
    // throw and the candidate would be lost, stranding ICE.
    emit('voice:signal', {
      from_user_id: 'user-b',
      target_user_id: 'user-a',
      type: 'ice-candidate',
      data: candidate,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(pc.addIceCandidate).not.toHaveBeenCalled();

    emit('voice:signal', {
      from_user_id: 'user-b',
      target_user_id: 'user-a',
      type: 'offer',
      data: { sdp: 'REMOTE_OFFER' },
    });

    await vi.waitFor(() => expect(pc.addIceCandidate).toHaveBeenCalledWith(candidate));
  });

  it('ignores signals addressed to somebody else', async () => {
    const { emit, pc } = await joinedRoom('user-a');

    emit('voice:signal', {
      from_user_id: 'user-b',
      target_user_id: 'user-c',
      type: 'offer',
      data: { sdp: 'NOT_FOR_US' },
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(pc.setRemoteDescription).not.toHaveBeenCalled();
  });
});

describe('VoiceRoom roster', () => {
  it('marks the local participant and tracks mute + speaking', async () => {
    const { room, emit } = await joinedRoom('user-a');
    emit('voice:joined', { user_id: 'user-b' });

    emit('voice:active_speaker', { user_id: 'user-b', speaking: true });
    emit('voice:mute', { user_id: 'user-b', muted: true });

    const participants = room.getParticipants();
    expect(participants.find((p) => p.userId === 'user-a')?.isSelf).toBe(true);
    const peer = participants.find((p) => p.userId === 'user-b');
    expect(peer?.speaking).toBe(true);
    expect(peer?.muted).toBe(true);
  });

  it('drops a participant that leaves', async () => {
    const { room, emit } = await joinedRoom('user-a');
    emit('voice:joined', { user_id: 'user-b' });
    expect(room.getParticipants()).toHaveLength(2);

    emit('voice:left', { user_id: 'user-b' });
    expect(room.getParticipants().map((p) => p.userId)).toEqual(['user-a']);
  });

  it('muting clears the speaking flag so the indicator cannot stick lit', async () => {
    const { room, emit } = await joinedRoom('user-a');
    emit('voice:active_speaker', { user_id: 'user-a', speaking: true });

    room.setMuted(true);

    expect(room.getParticipants().find((p) => p.isSelf)?.speaking).toBe(false);
  });
});

describe('VoiceRoom sharing', () => {
  // PoolseRealtime hands out ONE room per conversation, so a call screen
  // and an always-on voice bar for the same conversation share this
  // instance. That is correct — a user is in one audio session — but it
  // means teardown has to be reference counted.
  it('stays connected while another holder still has it', async () => {
    const pushed: Pushed[] = [];
    const { channel, emit } = fakeChannel(pushed);
    const pc = fakePeerConnection();
    const room = new VoiceRoom('conv-1', fakeSocket(channel), {
      webrtc: fakeAdapter(pc),
      detectSpeaking: false,
    });

    await room.join();
    emit('voice:joined', { user_id: 'user-a' });
    await room.join();

    room.leave();

    // The first holder let go; the second is still in the room, so the
    // session must survive — otherwise hanging up a call silences the
    // voice bar the user is also sitting in.
    expect(room.getStatus()).toBe('connected');
    expect(pushed.some((p) => p.event === 'voice:leave')).toBe(false);
  });

  it('tears down once the last holder leaves', async () => {
    const pushed: Pushed[] = [];
    const { channel, emit } = fakeChannel(pushed);
    const pc = fakePeerConnection();
    const room = new VoiceRoom('conv-1', fakeSocket(channel), {
      webrtc: fakeAdapter(pc),
      detectSpeaking: false,
    });

    await room.join();
    emit('voice:joined', { user_id: 'user-a' });
    await room.join();

    room.leave();
    room.leave();

    expect(room.getStatus()).toBe('idle');
    expect(pushed.some((p) => p.event === 'voice:leave')).toBe(true);
  });

  it('a second join reuses the session rather than opening another', async () => {
    const pushed: Pushed[] = [];
    const { channel, emit } = fakeChannel(pushed);
    const pc = fakePeerConnection();
    const room = new VoiceRoom('conv-1', fakeSocket(channel), {
      webrtc: fakeAdapter(pc),
      detectSpeaking: false,
    });

    await room.join();
    emit('voice:joined', { user_id: 'user-a' });
    await room.join();

    // Two channels and two meshes for one conversation would duplicate
    // every participant and every stream.
    expect(pushed.filter((p) => p.event === 'voice:join')).toHaveLength(1);
  });

  it('an extra leave cannot drive the count negative', async () => {
    const pushed: Pushed[] = [];
    const { channel, emit } = fakeChannel(pushed);
    const pc = fakePeerConnection();
    const room = new VoiceRoom('conv-1', fakeSocket(channel), {
      webrtc: fakeAdapter(pc),
      detectSpeaking: false,
    });

    await room.join();
    emit('voice:joined', { user_id: 'user-a' });

    room.leave();
    room.leave();
    room.leave();

    // A stray leave must not leave the room owing claims, or the next
    // join would need several leaves to actually hang up.
    await room.join();
    emit('voice:joined', { user_id: 'user-a' });
    room.leave();
    expect(room.getStatus()).toBe('idle');
  });
});

describe('CallsResource', () => {
  it('places a call and maps the reply out of snake_case', async () => {
    const pushed: Pushed[] = [];
    const handlers = new Map<string, (p: unknown) => void>();
    const reply = {
      receive(status: string, cb: (arg: unknown) => void) {
        if (status === 'ok') {
          cb({ call_id: 'c1', conversation_id: 'conv-1', callee_user_ids: ['u2', 'u3'] });
        }
        return reply;
      },
    };
    const channel = {
      on: (e: string, cb: (p: unknown) => void) => handlers.set(e, cb),
      push: (event: string, payload: Record<string, unknown>) => {
        pushed.push({ event, payload });
        return reply;
      },
    } as unknown as Channel;

    const calls = new CallsResource(() => channel);
    const placed = await calls.invite('conv-1');

    expect(pushed[0]?.event).toBe('call:invite');
    expect(pushed[0]?.payload).toEqual({ conversation_id: 'conv-1' });
    expect(placed).toEqual({
      callId: 'c1',
      conversationId: 'conv-1',
      calleeUserIds: ['u2', 'u3'],
    });
  });

  it('surfaces an inbound ring in camelCase', () => {
    const handlers = new Map<string, (p: unknown) => void>();
    const channel = {
      on: (e: string, cb: (p: unknown) => void) => handlers.set(e, cb),
      push: () => ({ receive: () => ({ receive: () => ({ receive: () => undefined }) }) }),
    } as unknown as Channel;

    const calls = new CallsResource(() => channel);
    const seen: unknown[] = [];
    calls.onIncoming((c) => seen.push(c));

    handlers.get('call:incoming')?.({
      call_id: 'c9',
      conversation_id: 'conv-9',
      caller_user_id: 'u1',
    });

    expect(seen).toEqual([{ callId: 'c9', conversationId: 'conv-9', callerUserId: 'u1' }]);
  });

  it('sends a busy signal under the caller-directed payload shape', async () => {
    const pushed: Pushed[] = [];
    const reply = {
      receive(status: string, cb: (arg: unknown) => void) {
        if (status === 'ok') cb({});
        return reply;
      },
    };
    const channel = {
      on: vi.fn(),
      push: (event: string, payload: Record<string, unknown>) => {
        pushed.push({ event, payload });
        return reply;
      },
    } as unknown as Channel;

    const calls = new CallsResource(() => channel);
    await calls.markBusy({ callId: 'c1', conversationId: 'conv-1', callerUserId: 'u1' });

    expect(pushed[0]?.event).toBe('call:busy');
    expect(pushed[0]?.payload).toEqual({
      call_id: 'c1',
      conversation_id: 'conv-1',
      caller_user_id: 'u1',
    });
  });

  it('surfaces a busy reply for the caller', () => {
    const handlers = new Map<string, (p: unknown) => void>();
    const channel = {
      on: (e: string, cb: (p: unknown) => void) => handlers.set(e, cb),
      push: () => ({ receive: () => ({ receive: () => ({ receive: () => undefined }) }) }),
    } as unknown as Channel;

    const calls = new CallsResource(() => channel);
    const seen: unknown[] = [];
    calls.onBusy((c) => seen.push(c));

    handlers.get('call:busy')?.({
      call_id: 'c2',
      conversation_id: 'conv-2',
      user_id: 'u2',
    });

    expect(seen).toEqual([{ callId: 'c2', conversationId: 'conv-2', userId: 'u2' }]);
  });

  it('rejects when the server refuses the invite', async () => {
    const reply = {
      receive(status: string, cb: (arg: unknown) => void) {
        if (status === 'error') cb({ reason: 'forbidden' });
        return reply;
      },
    };
    const channel = {
      on: vi.fn(),
      push: () => reply,
    } as unknown as Channel;

    const calls = new CallsResource(() => channel);
    await expect(calls.invite('conv-1')).rejects.toThrow(/forbidden/);
  });
});

// TURN credentials expire, so they cannot be resolved once and reused.
// Getting this wrong is invisible in development — STUN alone works on
// the networks you build on, and only fails behind the symmetric NAT of
// a mobile carrier, where the call connects and carries no media.
describe('VoiceRoom ICE servers', () => {
  /** Records what each peer connection was actually constructed with. */
  function recordingAdapter(seen: VoiceIceServer[][]): WebRtcAdapter {
    const base = fakeAdapter(fakePeerConnection());
    return {
      ...base,
      createPeerConnection: (iceServers: VoiceIceServer[]) => {
        seen.push(iceServers);
        return fakePeerConnection();
      },
    };
  }

  const TURN: VoiceIceServer[] = [
    { urls: ['turn:turn.example.com:3478'], username: '9999:u-1', credential: 'derived' },
  ];

  it('negotiates with the servers the provider returned', async () => {
    const seen: VoiceIceServer[][] = [];
    const { channel, emit } = fakeChannel([]);

    const room = new VoiceRoom('conv-1', fakeSocket(channel), {
      webrtc: recordingAdapter(seen),
      detectSpeaking: false,
      iceServersProvider: async () => TURN,
    });

    await room.join();
    emit('voice:joined', { user_id: 'user-a' });
    emit('voice:joined', { user_id: 'user-b' });

    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]).toEqual(TURN);
  });

  it('connects without TURN when the provider fails', async () => {
    const seen: VoiceIceServer[][] = [];
    const { channel, emit } = fakeChannel([]);

    const room = new VoiceRoom('conv-1', fakeSocket(channel), {
      webrtc: recordingAdapter(seen),
      detectSpeaking: false,
      iceServers: [{ urls: 'stun:fallback.example.com' }],
      iceServersProvider: async () => {
        throw new Error('ice endpoint down');
      },
    });

    // A room that refused to connect because the ICE endpoint blipped
    // would be worse than one that connects without a relay — which is
    // how calls behaved before TURN existed.
    await expect(room.join()).resolves.toBeUndefined();

    emit('voice:joined', { user_id: 'user-a' });
    emit('voice:joined', { user_id: 'user-b' });

    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]).toEqual([{ urls: 'stun:fallback.example.com' }]);
  });

  it('keeps the configured servers when the provider returns none', async () => {
    const seen: VoiceIceServer[][] = [];
    const { channel, emit } = fakeChannel([]);

    const room = new VoiceRoom('conv-1', fakeSocket(channel), {
      webrtc: recordingAdapter(seen),
      detectSpeaking: false,
      iceServers: [{ urls: 'stun:fallback.example.com' }],
      iceServersProvider: async () => [],
    });

    await room.join();
    emit('voice:joined', { user_id: 'user-a' });
    emit('voice:joined', { user_id: 'user-b' });

    // An empty list would leave the connection with nowhere to gather
    // candidates from at all — worse than the default.
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]).toEqual([{ urls: 'stun:fallback.example.com' }]);
  });

  it('re-resolves on every join, because credentials expire', async () => {
    const { channel } = fakeChannel([]);
    let calls = 0;

    const room = new VoiceRoom('conv-1', fakeSocket(channel), {
      webrtc: fakeAdapter(fakePeerConnection()),
      detectSpeaking: false,
      iceServersProvider: async () => {
        calls += 1;
        return TURN;
      },
    });

    await room.join();
    room.leave();
    await room.join();

    expect(calls).toBe(2);
  });

  it('does not re-resolve for a second holder of a live room', async () => {
    const { channel } = fakeChannel([]);
    let calls = 0;

    const room = new VoiceRoom('conv-1', fakeSocket(channel), {
      webrtc: fakeAdapter(fakePeerConnection()),
      detectSpeaking: false,
      iceServersProvider: async () => {
        calls += 1;
        return TURN;
      },
    });

    // The call screen and the voice bar can hold the same room. The
    // second holder joins an already-negotiated session, so re-fetching
    // would be a request that changes nothing.
    await room.join();
    await room.join();

    expect(calls).toBe(1);
  });
});
