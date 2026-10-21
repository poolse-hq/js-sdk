import type { Message } from '@poolse/sdk';
import { callLogDisplayFor } from '@poolse/react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface CallLogRowProps {
  /** The call-log message. Rows that aren't call logs render nothing. */
  msg: Pick<Message, 'type' | 'body' | 'inserted_at'> & { deleted_at?: string | null };
  /** Current user's id — decides how the call is worded for them. */
  meId: string | null;
  /**
   * Offer "Call back" on calls the viewer missed or declined, or placed
   * with no answer. Receives the call's media. Omit to show no action.
   */
  onCallBack?: (media: 'audio' | 'video') => void;
}

/**
 * Centered, compact timeline line for call-log system messages
 * ("Voice call · 3:12", "Missed call"). Same visual family as
 * `<DaySeparator>` — surface chip, hairline border, small semibold
 * label — so it reads as a separator between bubble clusters rather
 * than a message. No reactions, thread pill, swipe or long-press.
 *
 * `<MessageRow>` renders this automatically for call-log messages.
 */
export function CallLogRow({ msg, meId, onCallBack }: CallLogRowProps) {
  const theme = usePoolseTheme();
  const display = callLogDisplayFor(msg, meId);
  if (!display) return null;

  const accent = display.missed ? theme.colors.error : theme.colors.ink3;
  const time = formatTime(msg.inserted_at);
  const label = [display.title, display.detail, time].filter(Boolean).join(', ');
  const metaStyle = [styles.meta, { color: theme.colors.ink3, fontFamily: theme.type.fontBody }];

  return (
    <View style={styles.wrap} accessible accessibilityLabel={label}>
      <View
        style={[
          styles.chip,
          {
            backgroundColor: theme.colors.surface2,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <PoolseIcon name={display.media === 'video' ? 'video' : 'phone'} size={13} color={accent} />
        <Text
          style={[
            styles.title,
            {
              color: display.missed ? theme.colors.error : theme.colors.ink2,
              fontFamily: theme.type.fontBody,
            },
          ]}
          numberOfLines={1}
        >
          {display.title}
        </Text>
        {display.detail ? <Text style={metaStyle}>· {display.detail}</Text> : null}
        {time ? <Text style={metaStyle}>· {time}</Text> : null}
      </View>
      {display.callBack && onCallBack ? (
        <Pressable
          onPress={() => onCallBack(display.media)}
          accessibilityRole="button"
          accessibilityLabel={display.media === 'video' ? 'Video call back' : 'Call back'}
          hitSlop={8}
          style={({ pressed }) => [styles.callBack, pressed && styles.callBackPressed]}
        >
          <Text
            style={[
              styles.callBackText,
              { color: theme.colors.brand, fontFamily: theme.type.fontBody },
            ]}
          >
            Call back
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    alignSelf: 'stretch',
    marginVertical: 6,
    paddingHorizontal: 16,
    gap: 4,
  },
  callBack: { paddingHorizontal: 10, paddingVertical: 2 },
  callBackPressed: { opacity: 0.6 },
  callBackText: { fontSize: 12, fontWeight: '600' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  meta: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },
});
