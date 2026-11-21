import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/errors.js';
import {
  applyLiveSegment,
  describeRecordingNotice,
  formatRecordingNoticePreview,
  isServiceParticipant,
  parseRecordingNotice,
  type LiveTranscriptSegment,
} from '../src/recording.js';
import { parseCallLog } from '../src/call-log.js';
import { CallRoom } from '../src/voice/call-room.js';
import type {
  LiveKitLocalParticipant,
  LiveKitModule,
  LiveKitParticipant,
  LiveKitRoomHandle,
} from '../src/voice/livekit-types.js';
import { buildPoolse, jsonResponse, scriptedFetch } from './_helpers.js';

const rec = {
  id: 'r-1',
  call_id: 'call-1',
  conversation_id: 'c-1',
  status: 'starting',
  mode: 'audio',
  auto: false,
  consent_required: true,
  started_by_user_id: 'u1',
  started_by: null,
  stopped_by_user_id: null,
  started_at: '2026-11-21T10:00:00Z',
  ended_at: null,
  duration_ms: null,
  size_bytes: null,
  content_type: null,
  storage: 'server',
};

describe('calls resource', () => {
  it('starts and stops a recording', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: rec }, { status: 201 }),
      jsonResponse({ data: { ...rec, status: 'stopping' } }),
    ]);
    const chat = buildPoolse(fetchFn);

    const started = await chat.calls.recording.start('call-1', { mode: 'audio' });
    expect(started.id).toBe('r-1');
    expect(fetchFn.calls[0]?.method).toBe('POST');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/calls/call-1/recording');
    expect(await fetchFn.calls[0]?.json()).toEqual({ mode: 'audio' });

    const stopped = await chat.calls.recording.stop('call-1');
    expect(stopped.status).toBe('stopping');
    expect(fetchFn.calls[1]?.method).toBe('DELETE');
  });

  it('does not retry an unavailable recorder', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse(
        { error: { code: 'recording_unavailable', message: 'No egress.' } },
        { status: 503 },
      ),
    ]);
    const chat = buildPoolse(fetchFn);
    const err = await chat.calls.recording.start('call-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('recording_unavailable');
    expect(fetchFn.calls).toHaveLength(1);
  });

  it('sends consent, lists, downloads and renames', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: { call_id: 'call-1', user_id: 'u2', decision: 'accepted' } }),
      jsonResponse({ data: [rec] }),
      jsonResponse({
        url: 'https://s3/x',
        expires_at: 'x',
        content_type: 'audio/ogg',
        size_bytes: 9,
      }),
      jsonResponse({ data: { id: 't-1', speakers: [], segments: [] } }),
      jsonResponse({ data: [] }),
    ]);
    const chat = buildPoolse(fetchFn);

    await chat.calls.consent('call-1', 'accepted');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/calls/call-1/consent');
    expect(await fetchFn.calls[0]?.json()).toEqual({ decision: 'accepted' });

    await chat.calls.recording.list('c-1', { limit: 20 });
    expect(fetchFn.calls[1]?.url).toBe(
      'https://chat.test/v1/conversations/c-1/recordings?limit=20',
    );

    const dl = await chat.calls.recording.downloadUrl('r-1');
    expect(dl.url).toBe('https://s3/x');
    expect(fetchFn.calls[2]?.url).toBe('https://chat.test/v1/recordings/r-1/download-url');

    await chat.calls.transcript.renameSpeakers('call-1', { u3: 'Dana', u4: null });
    expect(fetchFn.calls[3]?.method).toBe('PATCH');
    expect(fetchFn.calls[3]?.url).toBe('https://chat.test/v1/calls/call-1/transcript/speakers');
    expect(await fetchFn.calls[3]?.json()).toEqual({ speakers: { u3: 'Dana', u4: null } });

    await chat.calls.transcript.list('c-1');
    expect(fetchFn.calls[4]?.url).toBe('https://chat.test/v1/conversations/c-1/transcripts');
  });
});

describe('recording notices', () => {
  const body = (extra: Record<string, unknown>) =>
    JSON.stringify({
      kind: 'recording',
      v: 1,
      event: 'started',
      call_id: 'call-1',
      recording_id: 'r-1',
      mode: 'video',
      auto: false,
      consent_required: false,
      started_by_user_id: 'u1',
      stopped_by_user_id: null,
      ...extra,
    });

  it('parses system messages only, and is not a call log', () => {
    const msg = { type: 'system' as const, body: body({}) };
    expect(parseRecordingNotice(msg)?.callId).toBe('call-1');
    expect(parseRecordingNotice({ type: 'text' as const, body: body({}) })).toBeNull();
    expect(parseCallLog(msg)).toBeNull();
  });

  it('words it for the viewer, never with a raw id', () => {
    const n = parseRecordingNotice({ type: 'system', body: body({}) })!;
    expect(describeRecordingNotice(n, 'u1').summary).toBe('Recording started · by you');
    expect(describeRecordingNotice(n, 'u2', () => 'Elena').detail).toBe('by Elena');
    expect(describeRecordingNotice(n, 'u2').detail).toBeNull();

    const auto = parseRecordingNotice({
      type: 'system',
      body: body({ auto: true, started_by_user_id: null, consent_required: true, mode: 'audio' }),
    })!;
    expect(describeRecordingNotice(auto, 'u2').summary).toBe(
      'Audio recording started · Automatic, consent required',
    );

    expect(
      formatRecordingNoticePreview(body({ event: 'stopped', stopped_by_user_id: 'u2' }), 'u2'),
    ).toBe('Recording stopped · by you');
  });
});

describe('live transcript segments', () => {
  const seg = (
    speaker: string,
    start: number,
    text: string,
    final: boolean,
  ): LiveTranscriptSegment => ({
    speaker,
    speaker_user_id: speaker,
    speaker_name: speaker,
    text,
    start_ms: start,
    end_ms: start + 500,
    language: 'en',
    final,
  });

  it('replaces a speaker’s interim and keeps finals in time order', () => {
    let list = applyLiveSegment([], seg('a', 0, 'Hel', false));
    list = applyLiveSegment(list, seg('b', 100, 'Hi', false));
    list = applyLiveSegment(list, seg('a', 0, 'Hello', false));
    expect(list.map((s) => s.text)).toEqual(['Hi', 'Hello']);
    list = applyLiveSegment(list, seg('a', 0, 'Hello there.', true));
    expect(list.map((s) => [s.text, s.final])).toEqual([
      ['Hello there.', true],
      ['Hi', false],
    ]);
    list = applyLiveSegment(list, seg('b', 100, 'Hi all.', true));
    list = applyLiveSegment(list, seg('b', 100, 'Hi all.', true));
    expect(list.map((s) => s.text)).toEqual(['Hello there.', 'Hi all.']);
  });
});

describe('service participants', () => {
  it('hides poolse’s assistant and the recorder, never a phone caller', () => {
    expect(isServiceParticipant('poolse:assistant:call-1')).toBe(true);
    expect(isServiceParticipant('EG_abc')).toBe(true);
    expect(isServiceParticipant('u-1', 'agent')).toBe(true);
    expect(isServiceParticipant('u-1', 4)).toBe(true);
    expect(isServiceParticipant('u-1', 'sip')).toBe(false);
    expect(isServiceParticipant('u-1')).toBe(false);
  });
});

describe('CallRoom and consent', () => {
  function harness(canPublish: boolean) {
    const handlers = new Map<string, (...args: never[]) => void>();
    const local = {
      identity: 'u-self',
      isMicrophoneEnabled: false,
      isCameraEnabled: false,
      permissions: { canPublish },
      getTrackPublication: () => undefined,
      setCameraEnabled: vi.fn(async (on: boolean) => {
        local.isCameraEnabled = on;
      }),
      setMicrophoneEnabled: vi.fn(async (on: boolean) => {
        local.isMicrophoneEnabled = on;
      }),
    };
    const person = (identity: string): LiveKitParticipant => ({
      identity,
      getTrackPublication: () => undefined,
    });
    const room = {
      localParticipant: local as unknown as LiveKitLocalParticipant,
      remoteParticipants: new Map<string, LiveKitParticipant>([
        ['u-2', person('u-2')],
        ['poolse:assistant:call-1', person('poolse:assistant:call-1')],
      ]),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      on: (event: string, handler: (...args: never[]) => void) => handlers.set(event, handler),
      off: () => {},
    } as unknown as LiveKitRoomHandle;
    const module: LiveKitModule = {
      Room: function Room() {
        return room;
      } as unknown as LiveKitModule['Room'],
      RoomEvent: { ParticipantPermissionsChanged: 'participantPermissionsChanged' },
      Track: { Source: { Camera: 'camera' } },
    };
    const callRoom = new CallRoom({
      livekit: module,
      video: true,
      aloneGraceMs: 0,
      tokenProvider: async () => ({ url: 'wss://x', token: 't', room: 'r', expires_at: 0 }),
    });
    return { callRoom, local, handlers, room };
  }

  it('leaves the assistant out of the roster', async () => {
    const h = harness(true);
    await h.callRoom.join();
    expect(h.callRoom.getParticipants().map((p) => p.userId)).toEqual(['u-self', 'u-2']);
  });

  it('publishes nothing until allowed, then brings mic and camera back', async () => {
    const h = harness(false);
    const errors: Error[] = [];
    h.callRoom.onError((e) => errors.push(e));
    const seen: boolean[] = [];
    h.callRoom.onPublishPermission((v) => seen.push(v));

    await h.callRoom.join();
    expect(h.local.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(h.callRoom.canPublish()).toBe(false);
    expect(errors).toEqual([]);

    h.local.permissions.canPublish = true;
    h.handlers.get('participantPermissionsChanged')!(
      ...([{ canPublish: false }, h.room.localParticipant] as never[]),
    );
    await vi.waitFor(() => expect(h.local.isCameraEnabled).toBe(true));
    expect(h.local.isMicrophoneEnabled).toBe(true);
    expect(seen).toEqual([true]);
  });
});

describe('transcript helpers', () => {
  it('finds text ignoring case and accents', async () => {
    const { findInText, groupTranscript } = await import('../src/recording.js');
    expect(findInText('Café au lait, CAFE noir', 'cafe')).toEqual([
      [0, 4],
      [14, 18],
    ]);
    expect(findInText('anything', '  ')).toEqual([]);
    const s = (speaker: string, start: number) => ({
      speaker,
      speaker_user_id: null,
      speaker_name: null,
      text: 'x',
      start_ms: start,
      end_ms: start + 100,
      language: null,
    });
    const blocks = groupTranscript([s('a', 0), s('a', 200), s('b', 400), s('a', 600)]);
    expect(blocks.map((b) => [b.speaker, b.segments.length, b.name])).toEqual([
      ['a', 2, 'Speaker'],
      ['b', 1, 'Speaker'],
      ['a', 1, 'Speaker'],
    ]);
  });
});
