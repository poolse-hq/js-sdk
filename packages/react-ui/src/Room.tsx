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
import { useCallback, useEffect, useState } from 'react';

import { CallControlButton, CallDeviceMenu } from './CallControls.js';
import { CallVideoGrid } from './CallVideoGrid.js';
import { PoolseIcon } from './PoolseIcon.js';

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
 * camera is off), and the controls — microphone, camera and output, each
 * with a device picker, and Leave. Fills its container: give it the
 * space your layout has for the stage.
 */
export function RoomStage({ room, title, labelFor, className }: RoomStageProps) {
  const media = room.media;
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
  const status =
    media.status === 'connecting' || room.joining
      ? 'Connecting…'
      : `${count} in the room${elapsed ? ` · ${elapsed}` : ''}`;

  return (
    <section className={['poolse-room', className].filter(Boolean).join(' ')} aria-label="Room">
      <header className="poolse-room__head">
        <span className="poolse-room__title">{title ?? 'Room'}</span>
        <span className="poolse-room__status">{status}</span>
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

      {room.error && <p className="poolse-room__error">{room.error.message}</p>}

      <div className="poolse-room__bar">
        <span className="callsheet__control">
          <CallControlButton
            icon={media.micEnabled ? 'mic' : 'mic-off'}
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
            icon={media.cameraEnabled ? 'video' : 'video-off'}
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

        {media.devices.audiooutput.length > 0 && (
          <span className="callsheet__control">
            <CallControlButton
              icon="speaker"
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
          icon="phone-off"
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
