import type {
  CallRecordingState,
  CallTranscriptionState,
  ConsentDecision,
  Recording,
  RecordingMode,
} from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';

import { applyCaptureEvent, onReconnect, subscribeCapture, useMeId } from './capture-state.js';
import type { CaptureState } from './capture-state.js';
import { usePoolse } from './provider.js';

export interface UseRecording {
  /** This server can record (LiveKit Egress). False: hide the Record button. */
  available: boolean;
  /** The call is being recorded right now. */
  active: boolean;
  /** The snapshot's recording state, kept live; null until read. */
  recording: CallRecordingState | null;
  /** The live-transcript state, kept live; null until read. */
  transcription: CallTranscriptionState | null;
  /** Something is capturing the call: a recording or a live transcript. */
  capturing: boolean;
  /**
   * Capture needs everyone's consent: whoever hasn't accepted may not
   * publish (the workspace's or room's `consent: "required"`).
   */
  consentRequired: boolean;
  /** Your answer for this call; `accepted` too when you started the recording. */
  myConsent: ConsentDecision | null;
  /**
   * Show the consent prompt: the call is captured, consent is required
   * and you haven't accepted. Declining keeps it true — you stay
   * listen-only and may change your mind.
   */
  needsConsent: boolean;
  /**
   * How people were told when the recording started here: `spoken` (the
   * assistant said it aloud) or `banner` (no speech on this server — your
   * banner is the notice). Null until a start was seen on this screen.
   */
  notice: 'spoken' | 'banner' | null;
  /** The latest recording of this call seen in an event (its `status` moves to `ready` or `failed`). */
  lastRecording: Recording | null;
  /** A start, stop or consent request is in flight. */
  pending: boolean;
  /** The last request's failure (`ApiError.code`: `not_allowed`, `egress_failed`, …), cleared by the next. */
  error: Error | null;
  /** Start recording (`mode` defaults to the room's). Resolves false on failure (see `error`). */
  start: (mode?: RecordingMode) => Promise<boolean>;
  stop: () => Promise<boolean>;
  /**
   * Answer the consent prompt. After `accepted`, the SFU lets you publish
   * again: `CallRoom` republishes by itself (or use `useCallRoom().republish`).
   */
  consent: (decision: ConsentDecision) => Promise<boolean>;
  /** Re-read the call snapshot. */
  refresh: () => void;
}

/**
 * A call's recording and consent state, with the actions — what a Record
 * button, a "Recording" banner and a consent prompt need. Reads the call
 * snapshot on mount (so a late joiner sees it at once) and after every
 * reconnect, then follows `recording:*` / `transcript:*` events.
 *
 *     const rec = useRecording(call.id, call.conversation_id);
 *     {rec.active && <RecordingBanner … />}
 *     {rec.needsConsent && <ConsentPrompt onAnswer={rec.consent} />}
 *
 * Pass `initial` (e.g. `useLiveCall().call`) to skip the first read.
 */
export function useRecording(
  callId: string | null,
  conversationId: string | null,
  initial?: {
    id: string;
    recording?: CallRecordingState;
    transcription?: CallTranscriptionState;
  } | null,
): UseRecording {
  const chat = usePoolse();
  const meId = useMeId(chat);
  const [state, setState] = useState<CaptureState>(() =>
    initial && initial.id === callId
      ? { recording: initial.recording ?? null, transcription: initial.transcription ?? null }
      : { recording: null, transcription: null },
  );
  const [notice, setNotice] = useState<'spoken' | 'banner' | null>(null);
  const [lastRecording, setLastRecording] = useState<Recording | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [transcriptConsent, setTranscriptConsent] = useState(false);
  const seq = useRef(0);
  const hasInitial = useRef(!!initial && initial.id === callId);

  const refresh = useCallback(() => {
    if (!callId || !conversationId) return;
    const mine = ++seq.current;
    chat.liveCalls
      .get(conversationId)
      .then((c) => {
        if (mine !== seq.current) return;
        if (c && c.id === callId)
          setState({ recording: c.recording ?? null, transcription: c.transcription ?? null });
        else
          setState((s) => ({
            recording: s.recording ? { ...s.recording, active: false } : null,
            transcription: s.transcription ? { ...s.transcription, active: false } : null,
          }));
      })
      .catch(() => {
        // Keep what we have; the next event or reconnect corrects it.
      });
  }, [chat, callId, conversationId]);

  useEffect(() => {
    if (!callId || !conversationId) {
      setState({ recording: null, transcription: null });
      return;
    }
    if (hasInitial.current) hasInitial.current = false;
    else refresh();
    const offCapture = subscribeCapture(chat, conversationId, callId, (e) => {
      seq.current++; // newer than any read in flight
      setState((s) => applyCaptureEvent(s, e));
      if (e.type === 'recording:started') {
        setNotice(e.evt.notice);
        setLastRecording(e.evt.recording);
      } else if (e.type === 'recording:stopped' || e.type === 'recording:ready') {
        setLastRecording(e.evt.recording);
      }
    });
    const conv = chat.realtime.conversation(conversationId);
    const offFinished = conv.onCallFinished((evt) => {
      if (evt.call_id !== callId) return;
      seq.current++;
      setState((s) => ({
        recording: s.recording ? { ...s.recording, active: false } : null,
        transcription: s.transcription ? { ...s.transcription, active: false } : null,
      }));
    });
    const offStatus = onReconnect(chat, refresh);
    return () => {
      offCapture();
      offFinished();
      offStatus();
    };
  }, [chat, callId, conversationId, refresh]);

  // A live transcript alone doesn't say whether it needs consent; the
  // room's effective policy does.
  const transcribing = !!state.transcription?.active;
  useEffect(() => {
    if (!conversationId || !transcribing) {
      setTranscriptConsent(false);
      return;
    }
    let cancelled = false;
    chat.calls.recording
      .settings(conversationId)
      .then((s) => {
        if (!cancelled) setTranscriptConsent(s.effective.consent === 'required');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [chat, conversationId, transcribing]);

  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  const start = useCallback(
    (mode?: RecordingMode) =>
      run(async () => {
        if (!callId) throw new Error('no call');
        const r = await chat.calls.recording.start(callId, mode ? { mode } : {});
        setLastRecording(r);
      }),
    [chat, callId, run],
  );

  const stop = useCallback(
    () =>
      run(async () => {
        if (!callId) throw new Error('no call');
        const r = await chat.calls.recording.stop(callId);
        setLastRecording(r);
      }),
    [chat, callId, run],
  );

  const consent = useCallback(
    (decision: ConsentDecision) =>
      run(async () => {
        if (!callId) throw new Error('no call');
        const res = await chat.calls.consent(callId, decision);
        // Don't wait for the event to close the prompt.
        setState((s) =>
          applyCaptureEvent(s, {
            type: 'recording:consent',
            evt: { cv: 1, call_id: res.call_id, user_id: res.user_id, decision: res.decision },
          }),
        );
      }),
    [chat, callId, run],
  );

  const rec = state.recording;
  const active = !!rec?.active;
  const capturing = active || transcribing;
  const consentRequired =
    (active && !!rec?.consent_required) || (transcribing && transcriptConsent);
  const myConsent: ConsentDecision | null =
    meId && rec
      ? rec.consent.accepted.includes(meId) || (active && rec.started_by_user_id === meId)
        ? 'accepted'
        : rec.consent.declined.includes(meId)
          ? 'declined'
          : null
      : null;

  return {
    available: rec?.available ?? false,
    active,
    recording: rec,
    transcription: state.transcription,
    capturing,
    consentRequired,
    myConsent,
    needsConsent: capturing && consentRequired && myConsent !== 'accepted',
    notice,
    lastRecording,
    pending,
    error,
    start,
    stop,
    consent,
    refresh,
  };
}
