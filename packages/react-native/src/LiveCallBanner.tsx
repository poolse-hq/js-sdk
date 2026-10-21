import type { LiveCall } from '@poolse/sdk';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface LiveCallBannerProps {
  call: LiveCall;
  /** How many people are in the room right now. */
  inCall: number;
  onJoin: (call: LiveCall) => void;
}

/**
 * "Voice call in progress · 2 on the call  [Join]" — a strip across the
 * top of a conversation while a call runs that the viewer is not on.
 * `<ConversationView onJoinCall>` renders it for you; use it directly
 * to place it elsewhere (with `useLiveCall`).
 */
export function LiveCallBanner({ call, inCall, onJoin }: LiveCallBannerProps) {
  const theme = usePoolseTheme();
  const what = call.media === 'video' ? 'Video call in progress' : 'Voice call in progress';
  const who = inCall > 0 ? `${inCall} on the call` : 'Ringing';
  return (
    <View
      style={[styles.bar, { backgroundColor: theme.colors.success }]}
      accessibilityRole="summary"
      accessibilityLabel={`${what}, ${who}`}
    >
      <PoolseIcon
        name={call.media === 'video' ? 'video' : 'phone'}
        size={16}
        color="#FFFFFF"
        label={null}
      />
      <View style={styles.text}>
        <Text style={[styles.title, { fontFamily: theme.type.fontBody }]} numberOfLines={1}>
          {what}
        </Text>
        <Text style={[styles.meta, { fontFamily: theme.type.fontBody }]} numberOfLines={1}>
          {who}
        </Text>
      </View>
      <Pressable
        onPress={() => onJoin(call)}
        accessibilityRole="button"
        accessibilityLabel="Join call"
        hitSlop={8}
        style={({ pressed }) => [styles.join, pressed && styles.joinPressed]}
      >
        <Text
          style={[
            styles.joinText,
            { color: theme.colors.success, fontFamily: theme.type.fontBody },
          ]}
        >
          Join
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  text: { flex: 1, minWidth: 0 },
  title: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  meta: { color: 'rgba(255,255,255,0.85)', fontSize: 12 },
  join: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  joinPressed: { opacity: 0.8 },
  joinText: { fontSize: 14, fontWeight: '700' },
});
