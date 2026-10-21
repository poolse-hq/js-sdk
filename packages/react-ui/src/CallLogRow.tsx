// CallLogRow — centered, compact timeline line for call-log system
// messages ("Voice call · 3:12", "Missed call"). Visually a sibling
// of the day separator pill: it sits between bubble clusters, never
// joins one, and carries no reactions / thread / edit actions.
//
// `<MessageRow>` renders this automatically for call-log messages;
// export it so custom layouts can do the same.

import type { Message } from '@poolse/sdk';
import { callLogDisplayFor, type CallLogDisplay } from '@poolse/react';
import { PoolseIcon } from './PoolseIcon.js';

export interface CallLogRowProps {
  /** The call-log message. Rows that aren't call logs render nothing. */
  msg: Pick<Message, 'type' | 'body' | 'inserted_at'> & { deleted_at?: string | null };
  /** Current user's id — decides how the call is worded for them. */
  meId: string | null;
  /**
   * Offer "Call back" on calls the viewer missed or declined, or placed
   * with no answer. Receives the call's media. Omit to show no action.
   */
  onCallBack?: (media: 'audio' | 'video') => void;
}

export function CallLogRow({ msg, meId, onCallBack }: CallLogRowProps) {
  const display = callLogDisplayFor(msg, meId);
  if (!display) return null;
  return (
    <CallLogLine
      display={display}
      insertedAt={msg.inserted_at}
      {...(onCallBack ? { onCallBack } : {})}
    />
  );
}

function CallLogLine({
  display,
  insertedAt,
  onCallBack,
}: {
  display: CallLogDisplay;
  insertedAt: string;
  onCallBack?: (media: 'audio' | 'video') => void;
}) {
  const time = formatTime(insertedAt);
  const icon = display.media === 'video' ? 'video' : 'phone';
  const label = [display.title, display.detail, time].filter(Boolean).join(', ');
  return (
    <div
      className={`poolse-call-log${display.missed ? ' poolse-call-log--missed' : ''}`}
      role="note"
      aria-label={label}
    >
      <span className="poolse-call-log__chip">
        <PoolseIcon name={icon} size={13} label={null} className="poolse-call-log__icon" />
        <span className="poolse-call-log__title">{display.title}</span>
        {display.detail && <span className="poolse-call-log__detail">{display.detail}</span>}
        {time && <span className="poolse-call-log__time">{time}</span>}
      </span>
      {display.callBack && onCallBack && (
        <button
          type="button"
          className="poolse-call-log__call-back"
          onClick={() => onCallBack(display.media)}
        >
          Call back
        </button>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
