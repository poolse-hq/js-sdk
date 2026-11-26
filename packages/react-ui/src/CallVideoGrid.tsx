import type { CallAgent, CallParticipant } from '@poolse/sdk';
import { callAgentOfParticipant } from '@poolse/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CallAgentTag } from './CallAgents.js';

import { PoolseIcon } from './PoolseIcon.js';
import { useFullscreen } from './useFullscreen.js';
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
 * A shared screen takes the stage whatever the size of the call: it is
 * what everyone is looking at, drawn whole (never cropped), with
 * everyone's faces in a strip beside it.
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
  /** Clicking your own preview. Left unset, the tile is not interactive. */
  onLocalClick?: (() => void) | undefined;
  /**
   * The call's agents (`useCallAgents().agents`): their tiles get the
   * Agent badge and label even before the token metadata is read.
   */
  agents?: readonly CallAgent[] | undefined;
}

export function CallVideoGrid({
  participants,
  labelFor,
  className,
  onLocalClick,
  agents,
}: CallVideoGridProps) {
  // Never the id: a name the host resolves, else a neutral word.
  const label = labelFor ?? (() => 'Someone');

  const self = participants.find((p) => p.isSelf) ?? null;
  const others = useMemo(() => participants.filter((p) => !p.isSelf), [participants]);

  if (participants.length === 0) return null;

  // ── someone is sharing a screen: the screen, faces in a strip ───────
  // Another person's share wins over your own: yours is what you already
  // see on your monitor, theirs is what you joined to watch.
  const presenter =
    others.find((p) => p.screenSharing && p.screenTrack) ??
    (self?.screenSharing && self.screenTrack ? self : null);
  if (presenter) {
    const faces = [...others, ...(self ? [self] : [])];
    return (
      <div className={className ?? 'callpresent'}>
        <ScreenTile participant={presenter} label={label} />
        <div className="callpresent__strip">
          {faces.map((participant) => (
            <CallVideoTile
              key={participant.userId}
              participant={participant}
              label={label}
              agents={agents}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── one other person (or nobody yet): spotlight + corner preview ────
  if (others.length <= 1) {
    const spotlight = others[0] ?? self;
    if (!spotlight) return null;

    return (
      <div className={className ?? 'callstage callstage--solo'}>
        <CallVideoTile participant={spotlight} label={label} agents={agents} bleed fit="contain" />
        {self && others.length === 1 && (
          <FloatingSelf onClick={onLocalClick}>
            {/* `bleed` for the borders, `cover` for the fit: the
                rounding and clipping belong to the bubble around it, and
                a tile that also rounds and borders itself leaves a
                hairline seam and insets the video from the edge. */}
            <CallVideoTile participant={self} label={label} hideName bleed fit="cover" />
          </FloatingSelf>
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
        <CallVideoTile
          key={participant.userId}
          participant={participant}
          label={label}
          agents={agents}
        />
      ))}
    </div>
  );
}

function CallVideoTile({
  participant,
  label,
  agents,
  bleed = false,
  hideName = false,
  fit = 'cover',
}: {
  participant: CallParticipant;
  label: (userId: string) => string;
  agents?: readonly CallAgent[] | undefined;
  /** Fill the parent, with no border and no rounding of its own. */
  bleed?: boolean;
  hideName?: boolean;
  /**
   * How the video sits in the tile.
   *
   * Deliberately NOT derived from `bleed`. The spotlight and the
   * floating preview are both bleed tiles and want opposite things: the
   * spotlight letterboxes so a phone's portrait frame survives a
   * landscape window, while the preview is a small fixed-ratio bubble
   * that should be filled edge to edge.
   */
  fit?: 'cover' | 'contain';
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const track = participant.videoTrack as AttachableTrack | null;
  // An agent (AG13) is named as one — "Scout", "Jasir's agent" — and
  // marked with the Agent badge and what it's doing.
  const agent = participant.isSelf ? null : callAgentOfParticipant(participant, agents);
  const name = participant.isSelf
    ? 'You'
    : agent
      ? agent.label
      : (participant.name ?? label(participant.userId));

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
    agent ? 'callgrid__tile--agent' : '',
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
          style={{
            // Set here rather than left to host CSS because it is
            // behaviour rather than theme.
            //
            // A phone publishes portrait video. Cropping that to fill a
            // landscape browser window — which is what `cover` does —
            // throws away most of the frame and lands somewhere around
            // the caller's nose, so the spotlight letterboxes.
            // Fixed-ratio tiles crop, where the loss is slight and the
            // alternative is a grid full of pillarboxed slivers.
            objectFit: fit,
            // Mirrored only for yourself — mirroring a remote feed would
            // flip their text and reverse which hand they are waving
            // with.
            ...(participant.isSelf ? { transform: 'scaleX(-1)' } : {}),
          }}
        />
      ) : (
        <div className="callgrid__placeholder">
          <span
            className="callgrid__avatar"
            style={{ background: userColor(participant.userId) }}
            aria-hidden="true"
          >
            {/* Your own tile is captioned "You", but its initials are yours. */}
            {initialsOf(
              participant.isSelf ? (participant.name ?? label(participant.userId)) : name,
            )}
          </span>
        </div>
      )}

      {!hideName && (
        <div className="callgrid__caption">
          {!participant.micEnabled && !agent && (
            <PoolseIcon name="mic-off" size={13} label="muted" className="callgrid__mutedicon" />
          )}
          <span className="callgrid__name">{name}</span>
          {agent ? <CallAgentTag agent={agent} speaking={participant.speaking} /> : null}
        </div>
      )}
    </div>
  );
}

/**
 * A shared screen: drawn whole and unmirrored, and always muted here —
 * a share's sound is played with the rest of the call's audio, not by
 * this element.
 */
function ScreenTile({
  participant,
  label,
}: {
  participant: CallParticipant;
  label: (userId: string) => string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const tile = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(tile, ref);
  const track = participant.screenTrack as AttachableTrack | null;
  const name = participant.isSelf
    ? 'Your screen'
    : `${participant.name ?? label(participant.userId)}'s screen`;

  useEffect(() => {
    const element = ref.current;
    if (!element || !track) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  return (
    <div
      ref={tile}
      className="callpresent__screen"
      onDoubleClick={fullscreen.supported ? fullscreen.toggle : undefined}
    >
      <video
        ref={ref}
        className="callgrid__video"
        autoPlay
        playsInline
        muted
        style={{ objectFit: 'contain' }}
      />
      <div className="callgrid__caption">
        <PoolseIcon name="screen-share" size={13} label={null} />
        <span className="callgrid__name">{name}</span>
      </div>
      {fullscreen.supported && (
        <button
          type="button"
          className="callpresent__fullscreen"
          onClick={fullscreen.toggle}
          aria-label={fullscreen.active ? 'Exit full screen' : 'Full screen'}
          title={fullscreen.active ? 'Exit full screen' : 'Full screen'}
        >
          <PoolseIcon
            name={fullscreen.active ? 'fullscreen-exit' : 'fullscreen'}
            size={18}
            label={null}
          />
        </button>
      )}
    </div>
  );
}

/**
 * The local preview, floating over the remote video.
 *
 * Draggable, snapping to the nearest corner on release rather than
 * staying where the pointer stopped — a tile left at a slight angle to
 * the edge reads as dropped rather than placed, and corners are what
 * people actually want, since they move it to uncover a face.
 *
 * Pointer events rather than mouse events, so it works the same under a
 * finger on a tablet as under a mouse.
 */
function FloatingSelf({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: (() => void) | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [corner, setCorner] = useState(1);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    origin.current = { x: event.clientX, y: event.clientY };
    moved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const from = origin.current;
    if (!from) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    // Only claim the gesture once it is clearly a drag, so a click that
    // wobbles by a pixel still flips the camera.
    if (!moved.current && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    moved.current = true;
    setDrag({ x: dx, y: dy });
  }, []);

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const from = origin.current;
      origin.current = null;
      setDrag(null);
      // A release with no press on the tile (it started elsewhere), or the
      // browser cancelling the gesture, is never a click.
      if (!from) return;
      if (!moved.current) {
        if (event.type !== 'pointercancel') onClick?.();
        return;
      }

      // Which half of the stage the tile was let go in decides its
      // corner. Comparing against the stage's own box keeps this right
      // regardless of where the window is on screen.
      const stage = ref.current?.parentElement?.getBoundingClientRect();
      if (!stage) return;
      const right = event.clientX > stage.left + stage.width / 2;
      const bottom = event.clientY > stage.top + stage.height / 2;
      setCorner((bottom ? 2 : 0) + (right ? 1 : 0));
    },
    [onClick],
  );

  return (
    <div
      ref={ref}
      className={`callstage__pip callstage__pip--c${corner}${drag ? ' callstage__pip--dragging' : ''}`}
      style={drag ? { transform: `translate(${drag.x}px, ${drag.y}px)` } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      aria-label={onClick ? 'Your camera. Drag to move, click to switch camera.' : undefined}
    >
      {children}
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
