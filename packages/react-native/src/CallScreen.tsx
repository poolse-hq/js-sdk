import { useCallRoom, useCalls, useVoiceRoom, type UseCalls } from '@poolse/react';
import type { CallParticipant, LiveKitModule, VoiceStatus } from '@poolse/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { AudioRouteSheet } from './voice/AudioRouteSheet.js';
import { CallBackdrop } from './voice/CallBackdrop.js';
import { PulseRings } from './voice/PulseRings.js';
import { CallAvatar } from './voice/CallAvatar.js';
import { CallControlButton } from './voice/CallControlButton.js';
import { CallVideoGrid } from './voice/CallVideoGrid.js';
import { callColors } from './voice/callTheme.js';
import type { LiveKitReactNativeModule } from './voice/livekit-rn.js';
import { useCallAudio } from './voice/useCallAudio.js';
import { useCallDuration } from './voice/useCallDuration.js';
import {
  createNativeWebRtcAdapter,
  isNativeWebRtcAvailable,
  type NativeWebRtcModule,
} from './voice/webrtc-native.js';

export interface CallScreenProps {
  /** The signed-in user's id — the topic calls are delivered on. */
  userId: string;
  /** Resolves a user id to a display label. Defaults to a short id. */
  labelFor?: (userId: string) => string;
  /**
   * Resolves a conversation id to a display name — the group being
   * called. When it returns one, the call is titled by it ("Fix the
   * boiler") and the people move to the subtitle, which is how a
   * group call reads everywhere else. Return null/undefined to fall
   * back to participant names.
   */
  conversationLabel?: (conversationId: string) => string | null | undefined;
  /**
   * Escape hatch for apps that already own a `useCalls` instance (for
   * example to place calls from elsewhere in the UI). When omitted the
   * component manages its own.
   */
  calls?: UseCalls;
  /**
   * The `react-native-webrtc` module (or `@livekit/react-native-webrtc`,
   * which is API-compatible), imported by your app.
   *
   * Used for the peer-to-peer fallback when the deployment has no SFU.
   * With an SFU configured, LiveKit owns the peer connection and this is
   * only the safety net.
   */
  webrtc?: NativeWebRtcModule | null;
  /**
   * `livekit-client`, imported by your app. Enables SFU-backed calls,
   * which is what makes video and the mid-call camera toggle possible.
   * Omit it and calls fall back to the peer-to-peer mesh, audio only.
   */
  livekit?: LiveKitModule | null;
  /**
   * `@livekit/react-native`, imported by your app.
   *
   * Required to *render* video, and also carries `AudioSession`, which
   * is what routes a call to the speaker, the earpiece or a headset.
   * Without it a call still connects and carries audio, every tile
   * shows an avatar, and routing falls to whatever the OS picks.
   */
  livekitReactNative?: LiveKitReactNativeModule | null;
  /**
   * Called whenever the call's media connection state changes.
   */
  onStatusChange?: (status: VoiceStatus) => void;
  /**
   * Called when the media transport changes: `'sfu'`, `'mesh'`, or
   * `null` when no call is connected.
   *
   * This decides who owns the iOS audio session, and getting it wrong is
   * silent. `@livekit/react-native`'s `registerGlobals()` configures and
   * activates AVAudioSession natively as its audio engine changes state.
   * An app that ALSO drives the session — `react-native-incall-manager`,
   * typically — fights it: the microphone publishes nothing, and audio
   * only starts working after some unrelated engine change (turning the
   * camera on) makes LiveKit reapply its configuration.
   *
   * So drive InCallManager from this, and only for `'mesh'`. On the SFU
   * path this component already owns the session, through LiveKit.
   */
  onTransportChange?: (transport: 'sfu' | 'mesh' | null) => void;
  /** Called when the call's video state changes. */
  onVideoChange?: (video: boolean) => void;
  /**
   * `react-native-incall-manager`, imported by your app.
   *
   * Only used here for the ring tones — the earpiece purr while an
   * outbound call rings, and the ringtone for an inbound one. Without
   * it a call is completely silent until somebody answers, which reads
   * as the app having failed to place it at all.
   *
   * Injected rather than imported for the same reason every other
   * native module is: Metro only bundles what it can see statically.
   */
  inCallManager?: RingToneModule | null;
  /**
   * Hide this screen while a call is merely ringing in.
   *
   * Set it when `useVoipCalls` is wired: CallKit already shows the
   * system call UI on the lock screen and in the Dynamic Island, and a
   * second in-app sheet on top of it means one tap of Call produces two
   * competing rings. The screen still appears once the call connects, to
   * carry the in-call controls.
   */
  nativeIncomingUi?: boolean;
}

/** Controls fade out this long after the last touch on a video call. */
const CHROME_IDLE_MS = 4500;

/**
 * The slice of `react-native-incall-manager` used for ring tones.
 *
 * Every method optional: older versions lack some, and a missing tone
 * must never take a call down.
 */
export interface RingToneModule {
  // Deliberately loose, for the same reason `LiveKitModule` is.
  // Spelling the real signatures out does NOT work: function parameters
  // are contravariant, so any shape differing even slightly from the
  // installed version's — an argument required rather than optional, a
  // `number | number[]` rather than a `number[]` — makes the real module
  // unassignable and no app can pass it in. It also breaks again on the
  // next upstream signature change.
  //
  // Narrowed to `RingTone` at the point of use instead.
  startRingback?: (...args: never[]) => void;
  stopRingback?: (...args: never[]) => void;
  startRingtone?: (...args: never[]) => void;
  stopRingtone?: (...args: never[]) => void;
}

/** The shape actually called, narrowed once inside the component. */
type RingTone = (tone: string) => void;

/**
 * WhatsApp-style call UI: a full-screen sheet that covers the app while
 * a call is ringing or connected, and renders nothing when idle.
 *
 * Mount it once, high in the tree, so a call can arrive on any screen:
 *
 *     <PoolseProvider config={config}>
 *       <CallScreen
 *         userId={me.id}
 *         livekit={livekit}
 *         livekitReactNative={livekitRN}
 *       />
 *       <YourApp />
 *     </PoolseProvider>
 *
 * ## Two media paths
 *
 * With `livekit` supplied, media rides the SFU: one upload per
 * participant regardless of call size, and the camera and microphone can
 * be switched on and off at any point. Without it — or against a
 * deployment that has no SFU configured — calls fall back to the
 * peer-to-peer mesh, which is audio only.
 *
 * The fallback is automatic and silent by design. A deployment without
 * an SFU is a supported configuration, not a broken one.
 */
/** How long a finished call stays on screen before closing itself. */
const ENDED_LINGER_MS = 2500;

/**
 * Phases that mean the call is finished and the screen is only
 * reporting the outcome. Shared by the render branch and the
 * self-dismiss timer so the two can never disagree about what "over"
 * means.
 */
function isOver(phase: string): boolean {
  return phase === 'declined' || phase === 'busy' || phase === 'timed-out';
}

export function CallScreen({
  userId,
  labelFor,
  conversationLabel,
  calls: callsProp,
  webrtc,
  livekit,
  livekitReactNative,
  onStatusChange,
  onTransportChange,
  onVideoChange,
  inCallManager,
  nativeIncomingUi,
}: CallScreenProps) {
  const insets = useSafeAreaInsets();
  const ownCalls = useCalls(callsProp ? null : userId);
  const calls = callsProp ?? ownCalls;

  const meshAvailable = isNativeWebRtcAvailable(webrtc);
  const opts = useMemo(
    () => (meshAvailable && webrtc ? { webrtc: createNativeWebRtcAdapter(webrtc) } : {}),
    [meshAvailable, webrtc],
  );

  /**
   * The conversation whose media should be open.
   *
   * Deliberately includes `ringing-out`, not just `active`. Waiting for
   * an answer before touching the camera meant the caller stared at a
   * blank screen through the entire ring and then watched their own
   * preview pop in a second after the other side picked up — and the
   * microphone was not open either, so the first word of every call was
   * clipped. Joining while it rings means the room is warm the instant
   * they answer, and you can see yourself while you wait.
   *
   * Safe for the alone-detection: a caller sitting in an empty room has
   * never seen a peer, and that is exactly the guard `CallRoom.onAlone`
   * checks before declaring a call abandoned.
   */
  const conversationId =
    calls.phase === 'active'
      ? calls.activeConversationId
      : calls.phase === 'ringing-out'
        ? (calls.outgoing?.conversationId ?? null)
        : null;
  const isVideoCall = calls.media === 'video';

  // Both are constructed; only one ends up connected. `useCallRoom`
  // reports `sfuAvailable: false` when the API answers 503, and only
  // then does the mesh join — so a deployment with an SFU never opens a
  // peer connection it will not use.
  const sfu = useCallRoom(livekit ? conversationId : null, {
    livekit: livekit as LiveKitModule,
    video: isVideoCall,
  });
  const mesh = useVoiceRoom(conversationId, opts);

  const usingSfu = sfu.sfuAvailable === true;
  const status: VoiceStatus = usingSfu ? toVoiceStatus(sfu.status) : mesh.status;
  const connected = calls.phase === 'active' && status === 'connected';

  useEffect(() => {
    const wants = calls.phase === 'active' || calls.phase === 'ringing-out';
    if (!wants || !conversationId) return;

    let cancelled = false;
    void (async () => {
      // Try the SFU first when the app supplied LiveKit. A `false` here
      // means the deployment has none, which is the one case the mesh
      // should take over.
      const joined = livekit ? await sfu.join() : false;
      if (cancelled || joined) return;
      if (meshAvailable) await mesh.join();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls.phase, conversationId, livekit, meshAvailable]);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  const transport: 'sfu' | 'mesh' | null =
    status !== 'connected' ? null : usingSfu ? 'sfu' : 'mesh';

  useEffect(() => {
    onTransportChange?.(transport);
  }, [transport, onTransportChange]);

  // The mesh carries no video, so its calls are always audio.
  const videoOn = usingSfu && sfu.cameraEnabled;
  useEffect(() => {
    onVideoChange?.(videoOn);
  }, [videoOn, onVideoChange]);

  // ── audio routing ───────────────────────────────────────────────────

  // Armed on the ring, not on connect: LiveKit's audio session has to be
  // running before its engine starts, and replacing its handlers
  // mid-call is unsupported. Mesh calls are excluded because
  // InCallManager owns the session there — see `onTransportChange`.
  const audio = useCallAudio({
    active: calls.phase !== 'idle' && transport !== 'mesh',
    video: isVideoCall,
    livekitReactNative,
  });
  const [routesOpen, setRoutesOpen] = useState(false);

  /**
   * The sound of a call in progress.
   *
   * Ringback while an outbound call rings, so the caller can hear that
   * something is happening — silence there is indistinguishable from a
   * call that failed to place. A ringtone for an inbound one, but only
   * when this screen is actually showing it: with CallKit driving the
   * ring, iOS plays the system ringtone and a second tone underneath it
   * is just noise.
   *
   * Stopped in the cleanup rather than on a phase transition, so a call
   * that ends any way at all — answered, declined, cancelled, timed out,
   * crashed out — cannot leave a tone playing.
   */
  const showingIncoming = calls.phase === 'ringing-in' && !nativeIncomingUi;
  useEffect(() => {
    const ringing = calls.phase === 'ringing-out';
    if (!ringing && !showingIncoming) return;

    try {
      const start = (ringing ? inCallManager?.startRingback : inCallManager?.startRingtone) as
        | RingTone
        | undefined;
      // `_BUNDLE_` for ringback, not `_DEFAULT_`. On iOS the library
      // resolves `_DEFAULT_` to /Library/Ringtones/Marimba.m4r — an
      // actual iPhone RINGTONE — so the caller heard the sound the
      // callee's phone makes rather than a ringing tone. `_DTMF_` is
      // remapped to `_DEFAULT_` too, so the only correct option is to
      // ship the tone: the app bundles `incallmanager_ringback.mp3`
      // (see the sample's plugins/withRingback.js). Absent that, the
      // library falls back to the ringtone, which is no worse than
      // before.
      start?.(ringing ? '_BUNDLE_' : '_DEFAULT_');
    } catch {
      // A missing tone must never take the call down with it.
    }

    return () => {
      try {
        (inCallManager?.stopRingback as (() => void) | undefined)?.();
        (inCallManager?.stopRingtone as (() => void) | undefined)?.();
      } catch {
        // Nothing playing; nothing to stop.
      }
    };
  }, [calls.phase, showingIncoming, inCallManager]);

  // ── chrome auto-hide ────────────────────────────────────────────────

  const [chromeVisible, setChromeVisible] = useState(true);
  // Bumped on every interaction. Having the effect depend on it is what
  // restarts the countdown — a polled deadline would either fire late or
  // need an interval running for the whole call.
  const [lastWake, setLastWake] = useState(0);

  // Only video calls hide their controls — there is nothing to look at
  // underneath an audio call, so hiding them would just lose the
  // buttons.
  const chromeHides = connected && isVideoCall;

  useEffect(() => {
    setChromeVisible(true);
    if (!chromeHides) return;
    const timer = setTimeout(() => setChromeVisible(false), CHROME_IDLE_MS);
    return () => clearTimeout(timer);
  }, [chromeHides, lastWake]);

  const wakeChrome = useCallback(() => setLastWake(Date.now()), []);

  /**
   * Tapping the screen toggles the controls.
   *
   * It used to only ever show them, and then a timer took them away —
   * so there was no way to dismiss the chrome deliberately and get a
   * clean look at the video. Tap to hide, tap to show, and the idle
   * timer stays as a convenience on top rather than as the only way
   * they ever disappear.
   */
  const toggleChrome = useCallback(() => {
    setChromeVisible((visible) => {
      if (visible) return false;
      setLastWake(Date.now());
      return true;
    });
  }, []);

  /**
   * Run an action and restart the idle countdown.
   *
   * A child `Pressable` wins the touch outright, so the screen-wide
   * handler never sees a control being tapped — without this, hitting
   * mute at four seconds would watch the controls vanish half a second
   * later.
   */
  const withWake = useCallback(
    (fn: () => void) => () => {
      wakeChrome();
      fn();
    },
    [wakeChrome],
  );

  // ── actions ─────────────────────────────────────────────────────────

  // `calls.hangUp()` signals the other side and always returns to idle;
  // `reset()` alone only cleared local state, leaving the peer in a call
  // with a screen it had no reason to close.
  const hangUp = useCallback(() => {
    sfu.leave();
    mesh.leave();
    void calls.hangUp();
  }, [sfu, mesh, calls]);

  // Everyone else vanished without hanging up — their app was killed or
  // their phone lost signal, so no `call:hangup` will ever arrive. End
  // it here rather than leaving the survivor on a dead call screen.
  const alone = usingSfu ? sfu.alone : mesh.alone;

  // Latched, because `hangUp` closes over the room objects and those are
  // rebuilt every render — the effect re-runs constantly, and without a
  // guard it would fire the hang-up repeatedly in the window before the
  // phase actually flips.
  const endedOnEmpty = useRef(false);
  if (calls.phase !== 'active') endedOnEmpty.current = false;

  useEffect(() => {
    if (!alone || calls.phase !== 'active' || endedOnEmpty.current) return;
    endedOnEmpty.current = true;
    hangUp();
  }, [alone, calls.phase, hangUp]);

  /**
   * Close a finished call by itself.
   *
   * "Declined", "Busy" and "No answer" are the end of the story, and
   * leaving them behind a Close button meant every unanswered call
   * ended with the caller dismissing a dialog nobody reads. Long enough
   * to read the word, short enough that it never feels stuck — and the
   * button stays, so a person who looks down mid-countdown still has
   * something to tap.
   */
  useEffect(() => {
    if (!isOver(calls.phase)) return;
    const timer = setTimeout(calls.reset, ENDED_LINGER_MS);
    return () => clearTimeout(timer);
  }, [calls.phase, calls.reset]);

  const micOn = usingSfu ? sfu.micEnabled : !mesh.muted;
  const toggleMic = useCallback(() => {
    if (usingSfu) void sfu.toggleMic();
    else mesh.toggleMute();
  }, [usingSfu, sfu, mesh]);

  const onSpeakerPress = useCallback(() => {
    // With real devices to choose between, a toggle is the wrong
    // control — it can only ever reach two of them. Android enumerates
    // them, so it gets a picker; iOS hands the job to the system sheet,
    // which is the only way to reach AirPods or AirPlay there.
    if (audio.routes.length > 2) setRoutesOpen(true);
    else if (audio.canPickSystemRoute && audio.externalDevice) audio.openSystemRoutePicker();
    else audio.toggleSpeaker();
  }, [audio]);

  // ── presentation ────────────────────────────────────────────────────

  const label = useMemo(() => labelFor ?? ((id: string) => `User ${id.slice(0, 6)}`), [labelFor]);

  const ringingIn = calls.phase === 'ringing-in';
  const ringingOut = calls.phase === 'ringing-out';
  const ended = isOver(calls.phase);
  const visible = calls.phase !== 'idle' && !(nativeIncomingUi && ringingIn);

  const duration = useCallDuration(connected);
  const participants: CallParticipant[] = usingSfu ? sfu.participants : [];
  const others = participants.filter((p) => !p.isSelf);
  const isGroup = others.length > 1 || (calls.outgoing?.calleeUserIds.length ?? 0) > 1;

  const peerIds =
    ringingIn && calls.incoming
      ? [calls.incoming.callerUserId]
      : others.length > 0
        ? others.map((p) => p.userId)
        : (calls.outgoing?.calleeUserIds ?? []);

  const peerTitle =
    peerIds.length === 0
      ? 'Call'
      : peerIds.length <= 2
        ? peerIds.map(label).join(', ')
        : `${label(peerIds[0]!)} and ${peerIds.length - 1} others`;

  // A named conversation titles the call; the people become the
  // subtitle. Incoming rings know their conversation before any media
  // does, so look there too.
  const titleConversationId =
    conversationId ?? (ringingIn ? (calls.incoming?.conversationId ?? null) : null);
  const convName = titleConversationId ? (conversationLabel?.(titleConversationId) ?? null) : null;
  const title = convName || peerTitle;

  const statusText = duration ?? statusLine(calls, status);
  // With the loop name as the title, say who is involved before the
  // status — "Elena · Incoming call" under "Fix the boiler".
  const subtitle =
    convName && !duration && peerIds.length > 0 ? `${peerTitle} · ${statusText}` : statusText;

  // The stage only earns the screen once media is flowing. Before that
  // there is nothing to render but a placeholder, and the identity card
  // says far more.
  const showStage = connected && usingSfu && participants.length > 0;

  const error = calls.error ?? (usingSfu ? sfu.error : mesh.error);
  // Only the scrolling group grid uses this — it keeps the last row
  // clear of the control bar. The floating preview is bounded by the
  // safe area instead, so it can sit in a real corner.
  const chromeInsets = {
    top: insets.top + 72,
    bottom: insets.bottom + 150,
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={hangUp}
    >
      <StatusBar barStyle="light-content" />
      <Pressable style={styles.screen} onPress={toggleChrome} accessible={false}>
        <CallBackdrop />
        {showStage ? (
          <CallVideoGrid
            participants={participants}
            livekitReactNative={livekitReactNative}
            labelFor={label}
            onLocalPress={() => void sfu.switchCamera()}
            chromeInsets={chromeInsets}
            safeArea={{ top: insets.top, bottom: insets.bottom }}
          />
        ) : (
          // Audio (and pre-media) calls carry their identity in the
          // middle of the scene — name under the avatar, status in a
          // pill — rather than a bar pinned to the top of a void.
          <View
            style={[styles.identity, { paddingBottom: insets.bottom + 160 }]}
            pointerEvents="none"
          >
            <View style={styles.avatarStage}>
              {(ringingIn || ringingOut) && <PulseRings size={132} color={callColors.glow} />}
              <CallAvatar
                name={peerIds.length === 1 ? label(peerIds[0]!) : title}
                seed={titleConversationId ?? peerIds[0] ?? 'call'}
                size={132}
              />
            </View>
            <Text numberOfLines={2} style={styles.identityTitle}>
              {title}
            </Text>
            <View style={styles.statusPill}>
              {connected && <View style={styles.statusDot} />}
              <Text style={styles.statusText}>{subtitle}</Text>
            </View>
          </View>
        )}

        {/* ── header — only over video, where the scene is the people */}
        {chromeVisible && showStage && (
          <View style={[styles.header, { paddingTop: insets.top + 14 }]} pointerEvents="box-none">
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            <View style={styles.subtitleRow}>
              {isGroup && (
                <PoolseIcon name="users" size={14} color={callColors.textDim} label={null} />
              )}
              <Text style={styles.subtitle}>
                {isGroup ? `${participants.length} · ${subtitle}` : subtitle}
              </Text>
            </View>
          </View>
        )}

        {/* ── controls ───────────────────────────────────────────── */}
        {chromeVisible && (
          <View
            style={[styles.controls, { paddingBottom: insets.bottom + 22 }]}
            pointerEvents="box-none"
          >
            {error && <Text style={styles.error}>{error.message}</Text>}
            {!meshAvailable && !livekit && (
              <Text style={styles.error}>No WebRTC module supplied — this call has no audio.</Text>
            )}

            {ringingIn ? (
              <View style={styles.answerRow}>
                <CallControlButton
                  icon="phone-off"
                  tone="danger"
                  large
                  label="Decline"
                  onPress={() => void calls.decline()}
                  accessibilityLabel="Decline call"
                />
                <CallControlButton
                  icon={isVideoCall ? 'video' : 'phone'}
                  tone="accept"
                  large
                  label="Accept"
                  onPress={() => void calls.accept()}
                  accessibilityLabel="Accept call"
                />
              </View>
            ) : ended ? (
              <View style={styles.row}>
                <CallControlButton
                  icon="close"
                  onPress={calls.reset}
                  label="Close"
                  accessibilityLabel="Close"
                />
              </View>
            ) : (
              <>
                <View style={styles.dock}>
                  <CallControlButton
                    icon={micOn ? 'mic' : 'mic-off'}
                    label={micOn ? 'Mute' : 'Unmute'}
                    active={!micOn}
                    onPress={withWake(toggleMic)}
                    accessibilityLabel={micOn ? 'Mute microphone' : 'Unmute microphone'}
                  />
                  <CallControlButton
                    icon={speakerIcon(audio)}
                    label={speakerLabel(audio)}
                    active={audio.speakerOn}
                    onPress={withWake(onSpeakerPress)}
                    accessibilityLabel="Audio output"
                  />
                  {/* Only the SFU can add video to a live call — the mesh
                      offers once, on peer discovery, and cannot renegotiate. */}
                  {usingSfu && (
                    <CallControlButton
                      icon={videoOn ? 'video' : 'video-off'}
                      label="Camera"
                      active={!videoOn}
                      onPress={withWake(() => void sfu.toggleCamera())}
                      accessibilityLabel={videoOn ? 'Turn camera off' : 'Turn camera on'}
                    />
                  )}
                  {usingSfu && videoOn && (
                    <CallControlButton
                      icon="camera-flip"
                      label="Flip"
                      onPress={withWake(() => void sfu.switchCamera())}
                      accessibilityLabel="Switch camera"
                    />
                  )}
                </View>{/* dock */}

                <View style={styles.hangUpRow}>
                  <CallControlButton
                    icon="phone-off"
                    tone="danger"
                    large
                    onPress={ringingOut ? () => void calls.cancel() : hangUp}
                    accessibilityLabel={ringingOut ? 'Cancel call' : 'Hang up'}
                  />
                </View>
              </>
            )}
          </View>
        )}

        <AudioRouteSheet
          visible={routesOpen}
          routes={audio.routes}
          selectedRouteId={audio.selectedRouteId}
          onSelect={audio.selectRoute}
          onClose={() => setRoutesOpen(false)}
        />
      </Pressable>
    </Modal>
  );
}

function speakerIcon(audio: { speakerOn: boolean; externalDevice: boolean }) {
  if (audio.externalDevice) return 'headphones' as const;
  return audio.speakerOn ? ('speaker' as const) : ('speaker-off' as const);
}

function speakerLabel(audio: { externalDevice: boolean }) {
  return audio.externalDevice ? 'Audio' : 'Speaker';
}

/** The SFU's lifecycle mapped onto the one the mesh already reports. */
function toVoiceStatus(status: string): VoiceStatus {
  switch (status) {
    case 'connecting':
      return 'connecting';
    case 'connected':
      return 'connected';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

function statusLine(calls: UseCalls, mediaStatus: string): string {
  switch (calls.phase) {
    case 'ringing-in':
      return calls.media === 'video' ? 'Incoming video call' : 'Incoming call';
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: callColors.bg },

  identity: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 18,
  },
  avatarStage: {
    width: 132,
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  identityTitle: {
    color: callColors.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: callColors.glass,
    borderWidth: 1,
    borderColor: callColors.glassBorder,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: callColors.accept,
  },
  statusText: {
    color: callColors.textDim,
    fontSize: 13.5,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },

  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 24,
    paddingBottom: 18,
    backgroundColor: callColors.scrim,
  },
  title: { color: callColors.text, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  subtitle: { color: callColors.textDim, fontSize: 14.5 },

  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    gap: 18,
    paddingTop: 20,
  },
  // The floating control dock: one glass card carrying the in-call
  // toggles, instead of loose buttons on a full-width scrim band.
  dock: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    rowGap: 16,
    backgroundColor: callColors.glass,
    borderWidth: 1,
    borderColor: callColors.glassBorder,
    borderRadius: 44,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginHorizontal: 24,
  },
  row: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', rowGap: 16 },
  answerRow: { flexDirection: 'row', justifyContent: 'center', gap: 72 },
  hangUpRow: { flexDirection: 'row', justifyContent: 'center' },
  error: {
    color: callColors.danger,
    fontSize: 12.5,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
