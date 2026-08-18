import { useVoiceRoom } from '@poolse/react';
import type { VoiceParticipant } from '@poolse/sdk';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { usePoolseTheme } from './theme/PoolseTheme.js';
import { createNativeWebRtcAdapter, isNativeWebRtcAvailable } from './voice/webrtc-native.js';

export interface VoiceRoomBarProps {
  conversationId: string;
  /** Resolves a user id to a display label. Defaults to a short id. */
  labelFor?: (userId: string) => string;
  /**
   * Rendered instead of the join button when `react-native-webrtc`
   * isn't installed. Defaults to an inline explanation.
   */
  unavailableSlot?: React.ReactNode;
}

/**
 * Discord-style voice bar: one "Join Voice" button that expands into a
 * roster of who's in, with a ring around whoever is talking.
 *
 * Drop it above a `<ConversationView>` to give a conversation an
 * always-on voice channel. For ringing a specific person, use
 * `<IncomingCallSheet>` together with `useCalls`.
 */
export function VoiceRoomBar({ conversationId, labelFor, unavailableSlot }: VoiceRoomBarProps) {
  const theme = usePoolseTheme();
  const available = isNativeWebRtcAvailable();

  // Building the adapter throws when the native module is missing, so
  // it is only constructed on the path where we know it resolves.
  const opts = useMemo(
    () => (available ? { webrtc: createNativeWebRtcAdapter() } : {}),
    [available],
  );

  const { status, participants, muted, join, leave, toggleMute, error } = useVoiceRoom(
    available ? conversationId : null,
    opts,
  );

  const label = labelFor ?? ((id: string) => `User ${id.slice(0, 6)}`);
  const connected = status === 'connected';

  if (!available) {
    return (
      <View
        style={[
          styles.bar,
          { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border },
        ]}
      >
        {unavailableSlot ?? (
          <Text style={[styles.hint, { color: theme.colors.ink3 }]}>
            Voice needs react-native-webrtc and a development build.
          </Text>
        )}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border },
      ]}
    >
      <View style={styles.row}>
        <View
          style={[
            styles.dot,
            { backgroundColor: connected ? theme.colors.brand : theme.colors.ink3 },
          ]}
        />

        {connected ? (
          <>
            <View style={styles.people}>
              {participants.length === 0 ? (
                <Text style={[styles.hint, { color: theme.colors.ink3 }]}>Waiting for others…</Text>
              ) : (
                participants.map((p) => (
                  <ParticipantChip key={p.userId} participant={p} label={label(p.userId)} />
                ))
              )}
            </View>

            <Pressable
              onPress={toggleMute}
              accessibilityRole="button"
              accessibilityState={{ selected: muted }}
              style={[
                styles.btn,
                {
                  borderColor: muted ? theme.colors.brand : theme.colors.border,
                  backgroundColor: muted ? theme.colors.brandSoft : theme.colors.paper,
                },
              ]}
            >
              <Text style={{ color: theme.colors.ink2 }}>{muted ? 'Unmute' : 'Mute'}</Text>
            </Pressable>

            <Pressable
              onPress={leave}
              accessibilityRole="button"
              style={[styles.btn, { borderColor: theme.colors.error }]}
            >
              <Text style={{ color: theme.colors.error }}>Leave</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[styles.hint, { color: theme.colors.ink3 }]}>
              {status === 'connecting' ? 'Connecting…' : 'Talk to everyone here'}
            </Text>
            <Pressable
              onPress={() => void join()}
              disabled={status === 'connecting'}
              accessibilityRole="button"
              style={[styles.btn, styles.btnPrimary, { backgroundColor: theme.colors.brand }]}
            >
              <Text style={{ color: theme.colors.onBrand, fontWeight: '600' }}>
                {status === 'connecting' ? 'Joining…' : 'Join Voice'}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      {error && <Text style={[styles.error, { color: theme.colors.error }]}>{error.message}</Text>}
    </View>
  );
}

function ParticipantChip({ participant, label }: { participant: VoiceParticipant; label: string }) {
  const theme = usePoolseTheme();
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: theme.colors.paper,
          // The speaking ring is a border colour swap rather than an
          // extra element, so the row never reflows mid-sentence.
          borderColor: participant.speaking ? theme.colors.brand : theme.colors.border,
          opacity: participant.muted ? 0.62 : 1,
        },
      ]}
    >
      <Text style={{ color: theme.colors.ink2, fontSize: 13 }} numberOfLines={1}>
        {label}
        {participant.isSelf ? ' (you)' : ''}
      </Text>
      {participant.muted && (
        <Text style={{ color: theme.colors.error, fontSize: 11, fontWeight: '700' }}>✕</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  people: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  btn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  btnPrimary: { borderWidth: 0 },
  hint: { fontSize: 13, flexShrink: 1 },
  error: { fontSize: 12, marginTop: 6 },
});
