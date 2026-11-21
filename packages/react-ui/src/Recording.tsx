// Recording and consent UI (docs/RECORDING.md): the banner everyone in a
// captured call sees, a small indicator for tiles and headers, the
// consent prompt, and the chat line for the recording notice. Same props
// in @poolse/react-native.
//
//     const rec = useRecording(call.id, call.conversation_id);
//     <RecordingBanner recording={rec.active} transcribing={!!rec.transcription?.active} … />
//     {rec.needsConsent && (
//       <ConsentPrompt
//         recording={rec.active}
//         onAnswer={rec.consent}
//         onAccepted={() => void media.republish()}
//       />
//     )}

import type { ConsentDecision, Message, RecordingMode, Uuid } from '@poolse/sdk';
import { captureLabel, recordingNoticeDisplayFor } from '@poolse/react';
import { useEffect, useId, useRef, useState } from 'react';

export interface RecordingBannerProps {
  /** A recording is running. */
  recording: boolean;
  /** A live transcript is running. */
  transcribing?: boolean;
  mode?: RecordingMode | null;
  /** Capture needs consent here (`useRecording().consentRequired`). */
  consentRequired?: boolean;
  /** Your answer (`useRecording().myConsent`). `declined` shows "listen-only" and a way to change it. */
  myConsent?: ConsentDecision | null;
  /** Shows a Stop button (for whoever may stop it). */
  onStop?: () => void;
  /** After declining: reopen the prompt. */
  onChangeConsent?: () => void;
  /** Disable the buttons (a request is in flight). */
  pending?: boolean;
  className?: string;
}

/**
 * "● Recording · Everyone in the call is told   [Stop]" — a strip across
 * a captured call, for everyone in it (late joiners too: it reads the
 * call snapshot). Renders nothing while nothing is captured.
 */
export function RecordingBanner({
  recording,
  transcribing = false,
  mode,
  consentRequired = false,
  myConsent,
  onStop,
  onChangeConsent,
  pending = false,
  className,
}: RecordingBannerProps) {
  const label = captureLabel(recording, transcribing, mode);
  if (!label) return null;
  const listenOnly = consentRequired && myConsent === 'declined';
  const meta = listenOnly
    ? 'You declined — you are listen-only'
    : consentRequired
      ? 'Only people who agreed are captured'
      : 'Everyone in the call is told';
  return (
    <div
      className={['poolse-rec-banner', className].filter(Boolean).join(' ')}
      role="status"
      aria-label={`${label}. ${meta}`}
    >
      <span className="poolse-rec-dot" aria-hidden="true" />
      <span className="poolse-rec-banner__text">
        <span className="poolse-rec-banner__title">{label}</span>
        <span className="poolse-rec-banner__meta">{meta}</span>
      </span>
      {listenOnly && onChangeConsent && (
        <button
          type="button"
          className="poolse-rec-banner__btn"
          onClick={onChangeConsent}
          disabled={pending}
        >
          Change
        </button>
      )}
      {recording && onStop && (
        <button
          type="button"
          className="poolse-rec-banner__btn"
          onClick={onStop}
          disabled={pending}
        >
          Stop
        </button>
      )}
    </div>
  );
}

export interface RecordingIndicatorProps {
  recording: boolean;
  transcribing?: boolean;
  mode?: RecordingMode | null;
  className?: string;
}

/** A small "● REC" pill for a call header or tile. Nothing while nothing is captured. */
export function RecordingIndicator({
  recording,
  transcribing = false,
  mode,
  className,
}: RecordingIndicatorProps) {
  const label = captureLabel(recording, transcribing, mode);
  if (!label) return null;
  return (
    <span
      className={['poolse-rec-indicator', className].filter(Boolean).join(' ')}
      role="img"
      aria-label={label}
      title={label}
    >
      <span className="poolse-rec-dot" aria-hidden="true" />
      {recording ? 'REC' : 'Transcript'}
    </span>
  );
}

export interface ConsentPromptProps {
  /** A recording is running. */
  recording: boolean;
  /** A live transcript is running. */
  transcribing?: boolean;
  mode?: RecordingMode | null;
  /** Who started it, if known ("Elena started recording"). Never pass a raw id. */
  startedByName?: string | null;
  /** Answer (e.g. `useRecording().consent`). A `false` result keeps the prompt open with an error. */
  onAnswer: (decision: ConsentDecision) => Promise<boolean | void> | boolean | void;
  /**
   * Called once an accept went through: publishing is allowed again, so
   * bring your microphone and camera back (`useCallRoom().republish`;
   * `CallRoom` does it by itself unless `republishOnPermission: false`).
   */
  onAccepted?: () => void;
  /** Called after a decline went through (e.g. close the prompt). */
  onDeclined?: () => void;
  /** Disable the buttons (a request is in flight). */
  pending?: boolean;
  /** An error to show under the buttons. */
  error?: string | null;
  /** Fill the nearest positioned ancestor with a scrim. Defaults to true; false renders the card only. */
  overlay?: boolean;
  className?: string;
}

/**
 * Asks someone in a captured call for consent — shown to anyone who
 * hasn't accepted, late joiners included, when the room requires it.
 * Until they agree their microphone and camera stay off; they still
 * hear and see everyone. Declining keeps them listen-only.
 */
export function ConsentPrompt({
  recording,
  transcribing = false,
  mode,
  startedByName,
  onAnswer,
  onAccepted,
  onDeclined,
  pending = false,
  error,
  overlay = true,
  className,
}: ConsentPromptProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const agree = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => agree.current?.focus(), []);

  const what =
    recording && transcribing
      ? 'recorded and transcribed'
      : recording
        ? mode === 'audio'
          ? 'recorded (audio)'
          : 'recorded'
        : 'transcribed';
  const answer = async (decision: ConsentDecision) => {
    setBusy(true);
    setFailed(false);
    try {
      const ok = await onAnswer(decision);
      if (ok === false) {
        setFailed(true);
        return;
      }
      if (decision === 'accepted') onAccepted?.();
      else onDeclined?.();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || pending;
  const shownError = error ?? (failed ? 'That didn’t go through. Try again.' : null);

  const card = (
    <div
      className={['poolse-consent', className].filter(Boolean).join(' ')}
      role="alertdialog"
      aria-modal={overlay ? true : undefined}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
    >
      <div className="poolse-consent__head">
        <span className="poolse-rec-dot" aria-hidden="true" />
        <h2 id={`${id}-title`} className="poolse-consent__title">
          This call is being {what}
        </h2>
      </div>
      <p id={`${id}-body`} className="poolse-consent__body">
        {startedByName ? `${startedByName} started it. ` : ''}
        Your microphone and camera stay off until you agree. You can still hear and see everyone.
      </p>
      <div className="poolse-consent__actions">
        <button
          type="button"
          className="poolse-consent__btn"
          onClick={() => void answer('declined')}
          disabled={disabled}
        >
          Stay listen-only
        </button>
        <button
          ref={agree}
          type="button"
          className="poolse-consent__btn poolse-consent__btn--primary"
          onClick={() => void answer('accepted')}
          disabled={disabled}
        >
          Agree
        </button>
      </div>
      {shownError && (
        <p className="poolse-consent__error" role="alert">
          {shownError}
        </p>
      )}
    </div>
  );
  return overlay ? <div className="poolse-consent-scrim">{card}</div> : card;
}

export interface RecordingNoticeRowProps {
  /** The recording notice message. Rows that aren't one render nothing. */
  msg: Pick<Message, 'type' | 'body' | 'inserted_at'> & { deleted_at?: string | null };
  /** Current user's id — "by you". */
  meId: string | null;
  /** A poolse user id → display name. Unknown: the name is left out. */
  nameFor?: (userId: Uuid) => string | null | undefined;
}

/**
 * "● Recording started · by Elena · 10:04" — the chat line the server
 * posts when a recording starts or stops, the notice for anyone who
 * comes later. `<MessageRow>` renders it for you.
 */
export function RecordingNoticeRow({ msg, meId, nameFor }: RecordingNoticeRowProps) {
  const display = recordingNoticeDisplayFor(msg, meId, nameFor);
  if (!display) return null;
  const time = formatTime(msg.inserted_at);
  const label = [display.title, display.detail, time].filter(Boolean).join(', ');
  return (
    <div className="poolse-call-log poolse-rec-notice" role="note" aria-label={label}>
      <span className="poolse-call-log__chip">
        <span
          className={`poolse-rec-dot${display.event === 'stopped' ? ' poolse-rec-dot--off' : ''}`}
          aria-hidden="true"
        />
        <span className="poolse-call-log__title">{display.title}</span>
        {display.detail && <span className="poolse-call-log__detail">{display.detail}</span>}
        {time && <span className="poolse-call-log__time">{time}</span>}
      </span>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
