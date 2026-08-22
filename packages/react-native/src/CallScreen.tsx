import { useCallRoom, useCalls, useVoiceRoom, type UseCalls } from '@poolse/react';
import type { CallParticipant, LiveKitModule, VoiceStatus } from '@poolse/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { AudioRouteSheet } from './voice/AudioRouteSheet.js';
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
export function CallScreen({
  userId,
  labelFor,
  calls: callsProp,
  webrtc,
  livekit,
  livekitReactNative,
  onStatusChange,
  onTransportChange,
  onVideoChange,
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

  const conversationId = calls.phase === 'active' ? calls.activeConversationId : null;
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
    if (calls.phase !== 'active' || !conversationId) return;

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
  const ended = calls.phase === 'declined' || calls.phase === 'busy' || calls.phase === 'timed-out';
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

  const title =
    peerIds.length === 0
      ? 'Call'
      : peerIds.length <= 2
        ? peerIds.map(label).join(', ')
        : `${label(peerIds[0]!)} and ${peerIds.length - 1} others`;

  const subtitle = duration ?? statusLine(calls, status);

  // The stage only earns the screen once media is flowing. Before that
  // there is nothing to render but a placeholder, and the identity card
  // says far more.
  const showStage = connected && usingSfu && participants.length > 0;

  const error = calls.error ?? (usingSfu ? sfu.error : mesh.error);
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
      <Pressable style={styles.screen} onPress={wakeChrome} accessible={false}>
        {showStage ? (
          <CallVideoGrid
            participants={participants}
            livekitReactNative={livekitReactNative}
            labelFor={label}
            onLocalPress={() => void sfu.switchCamera()}
            chromeInsets={chromeInsets}
          />
        ) : (
          <View style={styles.identity}>
            <CallAvatar
              name={peerIds.length === 1 ? label(peerIds[0]!) : title}
              seed={peerIds[0] ?? 'call'}
              size={132}
            />
          </View>
        )}

        {/* ── header ─────────────────────────────────────────────── */}
        {chromeVisible && (
          <View style={[styles.header, { paddingTop: insets.top + 14 }]} pointerEvents="box-none">
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            <View style={styles.subtitleRow}>
              {isGroup && showStage && (
                <PoolseIcon name="users" size={14} color={callColors.textDim} label={null} />
              )}
              <Text style={styles.subtitle}>
                {isGroup && showStage ? `${participants.length} · ${subtitle}` : subtitle}
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
              <View style={styles.row}>
                <CallControlButton
                  icon="phone-off"
                  tone="danger"
                  large
                  onPress={() => void calls.decline()}
                  accessibilityLabel="Decline call"
                />
                <CallControlButton
                  icon={isVideoCall ? 'video' : 'phone'}
                  tone="accept"
                  large
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
                <View style={styles.row}>
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
                </View>

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
  identity: { flex: 1, alignItems: 'center', justifyContent: 'center' },

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
  title: { color: callColors.text, fontSize: 22, fontWeight: '600', textAlign: 'center' },
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
    backgroundColor: callColors.scrim,
  },
  row: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', rowGap: 16 },
  hangUpRow: { flexDirection: 'row', justifyContent: 'center' },
  error: {
    color: callColors.danger,
    fontSize: 12.5,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
