import type { CallParticipant } from '@poolse/sdk';
import { useEffect, useMemo, useRef } from 'react';

import { PoolseIcon } from './PoolseIcon.js';
import { userColor } from './userColor.js';

/**
 * The web half of a call's stage.
 *
 * Mirrors `@poolse/react-native`'s component of the same name, but the
 * platforms attach tracks differently — React Native renders through
 * `<VideoTrack>`, the web attaches the track to a `<video>` element
 * directly. That is why there are two, rather than one shared component
 * with a renderer prop.
 *
 * Layout follows the size of the call, for the same reasons it does on
 * mobile: one other person gets the whole frame with you tucked into a
 * corner, because splitting a two-person call into equal boxes spends
 * most of the screen on letterboxing. Three or more get a grid.
 *
 * Someone with their camera off still gets a tile showing their name
 * and mute state. Dropping them would make a call with cameras off look
 * like nobody else is there.
 *
 * Styling is class-based so a host app can restyle it — no CSS ships
 * with this component.
 */

/** The slice of a LiveKit track this attaches. */
interface AttachableTrack {
  attach(element: HTMLMediaElement): unknown;
  detach(element: HTMLMediaElement): unknown;
}

export interface CallVideoGridProps {
  participants: CallParticipant[];
  labelFor?: (userId: string) => string;
  className?: string;
}

export function CallVideoGrid({ participants, labelFor, className }: CallVideoGridProps) {
  const label = labelFor ?? ((id: string) => `User ${id.slice(0, 6)}`);

  const self = participants.find((p) => p.isSelf) ?? null;
  const others = useMemo(() => participants.filter((p) => !p.isSelf), [participants]);

  if (participants.length === 0) return null;

  // ── one other person (or nobody yet): spotlight + corner preview ────
  if (others.length <= 1) {
    const spotlight = others[0] ?? self;
    if (!spotlight) return null;

    return (
      <div className={className ?? 'callstage callstage--solo'}>
        <CallVideoTile participant={spotlight} label={label} bleed />
        {self && others.length === 1 && (
          <div className="callstage__pip">
            <CallVideoTile participant={self} label={label} hideName />
          </div>
        )}
      </div>
    );
  }

  // ── three or more: a grid ───────────────────────────────────────────
  // Remote faces lead and you sit last — both what people look for
  // first, and a stable order. Promoting the active speaker would
  // reshuffle the grid every time somebody spoke.
  const tiles = [...others, ...(self ? [self] : [])];

  return (
    <div
      className={className ?? 'callgrid'}
      data-count={tiles.length > 6 ? 'many' : String(tiles.length)}
    >
      {tiles.map((participant) => (
        <CallVideoTile key={participant.userId} participant={participant} label={label} />
      ))}
    </div>
  );
}

function CallVideoTile({
  participant,
  label,
  bleed = false,
  hideName = false,
}: {
  participant: CallParticipant;
  label: (userId: string) => string;
  bleed?: boolean;
  hideName?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const track = participant.videoTrack as AttachableTrack | null;
  const name = participant.isSelf ? 'You' : (participant.name ?? label(participant.userId));

  useEffect(() => {
    const element = ref.current;
    if (!element || !track) return;

    track.attach(element);
    // Detaching on cleanup is what stops a camera being turned off from
    // leaving its last frame frozen on screen.
    return () => {
      track.detach(element);
    };
  }, [track]);

  const classes = [
    'callgrid__tile',
    bleed ? 'callgrid__tile--bleed' : '',
    participant.speaking ? 'callgrid__tile--speaking' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      {track ? (
        <video
          ref={ref}
          className="callgrid__video"
          autoPlay
          playsInline
          // Your own tile MUST be muted, or you hear yourself back with
          // a delay and the call is unusable. Remote audio is played by
          // LiveKit itself, not by these elements.
          muted={participant.isSelf}
          // Mirrored only for yourself — mirroring a remote feed would
          // flip their text and reverse which hand they are waving with.
          style={participant.isSelf ? { transform: 'scaleX(-1)' } : undefined}
        />
      ) : (
        <div className="callgrid__placeholder">
          <span
            className="callgrid__avatar"
            style={{ background: userColor(participant.userId) }}
            aria-hidden="true"
          >
            {initialsOf(name)}
          </span>
        </div>
      )}

      {!hideName && (
        <div className="callgrid__caption">
          {!participant.micEnabled && (
            <PoolseIcon name="mic-off" size={13} label="muted" className="callgrid__mutedicon" />
          )}
          <span className="callgrid__name">{name}</span>
        </div>
      )}
    </div>
  );
}

/** Up to two initials, matching how the rest of the SDK derives them. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
