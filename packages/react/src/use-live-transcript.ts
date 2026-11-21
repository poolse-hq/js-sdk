import type { LiveTranscriptSegment, Transcript, TranscriptChannel } from '@poolse/sdk';
import { applyLiveSegment } from '@poolse/sdk';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { usePoolse } from './provider.js';

export interface UseLiveTranscriptOptions {
  /** Open the transcript topic. Defaults to true; false leaves it (e.g. the panel is closed). */
  enabled?: boolean;
  /** How many final segments to keep. Defaults to 1000. */
  maxSegments?: number;
}

export interface UseLiveTranscript {
  /** Final segments in time order, then each speaker's interim one. */
  segments: LiveTranscriptSegment[];
  /** Only the final segments. */
  finals: LiveTranscriptSegment[];
  /** The speakers' current interim segments (still talking). */
  interim: LiveTranscriptSegment[];
  /** The transcript, once one exists for the call (kept live by `transcript:*` events). */
  transcript: Transcript | null;
  /** Transcription is running now. */
  live: boolean;
  /** The topic is joined and the catch-up has arrived. */
  joined: boolean;
  /** The join was refused (`forbidden`, `not_found`), or a start/stop failed. */
  error: Error | null;
  pending: boolean;
  /**
   * Start (or resume) transcription — someone in the call. Errors:
   * `not_in_call`, `transcription_disabled`, `transcription_unavailable`.
   */
  start: () => Promise<boolean>;
  stop: () => Promise<boolean>;
}

/**
 * A call's live transcript: joins `transcript:<call_id>` (opening the
 * transcript — only those who do get the stream), takes the last 200
 * final segments as catch-up, then folds in each pushed segment, an
 * interim one replacing the speaker's previous interim. Re-syncs on
 * every rejoin. `start` / `stop` switch transcription itself on and off.
 */
export function useLiveTranscript(
  callId: string | null,
  opts: UseLiveTranscriptOptions = {},
): UseLiveTranscript {
  const chat = usePoolse();
  const enabled = opts.enabled ?? true;
  const max = opts.maxSegments ?? 1000;
  const [segments, setSegments] = useState<LiveTranscriptSegment[]>([]);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setSegments([]);
    setTranscript(null);
    setJoined(false);
    setError(null);
    if (!callId || !enabled) return;

    let handle: TranscriptChannel;
    try {
      handle = chat.realtime.transcript(callId);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const offJoined = handle.onJoined((reply) => {
      setJoined(true);
      setError(null);
      setConversationId(reply.conversation_id || null);
      setTranscript(reply.transcript);
      // The catch-up is the truth after a (re)join; interims from before are stale.
      setSegments(reply.segments.slice(-max).map((s) => ({ ...s, final: true })));
    });
    const offSegment = handle.onSegment((evt) => {
      const { cv: _cv, call_id: _call, transcript_id: _t, ...seg } = evt;
      setSegments((list) => applyLiveSegment(list, seg, max));
    });
    const offError = handle.onError((reason) => {
      setJoined(false);
      setError(new Error(reason));
    });
    return () => {
      offJoined();
      offSegment();
      offError();
      handle.release();
    };
  }, [chat, callId, enabled, max]);

  // Started / stopped / ready ride the conversation channel.
  useEffect(() => {
    if (!callId || !conversationId || !enabled) return;
    const conv = chat.realtime.conversation(conversationId);
    const apply = (evt: { call_id: string; transcript: Transcript }) => {
      if (evt.call_id === callId) setTranscript(evt.transcript);
    };
    const offs = [
      conv.onTranscriptStarted(apply),
      conv.onTranscriptStopped(apply),
      conv.onTranscriptReady(apply),
      conv.onTranscriptSpeakers((evt) => {
        if (evt.call_id !== callId) return;
        const names = new Map(evt.speakers.map((s) => [s.key, s.name]));
        setSegments((list) =>
          list.map((s) =>
            names.has(s.speaker) ? { ...s, speaker_name: names.get(s.speaker)! } : s,
          ),
        );
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [chat, callId, conversationId, enabled]);

  const run = useCallback(async (fn: () => Promise<Transcript>): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      setTranscript(await fn());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  const start = useCallback(
    () => (callId ? run(() => chat.calls.transcription.start(callId)) : Promise.resolve(false)),
    [chat, callId, run],
  );
  const stop = useCallback(
    () => (callId ? run(() => chat.calls.transcription.stop(callId)) : Promise.resolve(false)),
    [chat, callId, run],
  );

  const finals = useMemo(() => segments.filter((s) => s.final), [segments]);
  const interim = useMemo(() => segments.filter((s) => !s.final), [segments]);

  return {
    segments,
    finals,
    interim,
    transcript,
    live: transcript?.status === 'live',
    joined,
    error,
    pending,
    start,
    stop,
  };
}
