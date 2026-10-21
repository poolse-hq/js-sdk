// LiveCallBanner — "Voice call in progress · 2 on the call  [Join]",
// across the top of a conversation while a call runs that the viewer
// is not on. `<ConversationView onJoinCall>` renders it for you; use it
// directly (with `useLiveCall`) to place it elsewhere.

import type { LiveCall } from '@poolse/sdk';
import { PoolseIcon } from './PoolseIcon.js';

export interface LiveCallBannerProps {
  call: LiveCall;
  /** How many people are in the room right now. */
  inCall: number;
  onJoin: (call: LiveCall) => void;
}

export function LiveCallBanner({ call, inCall, onJoin }: LiveCallBannerProps) {
  const what =
    call.kind === 'room'
      ? call.media === 'video'
        ? 'Video room'
        : 'Voice room'
      : call.media === 'video'
        ? 'Video call in progress'
        : 'Voice call in progress';
  const who =
    inCall > 0
      ? `${inCall} ${call.kind === 'room' ? 'in the room' : 'on the call'}`
      : call.kind === 'room'
        ? 'Starting'
        : 'Ringing';
  return (
    <div className="poolse-live-call" role="status" aria-label={`${what}, ${who}`}>
      <PoolseIcon
        name={call.media === 'video' ? 'video' : 'phone'}
        size={16}
        label={null}
        className="poolse-live-call__icon"
      />
      <span className="poolse-live-call__text">
        <span className="poolse-live-call__title">{what}</span>
        <span className="poolse-live-call__meta">{who}</span>
      </span>
      <button type="button" className="poolse-live-call__join" onClick={() => onJoin(call)}>
        Join
      </button>
    </div>
  );
}
