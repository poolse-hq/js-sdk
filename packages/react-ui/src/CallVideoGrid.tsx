import type { CallParticipant } from '@poolse/sdk';
import { useEffect, useRef } from 'react';

/**
 * The web half of a call's video: one tile per participant.
 *
 * Mirrors `@poolse/react-native`'s component of the same name, but the
 * platforms attach tracks differently — React Native renders through
 * `<VideoTrack>`, the web attaches the track to a `<video>` element
 * directly. That is why there are two, rather than one shared component
 * with a renderer prop.
 *
 * Someone with their camera off still gets a tile showing their name and
 * mute state. Dropping them would make a call with cameras off look like
 * nobody else is there.
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

  if (participants.length === 0) return null;

  return (
    <div className={className ?? 'callgrid'}>
      {participants.map((participant) => (
        <CallVideoTile key={participant.userId} participant={participant} label={label} />
      ))}
    </div>
  );
}

function CallVideoTile({
  participant,
  label,
}: {
  participant: CallParticipant;
  label: (userId: string) => string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const track = participant.videoTrack as AttachableTrack | null;

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

  return (
    <div className={`callgrid__tile${participant.speaking ? ' callgrid__tile--speaking' : ''}`}>
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
        <div className="callgrid__placeholder" aria-hidden="true">
          {label(participant.userId).slice(0, 1).toUpperCase()}
        </div>
      )}

      <div className="callgrid__caption">
        <span className="callgrid__name">
          {participant.isSelf ? 'You' : (participant.name ?? label(participant.userId))}
        </span>
        {!participant.micEnabled && <span className="callgrid__muted">muted</span>}
      </div>
    </div>
  );
}
