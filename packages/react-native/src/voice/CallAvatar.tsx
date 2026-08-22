import { StyleSheet, Text, View } from 'react-native';

import { userColor } from '../primitives/userColor.js';
import { callColors } from './callTheme.js';

export interface CallAvatarProps {
  /** Display name; the first letters become the initials. */
  name: string;
  /** Stable colour seed — the poolse user id. */
  seed: string;
  size: number;
  /** Draw the active-speaker ring. */
  speaking?: boolean;
}

/**
 * The stand-in for a face when a camera is off.
 *
 * Separate from `<Avatar>` rather than a size variant of it: this one
 * scales to a third of the screen, carries the speaking ring, and lives
 * on a dark surface, none of which the list avatar wants.
 *
 * The ring sits OUTSIDE the circle, drawn as a border on a larger box.
 * Growing the avatar itself to show speaking would make everything jump
 * every time somebody starts talking.
 */
export function CallAvatar({ name, seed, size, speaking = false }: CallAvatarProps) {
  const ring = Math.max(2, Math.round(size * 0.045));
  const outer = size + ring * 4;

  return (
    <View
      style={[
        styles.ring,
        {
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          borderWidth: ring,
          borderColor: speaking ? callColors.accept : 'transparent',
        },
      ]}
    >
      <View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: userColor(seed),
          },
        ]}
      >
        <Text
          style={[styles.initials, { fontSize: Math.round(size * 0.38) }]}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {initialsOf(name)}
        </Text>
      </View>
    </View>
  );
}

/** Up to two initials, matching how the rest of the SDK derives them. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const styles = StyleSheet.create({
  ring: { alignItems: 'center', justifyContent: 'center' },
  circle: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#ffffff', fontWeight: '600' },
});
