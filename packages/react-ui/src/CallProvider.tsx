import { useCallRoom, useCalls, useVoiceRoom, type UseCalls } from '@poolse/react';
import type { CallDeviceKind, CallMedia, LiveKitModule } from '@poolse/sdk';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { CallControlButton, CallDeviceMenu } from './CallControls.js';
import { CallVideoGrid } from './CallVideoGrid.js';

export interface CallInvite {
  /** Ring everyone in a conversation. */
  placeCall: (conversationId: string, media?: CallMedia) => void;
  /** A call is already in flight, so a new one cannot be placed. */
  busy: boolean;
}

const InviteContext = createContext<CallInvite | null>(null);

/**
 * Place a call from anywhere under {@link CallProvider}.
 *
 *     const { placeCall, busy } = useCallInvite();
 *     <button disabled={busy} onClick={() => placeCall(id, 'video')}>Video</button>
 *
 * Separate from the call surface on purpose. The buttons belong in a
 * conversation header, the surface belongs at the root, and they must
 * share one state machine — see {@link CallProvider} for why that
 * matters more than it sounds.
 */
export function useCallInvite(): CallInvite {
  return (
    useContext(InviteContext) ?? {
      placeCall: () => {},
      busy: true,
    }
  );
}

export interface CallProviderProps {
  /** The signed-in user's poolse id — the topic calls arrive on. */
  userId: string | null;
  /**
   * `livekit-client`, imported by your app:
   *
   *     import * as livekit from 'livekit-client';
   */
  livekit: LiveKitModule;
  /** Resolves a user id to a display label. */
  labelFor?: (userId: string) => string;
  children: ReactNode;
}

/** Controls fade out this long after the last interaction on a video call. */
const CHROME_IDLE_MS = 4500;

/**
 * Owns calling for a web app: ringing, answering, media and the call UI.
 *
 * ## Mount it ONCE, at the root
 *
 * Not inside a conversation view, and not behind a route that can
 * unmount. A call arrives on the user's own topic at any moment, and
 * this component is what listens — so anywhere it is not mounted, the
 * app simply cannot be called. Putting it inside a "is a conversation
 * open?" branch means the user is unreachable on the conversation list,
 * which looks exactly like calls being unreliable rather than like a
 * mounting mistake.
 *
 *     <CallProvider userId={me.id} livekit={livekit}>
 *       <YourApp />
 *     </CallProvider>
 *
 * The buttons that place calls live wherever you want them, and reach
 * this through {@link useCallInvite}.
 *
 * ## Two media paths
 *
 * Media rides the SFU when the deployment has one — that is what makes
 * video and the mid-call camera toggle possible. Without one, calls fall
 * back to the peer-to-peer mesh, which carries audio only. The fallback
 * is automatic and silent by design.
 *
 * ## Styling
 *
 * Class-based, and no CSS ships with it. The host owns the look; the
 * class names are stable.
 */
export function CallProvider({ userId, livekit, labelFor, children }: CallProviderProps) {
  const calls = useCalls(userId);
  const label = labelFor ?? ((id: string) => `User ${id.slice(0, 6)}`);

  const placeCall = useCallback(
    (conversationId: string, media: CallMedia = 'audio') => {
      void calls.call(conversationId, media);
    },
    [calls],
  );

  // Rebuilt when the phase changes, which is rare and cheap — the
  // alternative is a ref dance that buys nothing here.
  const invite: CallInvite = { placeCall, busy: calls.phase !== 'idle' };

  return (
    <InviteContext.Provider value={invite}>
      {children}
      <CallSurface calls={calls} livekit={livekit} labelFor={label} />
    </InviteContext.Provider>
  );
}

function CallSurface({
  calls,
  livekit,
  labelFor,
}: {
  calls: UseCalls;
  livekit: LiveKitModule;
  labelFor: (userId: string) => string;
}) {
  const conversationInCall = calls.phase === 'active' ? calls.activeConversationId : null;
  const isVideoCall = calls.media === 'video';

  const sfu = useCallRoom(conversationInCall, { livekit, video: isVideoCall });
  // Constructed unconditionally, NOT gated on sfuAvailable. Gating it
  // meant the room was still null at the moment the effect below decided
  // to fall back — join() no-opped and the mesh never connected.
  // Constructing is free: nothing is acquired until join().
  const voice = useVoiceRoom(conversationInCall);

  const usingSfu = sfu.sfuAvailable === true;
  const mediaStatus = usingSfu ? sfu.status : voice.status;
  const connected = calls.phase === 'active' && mediaStatus === 'connected';

  useEffect(() => {
    if (calls.phase !== 'active' || !conversationInCall) return;

    let cancelled = false;
    void (async () => {
      // A false here means the deployment has no SFU, which is the one
      // case the peer-to-peer mesh should take over.
      const joined = await sfu.join();
      if (cancelled || joined) return;
      await voice.join();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls.phase, conversationInCall]);

  // `calls.hangUp()`, not `reset()`. Resetting only clears local state,
  // leaving the other side in a call with a screen it has no reason to
  // close.
  const hangUp = useCallback(() => {
    sfu.leave();
    voice.leave();
    void calls.hangUp();
  }, [sfu, voice, calls]);

  // Everyone else vanished without hanging up — a closed tab, a killed
  // app, a phone that lost signal. No `call:hangup` will ever arrive, so
  // without this the survivor sits on a call screen that never closes.
  const alone = usingSfu ? sfu.alone : voice.alone;

  // Latched: `hangUp` closes over the room objects, which are rebuilt
  // every render, so the effect re-runs constantly. Without a guard it
  // would fire the hang-up repeatedly in the window before the phase
  // flips.
  const endedOnEmpty = useRef(false);
  if (calls.phase !== 'active') endedOnEmpty.current = false;

  useEffect(() => {
    if (!alone || calls.phase !== 'active' || endedOnEmpty.current) return;
    endedOnEmpty.current = true;
    hangUp();
  }, [alone, calls.phase, hangUp]);

  // ── chrome auto-hide ────────────────────────────────────────────────

  const [chromeVisible, setChromeVisible] = useState(true);
  const [lastWake, setLastWake] = useState(0);
  const [menu, setMenu] = useState<CallDeviceKind | null>(null);

  // Never while a device menu is open — the menu is anchored to a button
  // that would slide out from under the pointer.
  const chromeHides = connected && isVideoCall && menu === null;

  useEffect(() => {
    setChromeVisible(true);
    if (!chromeHides) return;
    const timer = setTimeout(() => setChromeVisible(false), CHROME_IDLE_MS);
    return () => clearTimeout(timer);
  }, [chromeHides, lastWake]);

  const wake = useCallback(() => setLastWake(Date.now()), []);
  const withWake = useCallback(
    (fn: () => void) => () => {
      wake();
      fn();
    },
    [wake],
  );

  const micOn = usingSfu ? sfu.micEnabled : !voice.muted;
  const toggleMic = useCallback(() => {
    if (usingSfu) void sfu.toggleMic();
    else voice.toggleMute();
  }, [usingSfu, sfu, voice]);

  const openMenu = useCallback(
    (kind: CallDeviceKind) => {
      // Re-read as the menu opens: a browser only reveals device ids and
      // labels once the page holds the matching permission, and when
      // placing a call that lands seconds after the click.
      sfu.refreshDevices();
      setMenu((current) => (current === kind ? null : kind));
    },
    [sfu],
  );

  const duration = useCallDuration(connected);

  if (calls.phase === 'idle') return null;

  const ringingIn = calls.phase === 'ringing-in';
  const ringingOut = calls.phase === 'ringing-out';
  const ended = calls.phase === 'declined' || calls.phase === 'busy' || calls.phase === 'timed-out';

  const others = usingSfu ? sfu.participants.filter((p) => !p.isSelf) : [];
  const peerIds =
    ringingIn && calls.incoming
      ? [calls.incoming.callerUserId]
      : others.length > 0
        ? others.map((p) => p.userId)
        : (calls.outgoing?.calleeUserIds ?? []);

  const who =
    peerIds.length === 0
      ? 'Call'
      : peerIds.length <= 2
        ? peerIds.map(labelFor).join(', ')
        : `${labelFor(peerIds[0]!)} and ${peerIds.length - 1} others`;

  const showStage = connected && usingSfu && sfu.participants.length > 0;
  const error = calls.error ?? (usingSfu ? sfu.error : voice.error);
  const isGroup = others.length > 1;

  return (
    <div
      className="callsheet"
      role="dialog"
      aria-modal="true"
      aria-label="Call"
      onPointerMove={wake}
    >
      <div className="callsheet__stage">
        {showStage ? (
          <CallVideoGrid
            participants={sfu.participants}
            labelFor={labelFor}
            onLocalClick={sfu.cameraEnabled ? () => void sfu.switchCamera() : undefined}
          />
        ) : (
          <div className="callsheet__identity">
            <span className="callsheet__avatar" aria-hidden="true">
              {who.slice(0, 1).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      <header className={`callsheet__header${chromeVisible ? '' : ' callsheet__header--hidden'}`}>
        <p className="callsheet__who">{who}</p>
        <p className="callsheet__state">
          {isGroup && showStage ? `${sfu.participants.length} · ` : ''}
          {duration ?? statusLine(calls.phase, mediaStatus)}
        </p>
      </header>

      <div className={`callsheet__actions${chromeVisible ? '' : ' callsheet__actions--hidden'}`}>
        {/* A missing camera or microphone reports here rather than
            failing the call, so this is often the only sign that a
            machine has no webcam. */}
        {error && <p className="callsheet__error">{error.message}</p>}

        {ringingIn ? (
          <div className="callsheet__row">
            <CallControlButton
              icon="phone-off"
              tone="danger"
              large
              label="Decline"
              onClick={() => void calls.decline()}
            />
            <CallControlButton
              icon={isVideoCall ? 'video' : 'phone'}
              tone="accept"
              large
              label="Accept"
              onClick={() => void calls.accept()}
            />
          </div>
        ) : ended ? (
          <div className="callsheet__row">
            <CallControlButton icon="close" label="Close" onClick={calls.reset} />
          </div>
        ) : (
          <div className="callsheet__row">
            <span className="callsheet__control">
              <CallControlButton
                icon={micOn ? 'mic' : 'mic-off'}
                active={!micOn}
                label={micOn ? 'Mute' : 'Unmute'}
                onClick={withWake(toggleMic)}
                hasMenu={usingSfu && sfu.devices.audioinput.length > 0}
                onMenuClick={withWake(() => openMenu('audioinput'))}
              />
              {menu === 'audioinput' && (
                <CallDeviceMenu
                  title="Microphone"
                  devices={sfu.devices.audioinput}
                  activeId={sfu.activeDevices.audioinput}
                  onSelect={(kind, id) => void sfu.selectDevice(kind, id)}
                  onClose={() => setMenu(null)}
                />
              )}
            </span>

            {/* Only the SFU can add video to a live call — the mesh
                offers once, on peer discovery, and cannot renegotiate. */}
            {usingSfu && (
              <span className="callsheet__control">
                <CallControlButton
                  icon={sfu.cameraEnabled ? 'video' : 'video-off'}
                  active={!sfu.cameraEnabled}
                  label="Camera"
                  onClick={withWake(() => void sfu.toggleCamera())}
                  // No camera on this machine means nothing to toggle.
                  // Leaving it live gave a button that reported an error
                  // every time it was pressed.
                  disabled={sfu.devices.videoinput.length === 0}
                  hasMenu={sfu.devices.videoinput.length > 0}
                  onMenuClick={withWake(() => openMenu('videoinput'))}
                />
                {menu === 'videoinput' && (
                  <CallDeviceMenu
                    title="Camera"
                    devices={sfu.devices.videoinput}
                    activeId={sfu.activeDevices.videoinput}
                    onSelect={(kind, id) => void sfu.selectDevice(kind, id)}
                    onClose={() => setMenu(null)}
                  />
                )}
              </span>
            )}

            {/* The web's speakerphone button. Not every browser
                implements setSinkId, so this only appears when the
                browser actually offered a choice of outputs. */}
            {usingSfu && sfu.devices.audiooutput.length > 0 && (
              <span className="callsheet__control">
                <CallControlButton
                  icon="speaker"
                  label="Output"
                  onClick={withWake(() => openMenu('audiooutput'))}
                />
                {menu === 'audiooutput' && (
                  <CallDeviceMenu
                    title="Speaker"
                    devices={sfu.devices.audiooutput}
                    activeId={sfu.activeDevices.audiooutput}
                    onSelect={(kind, id) => void sfu.selectDevice(kind, id)}
                    onClose={() => setMenu(null)}
                  />
                )}
              </span>
            )}

            <CallControlButton
              icon="phone-off"
              tone="danger"
              large
              label={ringingOut ? 'Cancel' : 'Hang up'}
              onClick={ringingOut ? () => void calls.cancel() : hangUp}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * How long the call has been up, as `m:ss`.
 *
 * Anchored to a timestamp rather than counting ticks — a backgrounded
 * tab has its timers throttled, and a call timer that reads 4:12 after
 * eleven minutes is worse than no timer at all.
 */
function useCallDuration(connected: boolean): string | null {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!connected) {
      setStartedAt(null);
      return;
    }
    setStartedAt(Date.now());
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [connected]);

  if (!connected || startedAt === null) return null;
  const total = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function statusLine(phase: string, mediaStatus: string): string {
  switch (phase) {
    case 'ringing-in':
      return 'Incoming call…';
    case 'ringing-out':
      return 'Ringing…';
    case 'declined':
      return 'Call declined';
    case 'busy':
      return 'Already on another call';
    case 'timed-out':
      return 'No answer';
    case 'active':
      return mediaStatus === 'connected' ? 'Connected' : 'Connecting…';
    default:
      return '';
  }
}
