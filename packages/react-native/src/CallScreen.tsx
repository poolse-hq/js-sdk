import { useCalls, useVoiceRoom, type UseCalls } from '@poolse/react';
import { useEffect, useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePoolseTheme } from './theme/PoolseTheme.js';
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
   * The `react-native-webrtc` module, imported by your app. Required for
   * call audio; without it the screen still rings and connects but warns
   * that there is no audio. See {@link VoiceRoomBarProps.webrtc}.
   */
  webrtc?: NativeWebRtcModule | null;
}

/**
 * WhatsApp-style call UI: a full-screen sheet that covers the app while
 * a call is ringing or connected, and renders nothing when idle.
 *
 * Mount it once, high in the tree, so a call can arrive on any screen:
 *
 *     <PoolseProvider config={config}>
 *       <CallScreen userId={me.id} />
 *       <YourApp />
 *     </PoolseProvider>
 *
 * Placing a call is separate — `useCalls().call(conversationId)`, wired
 * to whatever button your UI wants. Pass the same instance in via
 * `calls` so both halves share one state machine.
 */
export function CallScreen({ userId, labelFor, calls: external, webrtc }: CallScreenProps) {
  const theme = usePoolseTheme();
  const own = useCalls(external ? null : userId);
  const calls = external ?? own;

  const available = isNativeWebRtcAvailable(webrtc);
  const opts = useMemo(
    () => (available && webrtc ? { webrtc: createNativeWebRtcAdapter(webrtc) } : {}),
    [available, webrtc],
  );

  // The voice room only exists once a call is actually connected — the
  // hook tears it down on its own when the id goes back to null.
  const voice = useVoiceRoom(
    calls.phase === 'active' && available ? calls.activeConversationId : null,
    opts,
  );

  // Audio starts on `active`, which both sides reach: the callee when
  // it accepts, the caller when `call:accepted` arrives.
  useEffect(() => {
    if (calls.phase === 'active' && voice.status === 'idle') void voice.join();
  }, [calls.phase, voice]);

  const label = labelFor ?? ((id: string) => `User ${id.slice(0, 6)}`);
  const visible = calls.phase !== 'idle';

  const hangUp = () => {
    voice.leave();
    calls.reset();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={hangUp}>
      <View style={[styles.screen, { backgroundColor: theme.colors.paper }]}>
        <View style={styles.identity}>
          <Text style={[styles.who, { color: theme.colors.ink }]}>
            {calls.phase === 'ringing-in' && calls.incoming
              ? label(calls.incoming.callerUserId)
              : calls.outgoing
                ? calls.outgoing.calleeUserIds.map(label).join(', ')
                : ''}
          </Text>
          <Text style={[styles.state, { color: theme.colors.ink3 }]}>
            {statusLine(calls, voice.status)}
          </Text>
        </View>

        <View style={styles.actions}>
          {calls.phase === 'ringing-in' ? (
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
                label={voice.muted ? 'Unmute' : 'Mute'}
                color={theme.colors.ink2}
                onPress={voice.toggleMute}
              />
              <CallButton label="Hang up" color={theme.colors.error} onPress={hangUp} />
            </>
          )}
        </View>

        {!available && (
          <Text style={[styles.warn, { color: theme.colors.error }]}>
            react-native-webrtc is not installed — this call has no audio.
          </Text>
        )}
        {(calls.error ?? voice.error) && (
          <Text style={[styles.warn, { color: theme.colors.error }]}>
            {(calls.error ?? voice.error)?.message}
          </Text>
        )}
      </View>
    </Modal>
  );
}

function statusLine(calls: UseCalls, voiceStatus: string): string {
  switch (calls.phase) {
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
      return voiceStatus === 'connected' ? 'Connected' : 'Connecting…';
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
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 16 },
  callBtn: {
    paddingHorizontal: 26,
    paddingVertical: 16,
    borderRadius: 999,
    minWidth: 128,
    alignItems: 'center',
  },
  callBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  warn: { fontSize: 12, textAlign: 'center', marginTop: 12 },
});
