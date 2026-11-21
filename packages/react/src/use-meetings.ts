// Meetings after the call: asking them (RT8) and playing their
// recordings (RT9, RT13).

import type { MeetingAnswer } from '@poolse/sdk';
import { ASK_QUESTION_MAX } from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';

import { usePoolse } from './provider.js';

export interface UseAskMeetings {
  /** The latest answer; null before the first one or after `reset`. */
  answer: MeetingAnswer | null;
  /** The question the answer is for. */
  question: string | null;
  loading: boolean;
  error: Error | null;
  /** Ask (an empty question is ignored; a longer one is cut at `ASK_QUESTION_MAX`). */
  ask: (question: string) => Promise<MeetingAnswer | null>;
  /** Cancel a question on its way and clear the answer. */
  reset: () => void;
}

/**
 * Ask what was said in your meetings (`POST /v1/meetings/ask`): in one
 * call (`callId`) or all of them. A new question cancels the one before.
 */
export function useAskMeetings(opts: { callId?: string | null } = {}): UseAskMeetings {
  const chat = usePoolse();
  const callId = opts.callId ?? null;
  const [answer, setAnswer] = useState<MeetingAnswer | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => () => inflight.current?.abort(), []);

  const reset = useCallback(() => {
    inflight.current?.abort();
    inflight.current = null;
    setAnswer(null);
    setQuestion(null);
    setLoading(false);
    setError(null);
  }, []);

  // Another meeting: the old answer no longer fits.
  useEffect(() => reset, [callId, reset]);

  const ask = useCallback(
    async (q: string) => {
      const text = q.trim().slice(0, ASK_QUESTION_MAX);
      if (!text) return null;
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      setQuestion(text);
      setLoading(true);
      setError(null);
      try {
        const res = await chat.meetings.ask({
          question: text,
          ...(callId ? { callId } : {}),
          signal: controller.signal,
        });
        if (inflight.current !== controller) return null;
        setAnswer(res);
        return res;
      } catch (err) {
        if (inflight.current !== controller) return null;
        if ((err as DOMException)?.name === 'AbortError') return null;
        setError(err instanceof Error ? err : new Error(String(err)));
        return null;
      } finally {
        if (inflight.current === controller) {
          inflight.current = null;
          setLoading(false);
        }
      }
    },
    [chat, callId],
  );

  return { answer, question, loading, error, ask, reset };
}

export interface UseRecordingUrl {
  /** A short-lived link to the file; null while loading. */
  url: string | null;
  contentType: string | null;
  loading: boolean;
  error: Error | null;
  /** Fetch a fresh link — call it when the media fails (links last 5 minutes). */
  refresh: () => void;
}

/**
 * A playable link to a finished recording
 * (`GET /v1/recordings/:id/download-url`). Links expire after five
 * minutes: a player calls `refresh()` when loading fails and resumes
 * where it was. `not_ready` (409) while the file is still being saved.
 */
export function useRecordingUrl(recordingId: string | null): UseRecordingUrl {
  const chat = usePoolse();
  const [url, setUrl] = useState<string | null>(null);
  const [contentType, setContentType] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!recordingId);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!recordingId) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    chat.calls.recording
      .downloadUrl(recordingId, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setUrl(res.url);
        setContentType(res.content_type);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    return () => controller.abort();
  }, [chat, recordingId, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { url, contentType, loading, error, refresh };
}
