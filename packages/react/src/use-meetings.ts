// Meetings after the call: the summary (RT6), asking them (RT8), clips
// (RT9) and playing their recordings (RT13).

import type { CallSummary, Clip, MeetingAnswer, RecordingPlayback } from '@poolse/sdk';
import { ASK_QUESTION_MAX, ApiError, clipFromWire, summaryFromWire } from '@poolse/sdk';
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
 * call (`callId`), one conversation's (`conversationId`) or all of them.
 * A new question cancels the one before.
 */
export function useAskMeetings(
  opts: { callId?: string | null; conversationId?: string | null } = {},
): UseAskMeetings {
  const chat = usePoolse();
  const callId = opts.callId ?? null;
  const conversationId = opts.conversationId ?? null;
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
  useEffect(() => reset, [callId, conversationId, reset]);

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
          ...(conversationId ? { conversationId } : {}),
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
    [chat, callId, conversationId],
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

export interface UseCallSummary {
  /** The newest summary seen: `initial`, then the full one / updates. */
  summary: CallSummary | null;
  loading: boolean;
  /** None yet (`404`). */
  missing: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * A call's summary, live: starts from `initial` (its chat message, via
 * `parseCallSummary`), fetches the full one (`GET /v1/calls/:id/summary`)
 * when that copy is `shortened` or absent, and again on every
 * `summary:ready` for the call (a regeneration, a failure, a deletion).
 */
export function useCallSummary(
  callId: string | null,
  initial: CallSummary | null = null,
): UseCallSummary {
  const chat = usePoolse();
  const [summary, setSummary] = useState<CallSummary | null>(initial);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const seq = useRef(0);
  const conversationId = initial?.conversationId ?? summary?.conversationId ?? null;

  const refresh = useCallback(() => {
    if (!callId) return;
    const mine = ++seq.current;
    setLoading(true);
    chat.meetings
      .summary(callId)
      .then((s) => {
        if (mine !== seq.current) return;
        setSummary(s);
        setMissing(false);
        setError(null);
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [chat, callId]);

  const needsFull = !initial || initial.shortened;
  useEffect(() => {
    if (needsFull) refresh();
  }, [refresh, needsFull]);

  useEffect(() => {
    if (!callId || !conversationId) return;
    return chat.realtime.conversation(conversationId).onSummaryReady((evt) => {
      if (evt.call_id !== callId) return;
      const s = summaryFromWire(evt.summary);
      if (s) {
        seq.current++;
        setSummary(s);
      }
      refresh();
    });
  }, [chat, callId, conversationId, refresh]);

  return { summary, loading, missing, error, refresh };
}

export interface UseRecordingPlayback {
  playback: RecordingPlayback | null;
  loading: boolean;
  error: Error | null;
  /** Fetch again — call it when the media fails (links last 5 minutes). */
  refresh: () => void;
}

/**
 * What a player needs (`GET /v1/recordings/:id/playback`): a 5-minute
 * link, chapters and the transcript in recording time. `not_ready` (409)
 * while it is being saved, `recording_deleted` (410).
 */
export function useRecordingPlayback(recordingId: string | null): UseRecordingPlayback {
  const chat = usePoolse();
  const [playback, setPlayback] = useState<RecordingPlayback | null>(null);
  const [loading, setLoading] = useState(!!recordingId);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!recordingId) {
      setPlayback(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    chat.meetings
      .playback(recordingId, controller.signal)
      .then((p) => {
        if (controller.signal.aborted) return;
        setPlayback(p);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [chat, recordingId, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { playback, loading, error, refresh };
}

export interface UseClip {
  clip: Clip | null;
  /** A link to play it once `ready` (5 minutes; `refresh` renews it). */
  url: string | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * A clip by id (`GET /v1/clips/:id`), live through `clip:ready` /
 * `clip:deleted` on its conversation, with a playable link once ready.
 * Pass `initial` (e.g. what `meetings.createClip` returned) to start from it.
 */
export function useClip(clipId: string | null, initial: Clip | null = null): UseClip {
  const chat = usePoolse();
  const [clip, setClip] = useState<Clip | null>(initial);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!clipId);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!clipId) {
      setClip(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    chat.meetings
      .clip(clipId, controller.signal)
      .then(async (c) => {
        if (controller.signal.aborted) return;
        setClip(c);
        if (c.status === 'ready') {
          const d = await chat.meetings.clipDownloadUrl(clipId, controller.signal);
          if (!controller.signal.aborted) setUrl(d.url);
        }
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [chat, clipId, nonce]);

  const conversationId = clip?.conversationId ?? null;
  useEffect(() => {
    if (!clipId || !conversationId) return;
    const conv = chat.realtime.conversation(conversationId);
    const apply = (evt: { clip: unknown }) => {
      const c = clipFromWire(evt.clip);
      if (!c || c.id !== clipId) return;
      setClip(c);
      if (c.status === 'ready') setNonce((n) => n + 1);
      if (c.status === 'deleted') setUrl(null);
    };
    const offs = [conv.onClipReady(apply), conv.onClipDeleted(apply)];
    return () => offs.forEach((off) => off());
  }, [chat, clipId, conversationId]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { clip, url, loading, error, refresh };
}
