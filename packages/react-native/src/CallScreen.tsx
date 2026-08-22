import { useCallRoom, useCalls, useVoiceRoom, type UseCalls } from '@poolse/react';
import type { LiveKitModule, VoiceStatus } from '@poolse/sdk';
import { useCallback, useEffect, useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePoolseTheme } from './theme/PoolseTheme.js';
import { CallVideoGrid, type LiveKitReactNativeModule } from './voice/CallVideoGrid.js';
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
   * `@livekit/react-native`, imported by your app. Required to *render*
   * video; without it a video call still connects and carries audio, and
   * every tile shows a placeholder.
   */
  livekitReactNative?: LiveKitReactNativeModule | null;
  /**
   * Called whenever the call's media connection state changes. Drive
   * speakerphone and the proximity sensor from here — see
   * {@link VoiceRoomBarProps.onStatusChange}.
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
   * So drive InCallManager from this, and only for `'mesh'`. The mesh
   * has no session management of its own and still needs it.
   */
  onTransportChange?: (transport: 'sfu' | 'mesh' | null) => void;
  /**
   * Called when the call's video state changes.
   *
   * A video call belongs on the speaker with the proximity sensor OFF —
   * otherwise the screen blanks the moment the phone comes near your
   * face, which is exactly when you are looking at it.
   */
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

/**
 * WhatsApp-style call UI: a full-screen sheet that covers the app while
 * a call is ringing or connected, and renders nothing when idle.
 *
 * Mount it once, high in the tree, so a call can arrive on any screen:
 *
 *     <PoolseProvider config={config}>
 *       <CallScreen userId={me.id} livekit={livekit} livekitReactNative={livekitRN} />
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
  const theme = usePoolseTheme();
  const ownCalls = useCalls(callsProp ? null : userId);
  const calls = callsProp ?? ownCalls;

  const meshAvailable = isNativeWebRtcAvailable(webrtc);
  const opts = useMemo(
    () => (meshAvailable && webrtc ? { webrtc: createNativeWebRtcAdapter(webrtc) } : {}),
    [meshAvailable, webrtc],
  );

  const conversationId = calls.phase === 'active' ? calls.activeConversationId : null;

  // Both are constructed; only one ends up connected. `useCallRoom`
  // reports `sfuAvailable: false` when the API answers 503, and only
  // then does the mesh join — so a deployment with an SFU never opens a
  // peer connection it will not use.
  const sfu = useCallRoom(livekit ? conversationId : null, {
    livekit: livekit as LiveKitModule,
    video: calls.media === 'video',
  });
  const mesh = useVoiceRoom(conversationId, opts);

  const usingSfu = sfu.sfuAvailable === true;
  const status: VoiceStatus = usingSfu ? toVoiceStatus(sfu.status) : mesh.status;

  useEffect(() => {
    if (calls.phase !== 'active' || !conversationId) return;

    let cancelled = false;
    void (async () => {
      // Try the SFU first when the app supplied LiveKit. A `false` here
      // means the deployment has none, which is the one case the mesh
      // should take over.
      const connected = livekit ? await sfu.join() : false;
      if (cancelled || connected) return;
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

  const label = labelFor ?? ((id: string) => `User ${id.slice(0, 6)}`);

  const ringingIn = calls.phase === 'ringing-in';
  const visible = calls.phase !== 'idle' && !(nativeIncomingUi && ringingIn);

  // `calls.hangUp()` signals the other side and always returns to idle;
  // `reset()` alone only cleared local state, leaving the peer in a call
  // with a screen it had no reason to close.
  const hangUp = useCallback(() => {
    sfu.leave();
    mesh.leave();
    void calls.hangUp();
  }, [sfu, mesh, calls]);

  const micOn = usingSfu ? sfu.micEnabled : !mesh.muted;
  const toggleMic = useCallback(() => {
    if (usingSfu) void sfu.toggleMic();
    else mesh.toggleMute();
  }, [usingSfu, sfu, mesh]);

  const error = calls.error ?? (usingSfu ? sfu.error : mesh.error);
  const connected = calls.phase === 'active' && status === 'connected';

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={hangUp}>
      <View style={[styles.screen, { backgroundColor: theme.colors.paper }]}>
        {connected && usingSfu && sfu.participants.length > 0 ? (
          <CallVideoGrid
            participants={sfu.participants}
            livekitReactNative={livekitReactNative}
            labelFor={labelFor}
          />
        ) : (
          <View style={styles.identity}>
            <Text style={[styles.who, { color: theme.colors.ink }]}>
              {ringingIn && calls.incoming
                ? label(calls.incoming.callerUserId)
                : calls.outgoing
                  ? calls.outgoing.calleeUserIds.map(label).join(', ')
                  : ''}
            </Text>
            <Text style={[styles.state, { color: theme.colors.ink3 }]}>
              {statusLine(calls, status)}
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          {ringingIn ? (
            <>
              <CallButton
                label="Decline"
                color={theme.colors.error}
                onPress={() => void calls.decline()}
              />
              <CallButton
                label="Accept"
                color={theme.colors.brand}
                onPress={() => void calls.accept()}
              />
            </>
          ) : calls.phase === 'ringing-out' ? (
            <CallButton
              label="Cancel"
              color={theme.colors.error}
              onPress={() => void calls.cancel()}
            />
          ) : calls.phase === 'declined' ||
            calls.phase === 'busy' ||
            calls.phase === 'timed-out' ? (
            <CallButton label="Close" color={theme.colors.ink3} onPress={calls.reset} />
          ) : (
            <>
              <CallButton
                label={micOn ? 'Mute' : 'Unmute'}
                color={micOn ? theme.colors.ink2 : theme.colors.brand}
                onPress={toggleMic}
              />
              {/* Only the SFU can add video to a live call — the mesh
                  offers once, on peer discovery, and cannot renegotiate. */}
              {usingSfu && (
                <CallButton
                  label={videoOn ? 'Camera off' : 'Camera on'}
                  color={videoOn ? theme.colors.brand : theme.colors.ink2}
                  onPress={() => void sfu.toggleCamera()}
                />
              )}
              <CallButton label="Hang up" color={theme.colors.error} onPress={hangUp} />
            </>
          )}
        </View>

        {!meshAvailable && !livekit && (
          <Text style={[styles.warn, { color: theme.colors.error }]}>
            No WebRTC module supplied — this call has no audio.
          </Text>
        )}
        {error && <Text style={[styles.warn, { color: theme.colors.error }]}>{error.message}</Text>}
      </View>
    </Modal>
  );
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
      return calls.media === 'video' ? 'Incoming video call…' : 'Incoming call…';
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

function CallButton({
  label,
  color,
  onPress,
}: {
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.callBtn, { backgroundColor: color }]}
    >
      <Text style={styles.callBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'space-between', paddingVertical: 72, paddingHorizontal: 24 },
  identity: { alignItems: 'center', gap: 8, marginTop: 48 },
  who: { fontSize: 28, fontWeight: '600', textAlign: 'center' },
  state: { fontSize: 15 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 12, flexWrap: 'wrap' },
  callBtn: {
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderRadius: 999,
    minWidth: 108,
    alignItems: 'center',
  },
  callBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  warn: { fontSize: 12, textAlign: 'center', marginTop: 12 },
});
