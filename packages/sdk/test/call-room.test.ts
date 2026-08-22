import { describe, expect, it, vi } from 'vitest';

import { CallRoom } from '../src/voice/call-room.js';
import type {
  CallConnection,
  LiveKitLocalParticipant,
  LiveKitModule,
  LiveKitParticipant,
  LiveKitPublication,
  LiveKitRoomHandle,
} from '../src/voice/livekit-types.js';

// No real SFU here. What matters is the contract with the app: that a
// deployment without an SFU is distinguishable from a broken one, that
// the camera and microphone are only published after the room accepts
// us, and that the roster reflects what people are actually sending.

const CONNECTION: CallConnection = {
  url: 'wss://livekit.example.com',
  token: 'tok',
  room: 'conversation:c-1',
  expires_at: 9_999_999_999,
};

function fakeParticipant(
  identity: string,
  overrides: Partial<LiveKitParticipant> & { cameraTrack?: LiveKitPublication } = {},
): LiveKitParticipant {
  return {
    identity,
    name: overrides.name,
    isMicrophoneEnabled: overrides.isMicrophoneEnabled ?? true,
    isCameraEnabled: overrides.isCameraEnabled ?? false,
    isSpeaking: overrides.isSpeaking ?? false,
    getTrackPublication: () => overrides.cameraTrack,
  };
}

interface Harness {
  module: LiveKitModule;
  room: LiveKitRoomHandle;
  local: LiveKitLocalParticipant;
  handlers: Map<string, (...args: never[]) => void>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function harness(opts: { connectRejects?: boolean } = {}): Harness {
  const handlers = new Map<string, (...args: never[]) => void>();

  const local = {
    identity: 'u-self',
    isMicrophoneEnabled: false,
    isCameraEnabled: false,
    isSpeaking: false,
    getTrackPublication: () => undefined,
    setCameraEnabled: vi.fn(async (enabled: boolean) => {
      local.isCameraEnabled = enabled;
    }),
    setMicrophoneEnabled: vi.fn(async (enabled: boolean) => {
      local.isMicrophoneEnabled = enabled;
    }),
  } as unknown as LiveKitLocalParticipant & {
    isCameraEnabled: boolean;
    isMicrophoneEnabled: boolean;
  };

  const connect = vi.fn(async () => {
    if (opts.connectRejects) throw new Error('sfu unreachable');
  });
  const disconnect = vi.fn(async () => {});

  const room = {
    localParticipant: local,
    remoteParticipants: new Map<string, LiveKitParticipant>(),
    connect,
    disconnect,
    on: (event: string, handler: (...args: never[]) => void) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
  } as unknown as LiveKitRoomHandle;

  const module: LiveKitModule = {
    Room: function Room(this: unknown) {
      return room;
    } as unknown as LiveKitModule['Room'],
    RoomEvent: {
      ParticipantConnected: 'participantConnected',
      ParticipantDisconnected: 'participantDisconnected',
      TrackSubscribed: 'trackSubscribed',
      TrackUnsubscribed: 'trackUnsubscribed',
      TrackMuted: 'trackMuted',
      TrackUnmuted: 'trackUnmuted',
      LocalTrackPublished: 'localTrackPublished',
      LocalTrackUnpublished: 'localTrackUnpublished',
      ActiveSpeakersChanged: 'activeSpeakersChanged',
      Disconnected: 'disconnected',
    },
    Track: { Source: { Camera: 'camera', Microphone: 'microphone' } },
  };

  return { module, room, local, handlers, connect, disconnect };
}

describe('CallRoom availability', () => {
  it('reports no-SFU as false rather than throwing', async () => {
    // A deployment without an SFU is a supported configuration, not a
    // failure. The caller falls back to the mesh; telling the user their
    // call failed would be wrong.
    const h = harness();
    const room = new CallRoom({ livekit: h.module, tokenProvider: async () => null });

    await expect(room.join()).resolves.toBe(false);
    expect(room.getStatus()).toBe('idle');
    expect(h.connect).not.toHaveBeenCalled();
  });

  it('a token error is a real failure and surfaces', async () => {
    const h = harness();
    const room = new CallRoom({
      livekit: h.module,
      tokenProvider: async () => {
        throw new Error('403');
      },
    });

    await expect(room.join()).rejects.toThrow(/call token unavailable/);
    expect(room.getStatus()).toBe('error');
  });

  it('a failed connection tears down rather than leaving a half-open room', async () => {
    const h = harness({ connectRejects: true });
    const room = new CallRoom({ livekit: h.module, tokenProvider: async () => CONNECTION });

    await expect(room.join()).rejects.toThrow(/call media failed/);
    expect(h.disconnect).toHaveBeenCalled();
  });
});

describe('CallRoom publishing', () => {
  it('publishes only after the room accepts us', async () => {
    // Acquiring the camera before connecting would light the capture
    // indicator for a call that may never happen.
    const order: string[] = [];
    const h = harness();
    h.connect.mockImplementation(async () => void order.push('connect'));
    (h.local.setMicrophoneEnabled as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('mic');
    });
    (h.local.setCameraEnabled as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('camera');
    });

    const room = new CallRoom({
      livekit: h.module,
      tokenProvider: async () => CONNECTION,
      video: true,
    });
    await room.join();

    expect(order).toEqual(['connect', 'mic', 'camera']);
  });

  it('an audio call does not touch the camera at all', async () => {
    const h = harness();
    const room = new CallRoom({ livekit: h.module, tokenProvider: async () => CONNECTION });

    await room.join();

    expect(h.local.setCameraEnabled).not.toHaveBeenCalled();
    expect(h.local.setMicrophoneEnabled).toHaveBeenCalledWith(true);
  });

  it('joins muted when asked', async () => {
    const h = harness();
    const room = new CallRoom({
      livekit: h.module,
      tokenProvider: async () => CONNECTION,
      muted: true,
    });

    await room.join();

    expect(h.local.setMicrophoneEnabled).toHaveBeenCalledWith(false);
  });

  it('turns the camera on and off mid-call', async () => {
    const h = harness();
    const room = new CallRoom({ livekit: h.module, tokenProvider: async () => CONNECTION });
    await room.join();

    await room.setCameraEnabled(true);
    expect(room.isCameraEnabled()).toBe(true);

    // Off must genuinely unpublish rather than send black frames, so the
    // capture indicator goes out and the uplink is freed.
    await room.setCameraEnabled(false);
    expect(room.isCameraEnabled()).toBe(false);
  });

  it('a refused camera does not end the call', async () => {
    const h = harness();
    (h.local.setCameraEnabled as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('camera in use'),
    );

    const room = new CallRoom({ livekit: h.module, tokenProvider: async () => CONNECTION });
    await room.join();

    const errors: Error[] = [];
    room.onError((e) => errors.push(e));

    await expect(room.setCameraEnabled(true)).resolves.toBeUndefined();
    expect(room.getStatus()).toBe('connected');
    expect(errors[0]?.message).toMatch(/could not change camera/);
  });
});

describe('CallRoom roster', () => {
  it('marks the local participant as self', async () => {
    const h = harness();
    const room = new CallRoom({ livekit: h.module, tokenProvider: async () => CONNECTION });
    await room.join();

    const [self] = room.getParticipants();
    expect(self?.userId).toBe('u-self');
    expect(self?.isSelf).toBe(true);
  });

  it('identifies remote participants by poolse user id', async () => {
    // The token is minted with `sub` = the poolse user id, which is what
    // lets a client map a track back to a user without a second lookup.
    const h = harness();
    h.room.remoteParticipants.set('u-bob', fakeParticipant('u-bob', { name: 'Bob' }));

    const room = new CallRoom({ livekit: h.module, tokenProvider: async () => CONNECTION });
    await room.join();

    const bob = room.getParticipants().find((p) => p.userId === 'u-bob');
    expect(bob?.name).toBe('Bob');
    expect(bob?.isSelf).toBe(false);
  });

  it('reports no video track when the camera is muted', async () => {
    // Handing back a muted track renders a frozen last frame, which
    // reads as a stalled call rather than a camera that is off.
    const h = harness();
    h.room.remoteParticipants.set(
      'u-bob',
      fakeParticipant('u-bob', { cameraTrack: { track: {}, isMuted: true } }),
    );

    const room = new CallRoom({ livekit: h.module, tokenProvider: async () => CONNECTION });
    await room.join();

    expect(room.getParticipants().find((p) => p.userId === 'u-bob')?.videoTrack).toBeNull();
  });

  it('exposes a live camera track', async () => {
    const track = {};
    const h = harness();
    h.room.remoteParticipants.set(
      'u-bob',
      fakeParticipant('u-bob', {
        isCameraEnabled: true,
        cameraTrack: { track, isMuted: false },
      }),
    );

    const room = new CallRoom({ livekit: h.module, tokenProvider: async () => CONNECTION });
    await room.join();

    const bob = room.getParticipants().find((p) => p.userId === 'u-bob');
    expect(bob?.videoTrack).toBe(track);
    expect(bob?.cameraEnabled).toBe(true);
  });

  it('re-emits the roster when a participant joins', async () => {
    const h = harness();
    const room = new CallRoom({ livekit: h.module, tokenProvider: async () => CONNECTION });
    await room.join();

    const seen: number[] = [];
    room.onParticipants((ps) => seen.push(ps.length));

    h.room.remoteParticipants.set('u-bob', fakeParticipant('u-bob'));
    h.handlers.get('participantConnected')?.();

    expect(seen.at(-1)).toBe(2);
  });

  it('goes idle when the SFU drops us', async () => {
    // A call that looks live but carries nothing is the worst state to
    // leave the UI in.
    const h = harness();
    const room = new CallRoom({ livekit: h.module, tokenProvider: async () => CONNECTION });
    await room.join();
    expect(room.getStatus()).toBe('connected');

    h.handlers.get('disconnected')?.();

    expect(room.getStatus()).toBe('idle');
  });
});

describe('CallRoom reference counting', () => {
  it('a second holder reuses the connection', async () => {
    // A call screen and a roster can both hold the same call; opening a
    // second SFU connection would publish the microphone twice.
    const h = harness();
    const room = new CallRoom({ livekit: h.module, tokenProvider: async () => CONNECTION });

    await room.join();
    await room.join();

    expect(h.connect).toHaveBeenCalledTimes(1);
  });

  it('only the last holder leaving disconnects', async () => {
    const h = harness();
    const room = new CallRoom({ livekit: h.module, tokenProvider: async () => CONNECTION });

    await room.join();
    await room.join();

    room.leave();
    expect(h.disconnect).not.toHaveBeenCalled();

    room.leave();
    expect(h.disconnect).toHaveBeenCalled();
  });
});
