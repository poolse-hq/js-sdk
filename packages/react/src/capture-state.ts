// Folding recording and transcript events into a call snapshot's
// `recording` / `transcription` fields — shared by `useLiveCall` and
// `useRecording` so both agree.

import type {
  CallRecordingState,
  CallTranscriptionState,
  Poolse,
  RecordingChangedEvent,
  RecordingConsentEvent,
  RecordingStartedEvent,
  TranscriptChangedEvent,
} from '@poolse/sdk';
import { useEffect, useState } from 'react';

export interface CaptureState {
  recording: CallRecordingState | null;
  transcription: CallTranscriptionState | null;
}

export type CaptureEvent =
  | { type: 'recording:started'; evt: RecordingStartedEvent }
  | { type: 'recording:stopped'; evt: RecordingChangedEvent }
  | { type: 'recording:ready'; evt: RecordingChangedEvent }
  | { type: 'recording:consent'; evt: RecordingConsentEvent }
  | { type: 'transcript:changed'; evt: TranscriptChangedEvent };

const IDLE_RECORDING: CallRecordingState = {
  available: true,
  active: false,
  id: null,
  mode: null,
  started_at: null,
  started_by_user_id: null,
  auto: false,
  consent_required: false,
  consent: { accepted: [], declined: [] },
};

const without = (list: string[], id: string) => list.filter((x) => x !== id);

/** The capture state after one event (pure). */
export function applyCaptureEvent(state: CaptureState, e: CaptureEvent): CaptureState {
  const rec = state.recording ?? IDLE_RECORDING;
  switch (e.type) {
    case 'recording:started': {
      const r = e.evt.recording;
      const starter = r.started_by_user_id;
      return {
        ...state,
        recording: {
          ...rec,
          active: true,
          id: r.id,
          mode: r.mode,
          started_at: r.started_at,
          started_by_user_id: starter,
          auto: r.auto,
          consent_required: e.evt.consent_required,
          // Starting is accepting.
          consent: starter
            ? {
                accepted: [...without(rec.consent.accepted, starter), starter],
                declined: without(rec.consent.declined, starter),
              }
            : rec.consent,
        },
      };
    }
    case 'recording:stopped':
    case 'recording:ready':
      if (rec.id !== null && rec.id !== e.evt.recording.id) return state;
      return {
        ...state,
        recording: { ...rec, active: false, id: null, mode: null, consent_required: false },
      };
    case 'recording:consent': {
      const { user_id: who, decision } = e.evt;
      const accepted = without(rec.consent.accepted, who);
      const declined = without(rec.consent.declined, who);
      (decision === 'accepted' ? accepted : declined).push(who);
      return { ...state, recording: { ...rec, consent: { accepted, declined } } };
    }
    case 'transcript:changed': {
      const t = e.evt.transcript;
      return {
        ...state,
        transcription: {
          available: state.transcription?.available ?? true,
          active: t.status === 'live',
          id: t.id,
          status: t.status,
          language: t.language,
        },
      };
    }
  }
}

/**
 * Subscribe to a conversation's capture events for one call (any call
 * when `callId` is null) and hand each to `fn`.
 */
export function subscribeCapture(
  chat: Poolse,
  conversationId: string,
  callId: string | null,
  fn: (e: CaptureEvent) => void,
): () => void {
  const conv = chat.realtime.conversation(conversationId);
  const mine = (id: string) => callId === null || id === callId;
  const offs = [
    conv.onRecordingStarted((evt) => mine(evt.call_id) && fn({ type: 'recording:started', evt })),
    conv.onRecordingStopped((evt) => mine(evt.call_id) && fn({ type: 'recording:stopped', evt })),
    conv.onRecordingReady((evt) => mine(evt.call_id) && fn({ type: 'recording:ready', evt })),
    conv.onRecordingConsent((evt) => mine(evt.call_id) && fn({ type: 'recording:consent', evt })),
    conv.onTranscriptStarted((evt) => mine(evt.call_id) && fn({ type: 'transcript:changed', evt })),
    conv.onTranscriptStopped((evt) => mine(evt.call_id) && fn({ type: 'transcript:changed', evt })),
    conv.onTranscriptReady((evt) => mine(evt.call_id) && fn({ type: 'transcript:changed', evt })),
  ];
  return () => offs.forEach((off) => off());
}

/** The signed-in user's poolse id, without fetching (`me` is loaded by the provider's users). */
export function useMeId(chat: Poolse): string | null {
  const [id, setId] = useState<string | null>(() => chat.me.peek()?.id ?? null);
  useEffect(() => {
    setId(chat.me.peek()?.id ?? null);
    return chat.me.onChange((me) => setId(me.id));
  }, [chat]);
  return id;
}

/**
 * Calls `fn` when the socket comes back after a drop (not on the first
 * connect): events sent meanwhile are gone, so re-read.
 */
export function onReconnect(chat: Poolse, fn: () => void): () => void {
  let wasConnected = chat.realtime.getStatus() === 'connected';
  let connectedBefore = wasConnected;
  return chat.realtime.onStatus((status) => {
    if (status === 'connected' && !wasConnected && connectedBefore) fn();
    wasConnected = status === 'connected';
    connectedBefore ||= wasConnected;
  });
}
