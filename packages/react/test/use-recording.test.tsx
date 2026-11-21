import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Poolse } from '@poolse/sdk';
import { usePoolse } from '../src/provider.js';
import { useRecording } from '../src/use-recording.js';
import { useLiveTranscript } from '../src/use-live-transcript.js';
import { jsonResponse, renderHookWithProvider, scriptedFetch } from './_helpers.js';

// A conversation channel that records its handlers, so the test can play
// events into the hook.
function fakeConversation() {
  const handlers = new Map<string, (evt: unknown) => void>();
  const on = (name: string) => (fn: (evt: unknown) => void) => {
    handlers.set(name, fn);
    return () => handlers.delete(name);
  };
  const conv = new Proxy(
    {},
    {
      get: (_t, prop: string) => (prop.startsWith('on') ? on(prop) : () => {}),
    },
  );
  return { handlers, conv };
}

function spyOnce(fn: (chat: Poolse) => void) {
  let done = false;
  return (chat: Poolse) => {
    if (done) return;
    done = true;
    fn(chat);
  };
}

const snapshot = (recording: Record<string, unknown>) => ({
  cv: 1,
  call: {
    id: 'call-1',
    conversation_id: 'c-1',
    conversation_name: null,
    media: 'audio',
    state: 'live',
    started_by: { user_id: 'u1', external_id: null, display_name: null },
    started_at: null,
    ended_at: null,
    participants: [],
    ring_states: {},
    recording: {
      available: true,
      active: true,
      id: 'r-1',
      mode: 'video',
      started_at: null,
      started_by_user_id: 'u1',
      auto: false,
      consent_required: true,
      consent: { accepted: ['u1'], declined: [] },
      ...recording,
    },
    transcription: { available: true, active: false, id: null, status: null, language: null },
  },
});

describe('useRecording', () => {
  it('a late joiner sees the recording and is asked for consent', async () => {
    const fake = fakeConversation();
    const fetchFn = scriptedFetch([
      jsonResponse(snapshot({})),
      jsonResponse({ data: { call_id: 'call-1', user_id: 'u2', decision: 'accepted' } }),
    ]);
    const spy = spyOnce((chat) => {
      vi.spyOn(chat.realtime, 'conversation').mockReturnValue(fake.conv as never);
      chat.me._hydrate({ id: 'u2' } as never);
    });
    const { result } = renderHookWithProvider(() => {
      spy(usePoolse());
      return useRecording('call-1', 'c-1');
    }, fetchFn);

    await waitFor(() => expect(result.current.active).toBe(true));
    expect(result.current.consentRequired).toBe(true);
    expect(result.current.needsConsent).toBe(true);

    await act(async () => {
      await result.current.consent('accepted');
    });
    expect(await fetchFn.calls[1]?.json()).toEqual({ decision: 'accepted' });
    expect(result.current.myConsent).toBe('accepted');
    expect(result.current.needsConsent).toBe(false);

    act(() =>
      fake.handlers.get('onRecordingStopped')!({
        cv: 1,
        call_id: 'call-1',
        conversation_id: 'c-1',
        recording: { id: 'r-1', status: 'stopping' },
      }),
    );
    expect(result.current.active).toBe(false);
    expect(result.current.lastRecording?.status).toBe('stopping');
  });
});

describe('useLiveTranscript', () => {
  it('takes the catch-up, then folds interim and final segments', async () => {
    const t: {
      joined?: (r: unknown) => void;
      segment?: (e: unknown) => void;
      released: number;
    } = { released: 0 };
    const handle = {
      onJoined: (fn: (r: unknown) => void) => {
        t.joined = fn;
        return () => {};
      },
      onSegment: (fn: (e: unknown) => void) => {
        t.segment = fn;
        return () => {};
      },
      onError: () => () => {},
      release: () => {
        t.released++;
      },
    };
    const fake = fakeConversation();
    const spy = spyOnce((chat) => {
      vi.spyOn(chat.realtime, 'transcript').mockReturnValue(handle as never);
      vi.spyOn(chat.realtime, 'conversation').mockReturnValue(fake.conv as never);
    });
    const { result, unmount } = renderHookWithProvider(() => {
      spy(usePoolse());
      return useLiveTranscript('call-1');
    }, scriptedFetch([]));

    const seg = (text: string, final: boolean, start = 1000) => ({
      cv: 1,
      call_id: 'call-1',
      transcript_id: 't-1',
      speaker: 'u1',
      speaker_user_id: 'u1',
      speaker_name: 'Elena',
      text,
      start_ms: start,
      end_ms: start + 400,
      final,
      language: 'en',
    });

    act(() =>
      t.joined!({
        conversation_id: 'c-1',
        transcript: { id: 't-1', status: 'live' },
        segments: [{ ...seg('Earlier.', true, 0), final: undefined }],
      }),
    );
    expect(result.current.joined).toBe(true);
    expect(result.current.live).toBe(true);
    expect(result.current.finals.map((s) => s.text)).toEqual(['Earlier.']);

    act(() => t.segment!(seg('Hel', false)));
    act(() => t.segment!(seg('Hello', false)));
    expect(result.current.interim.map((s) => s.text)).toEqual(['Hello']);
    act(() => t.segment!(seg('Hello all.', true)));
    expect(result.current.segments.map((s) => s.text)).toEqual(['Earlier.', 'Hello all.']);
    expect(result.current.interim).toEqual([]);

    act(() =>
      fake.handlers.get('onTranscriptSpeakers')!({
        call_id: 'call-1',
        transcript_id: 't-1',
        speakers: [{ key: 'u1', name: 'Elena K.' }],
      }),
    );
    expect(result.current.segments[1]?.speaker_name).toBe('Elena K.');

    unmount();
    expect(t.released).toBe(1);
  });
});
