import type { Recording, Transcript, TranscriptSpeaker, TranscriptWithSegments } from '@poolse/sdk';
import { ApiError } from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';

import { onReconnect } from './capture-state.js';
import { usePoolse } from './provider.js';

export interface UseTranscript {
  /** The transcript with speakers and segments; null while loading or when there is none. */
  transcript: TranscriptWithSegments | null;
  loading: boolean;
  /** The call was never transcribed (`not_found`). */
  missing: boolean;
  error: Error | null;
  /**
   * Correct speaker names: key → name, or null to put back the person's
   * own. For someone who took part in the call or the conversation's
   * owners and admins — otherwise rejects with `ApiError` `forbidden`.
   */
  renameSpeakers: (names: Record<string, string | null>) => Promise<void>;
  refresh: () => void;
}

function withSpeakers(
  t: TranscriptWithSegments,
  speakers: TranscriptSpeaker[],
): TranscriptWithSegments {
  const names = new Map(speakers.map((s) => [s.key, s.name]));
  return {
    ...t,
    speakers,
    segments: t.segments.map((s) =>
      names.has(s.speaker) ? { ...s, speaker_name: names.get(s.speaker) ?? null } : s,
    ),
  };
}

/**
 * A call's stored transcript (`GET /v1/calls/:id/transcript`), for a
 * viewer: speakers, every segment, speaker renames — kept live by
 * `transcript:speakers` (someone else renaming) and re-read on
 * `transcript:ready` (the call ended and the transcript is complete).
 */
export function useTranscript(callId: string | null): UseTranscript {
  const chat = usePoolse();
  const [transcript, setTranscript] = useState<TranscriptWithSegments | null>(null);
  const [loading, setLoading] = useState(!!callId);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    if (!callId) return;
    const mine = ++seq.current;
    setLoading(true);
    chat.calls.transcript
      .get(callId)
      .then((t) => {
        if (mine !== seq.current) return;
        setTranscript(t);
        setMissing(false);
        setError(null);
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        if (err instanceof ApiError && err.status === 404) {
          setMissing(true);
          setTranscript(null);
        } else setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [chat, callId]);

  useEffect(() => {
    setTranscript(null);
    setMissing(false);
    setError(null);
    setLoading(!!callId);
    refresh();
  }, [callId, refresh]);

  const conversationId = transcript?.conversation_id ?? null;
  useEffect(() => {
    if (!callId || !conversationId) return;
    const conv = chat.realtime.conversation(conversationId);
    const offSpeakers = conv.onTranscriptSpeakers((evt) => {
      if (evt.call_id !== callId) return;
      seq.current++;
      setTranscript((t) => (t ? withSpeakers(t, evt.speakers) : t));
    });
    const offReady = conv.onTranscriptReady((evt) => {
      if (evt.call_id === callId) refresh();
    });
    const offStatus = onReconnect(chat, refresh);
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- bumping the live counter is the point
      seq.current++; // a read still in flight is for the old key
      offSpeakers();
      offReady();
      offStatus();
    };
  }, [chat, callId, conversationId, refresh]);

  const renameSpeakers = useCallback(
    async (names: Record<string, string | null>) => {
      if (!callId) return;
      const t = await chat.calls.transcript.renameSpeakers(callId, names);
      seq.current++;
      setTranscript(t);
    },
    [chat, callId],
  );

  return { transcript, loading, missing, error, renameSpeakers, refresh };
}

export interface UseCaptureList<T> {
  items: T[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

function useCaptureList<T>(
  conversationId: string | null,
  load: (conversationId: string) => Promise<T[]>,
  subscribe: (conversationId: string, refresh: () => void) => () => void,
): UseCaptureList<T> {
  const chat = usePoolse();
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(!!conversationId);
  const [error, setError] = useState<Error | null>(null);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;

  const refresh = useCallback(() => {
    if (!conversationId) return;
    const mine = ++seq.current;
    setLoading(true);
    loadRef
      .current(conversationId)
      .then((list) => {
        if (mine !== seq.current) return;
        setItems(list);
        setError(null);
      })
      .catch((err: unknown) => {
        if (mine === seq.current) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [conversationId]);

  useEffect(() => {
    setItems([]);
    if (!conversationId) {
      setLoading(false);
      return;
    }
    refresh();
    const off = subscribeRef.current(conversationId, refresh);
    const offStatus = onReconnect(chat, refresh);
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- bumping the live counter is the point
      seq.current++; // a read still in flight is for the old key
      off();
      offStatus();
    };
  }, [chat, conversationId, refresh]);

  return { items, loading, error, refresh };
}

/** A conversation's transcripts, newest first (no segments) — re-read when one becomes ready. */
export function useTranscripts(
  conversationId: string | null,
  opts: { limit?: number } = {},
): UseCaptureList<Transcript> {
  const chat = usePoolse();
  return useCaptureList(
    conversationId,
    (id) => chat.calls.transcript.list(id, opts.limit !== undefined ? { limit: opts.limit } : {}),
    (id, refresh) => {
      const conv = chat.realtime.conversation(id);
      const offs = [conv.onTranscriptStarted(refresh), conv.onTranscriptReady(refresh)];
      return () => offs.forEach((off) => off());
    },
  );
}

/**
 * A conversation's recordings, newest first — re-read as one starts and
 * finishes. Play or save one with `poolse.calls.recording.downloadUrl(id)`.
 */
export function useRecordings(
  conversationId: string | null,
  opts: { limit?: number } = {},
): UseCaptureList<Recording> {
  const chat = usePoolse();
  return useCaptureList(
    conversationId,
    (id) => chat.calls.recording.list(id, opts.limit !== undefined ? { limit: opts.limit } : {}),
    (id, refresh) => {
      const conv = chat.realtime.conversation(id);
      const offs = [
        conv.onRecordingStarted(refresh),
        conv.onRecordingStopped(refresh),
        conv.onRecordingReady(refresh),
      ];
      return () => offs.forEach((off) => off());
    },
  );
}
