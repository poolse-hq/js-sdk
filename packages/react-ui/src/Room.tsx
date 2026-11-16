// The conversation's room, Meet-style: anyone in the conversation drops
// in for voice or video while the chat carries on beside it, and nobody's
// phone rings. Built on `useRoom` from @poolse/react; the host owns the
// hook so it can place the join controls and the stage wherever its
// layout wants them.
//
//     const room = useRoom(conversationId, { livekit });
//     <RoomJoinBar room={room} />                       // in the header
//     {room.joined && <RoomStage room={room} title="Design review" />}

import type { UseRoom } from '@poolse/react';
import type { CallDeviceKind } from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CallControlButton, CallDeviceMenu } from './CallControls.js';
import { CallVideoGrid } from './CallVideoGrid.js';
import { PoolseIcon } from './PoolseIcon.js';
import { useFullscreen } from './useFullscreen.js';

export interface RoomJoinBarProps {
  room: UseRoom;
  /**
   * Offer to start a room when none is live. Off, the bar shows only
   * while a room (or call) is running — a pure "Join" banner.
   */
  allowStart?: boolean;
}

/**
 * "Video room · 2 in the room · Join" while one runs; "Start a room ·
 * Voice · Video" when none does. Renders nothing once you are in.
 */
export function RoomJoinBar({ room, allowStart = true }: RoomJoinBarProps) {
  if (room.joined) return null;
  const live = room.live;

  if (live) {
    const isRoom = live.kind === 'room';
    const what = isRoom
      ? live.media === 'video'
        ? 'Video room'
        : 'Voice room'
      : live.media === 'video'
        ? 'Video call in progress'
        : 'Call in progress';
    const n = room.presentIds.length;
    return (
      <div className="poolse-roombar poolse-roombar--live" role="status">
        <span className="poolse-roombar__dot" aria-hidden="true" />
        <span className="poolse-roombar__text">
          <strong>{what}</strong>
          <span>{n > 0 ? ` · ${n} in the room` : ' · starting'}</span>
        </span>
        <span className="poolse-roombar__actions">
          <button
            type="button"
            className="poolse-roombar__btn"
            onClick={() => void room.join('audio')}
            disabled={room.joining}
          >
            <PoolseIcon name="mic" size={15} label={null} /> Join
          </button>
          <button
            type="button"
            className="poolse-roombar__btn poolse-roombar__btn--primary"
            onClick={() => void room.join('video')}
            disabled={room.joining}
          >
            <PoolseIcon name="video" size={15} label={null} /> Join with video
          </button>
        </span>
      </div>
    );
  }

  if (!allowStart) return null;
  return (
    <div className="poolse-roombar">
      <span className="poolse-roombar__text">
        Start a room — nobody is rung, anyone here can drop in
      </span>
      <span className="poolse-roombar__actions">
        <button
          type="button"
          className="poolse-roombar__btn"
          onClick={() => void room.join('audio')}
          disabled={room.joining}
        >
          <PoolseIcon name="mic" size={15} label={null} /> Voice
        </button>
        <button
          type="button"
          className="poolse-roombar__btn poolse-roombar__btn--primary"
          onClick={() => void room.join('video')}
          disabled={room.joining}
        >
          <PoolseIcon name="video" size={15} label={null} /> Video
        </button>
      </span>
    </div>
  );
}

export interface RoomStageProps {
  room: UseRoom;
  /** The conversation's name, shown at the top. */
  title?: string;
  labelFor?: (userId: string) => string;
  className?: string;
}

/**
 * The room you are in: everyone's video (or their initial while their
 * camera is off), a shared screen large when someone shares, and the
 * controls — microphone, camera and output, each with a device picker,
 * screen sharing where the browser and the workspace allow it, and Leave. Fills its container: give it the
 * space your layout has for the stage.
 */
export function RoomStage({ room, title, labelFor, className }: RoomStageProps) {
  const media = room.media;
  const stage = useRef<HTMLElement>(null);
  const fullscreen = useFullscreen(stage);
  const [menu, setMenu] = useState<CallDeviceKind | null>(null);
  const elapsed = useElapsed(room.live?.started_at ?? null, media.status === 'connected');

  const openMenu = useCallback(
    (kind: CallDeviceKind) => {
      // Device labels appear only once the page holds the permission,
      // which lands seconds after joining — re-read as the menu opens.
      media.refreshDevices();
      setMenu((current) => (current === kind ? null : kind));
    },
    [media],
  );

  const count = media.participants.length;
  // Phone browsers cannot capture a screen, and a workspace can turn it off.
  const canShare = media.canShareScreen && room.live?.screen_share_allowed !== false;
  const connecting = media.status === 'connecting' || room.joining;

  return (
    <section
      ref={stage}
      className={['poolse-room', className].filter(Boolean).join(' ')}
      aria-label="Room"
    >
      <header className="poolse-room__head">
        <span className="poolse-room__title">{title ?? 'Room'}</span>
        {connecting ? (
          <span className="poolse-room__status">Connecting…</span>
        ) : (
          <span className="poolse-room__status">
            {elapsed && (
              <span className="poolse-room__chip poolse-room__chip--live">
                <span className="poolse-room__dot" aria-hidden="true" />
                {elapsed}
              </span>
            )}
            <span className="poolse-room__chip" aria-label={`${count} in the room`}>
              <PoolseIcon name="users" size={14} label={null} />
              {count}
            </span>
          </span>
        )}
        {fullscreen.supported && (
          <button
            type="button"
            className="poolse-room__fullscreen"
            onClick={fullscreen.toggle}
            aria-label={fullscreen.active ? 'Exit full screen' : 'Full screen'}
            title={fullscreen.active ? 'Exit full screen' : 'Full screen'}
          >
            <PoolseIcon
              name={fullscreen.active ? 'fullscreen-exit' : 'fullscreen'}
              size={17}
              label={null}
            />
          </button>
        )}
      </header>

      <div className="poolse-room__stage">
        {count > 0 ? (
          <CallVideoGrid
            participants={media.participants}
            {...(labelFor ? { labelFor } : {})}
            onLocalClick={media.cameraEnabled ? () => void media.switchCamera() : undefined}
          />
        ) : (
          <div className="poolse-room__waiting">Connecting…</div>
        )}
      </div>

      {media.screenSharing && (
        <div className="poolse-room__sharing" role="status">
          <PoolseIcon name="screen-share" size={15} label={null} />
          <span>You are sharing your screen</span>
          <button type="button" onClick={() => void media.setScreenShareEnabled(false)}>
            Stop sharing
          </button>
        </div>
      )}

      {room.error && <p className="poolse-room__error">{room.error.message}</p>}

      <div className="poolse-room__bar">
        <span className="callsheet__control">
          <CallControlButton
            icon={media.micEnabled ? 'mic-fill' : 'mic-off-fill'}
            active={!media.micEnabled}
            label={media.micEnabled ? 'Mute' : 'Unmute'}
            onClick={() => void media.toggleMic()}
            hasMenu={media.devices.audioinput.length > 0}
            onMenuClick={() => openMenu('audioinput')}
          />
          {menu === 'audioinput' && (
            <CallDeviceMenu
              title="Microphone"
              devices={media.devices.audioinput}
              activeId={media.activeDevices.audioinput}
              onSelect={(kind, id) => void media.selectDevice(kind, id)}
              onClose={() => setMenu(null)}
            />
          )}
        </span>

        <span className="callsheet__control">
          <CallControlButton
            icon={media.cameraEnabled ? 'video-fill' : 'video-off-fill'}
            active={!media.cameraEnabled}
            label={media.cameraEnabled ? 'Camera' : 'Camera off'}
            onClick={() => void media.toggleCamera()}
            disabled={media.devices.videoinput.length === 0 && !media.cameraEnabled}
            hasMenu={media.devices.videoinput.length > 0}
            onMenuClick={() => openMenu('videoinput')}
          />
          {menu === 'videoinput' && (
            <CallDeviceMenu
              title="Camera"
              devices={media.devices.videoinput}
              activeId={media.activeDevices.videoinput}
              onSelect={(kind, id) => void media.selectDevice(kind, id)}
              onClose={() => setMenu(null)}
            />
          )}
        </span>

        {(canShare || media.screenSharing) && (
          <CallControlButton
            icon={media.screenSharing ? 'screen-share-off-fill' : 'screen-share-fill'}
            highlight={media.screenSharing}
            label={media.screenSharing ? 'Stop sharing' : 'Share screen'}
            onClick={() => void media.toggleScreenShare()}
          />
        )}

        {media.devices.audiooutput.length > 0 && (
          <span className="callsheet__control">
            <CallControlButton
              icon="speaker-fill"
              label="Speaker"
              onClick={() => openMenu('audiooutput')}
            />
            {menu === 'audiooutput' && (
              <CallDeviceMenu
                title="Speaker"
                devices={media.devices.audiooutput}
                activeId={media.activeDevices.audiooutput}
                onSelect={(kind, id) => void media.selectDevice(kind, id)}
                onClose={() => setMenu(null)}
              />
            )}
          </span>
        )}

        <CallControlButton
          icon="phone-off-fill"
          tone="danger"
          large
          label="Leave"
          onClick={room.leave}
        />
      </div>
    </section>
  );
}

/** "12:04" since the room started, ticking while connected. */
function useElapsed(startedAt: string | null, running: boolean): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  if (!running || !startedAt) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  const total = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
