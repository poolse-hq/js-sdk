import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PoolseIcon, type IconName } from '../primitives/PoolseIcon.js';
import { CONTROL_SIZE, CONTROL_SIZE_LARGE, callColors } from './callTheme.js';

export interface CallControlButtonProps {
  icon: IconName;
  /** Shown under the button. Omit for the hang-up / answer buttons. */
  label?: string | undefined;
  /**
   * The control is doing something — muted, speaker forced on, camera
   * off. Inverts the button so engaged controls are readable at a
   * glance.
   */
  active?: boolean;
  /** Paints the button a solid colour: the hang-up and answer actions. */
  tone?: 'neutral' | 'danger' | 'accept';
  large?: boolean;
  disabled?: boolean;
  onPress: () => void;
  /**
   * Spoken description. Defaults to `label`, but a toggle needs to say
   * what pressing it will DO, which is rarely what the label says —
   * "Mute" under a button that unmutes is exactly backwards for anyone
   * using a screen reader.
   */
  accessibilityLabel?: string | undefined;
}

/**
 * One round call control.
 *
 * Fixed diameter and a caption underneath, so a row of them lines up on
 * a grid regardless of label length — the thing that makes a control
 * bar look built rather than assembled.
 */
export function CallControlButton({
  icon,
  label,
  active = false,
  tone = 'neutral',
  large = false,
  disabled = false,
  onPress,
  accessibilityLabel,
}: CallControlButtonProps) {
  const size = large ? CONTROL_SIZE_LARGE : CONTROL_SIZE;

  const background =
    tone === 'danger'
      ? callColors.danger
      : tone === 'accept'
        ? callColors.accept
        : active
          ? callColors.controlActive
          : callColors.control;

  const iconColor =
    tone === 'neutral' && active ? callColors.controlActiveIcon : callColors.onAction;

  return (
    <View style={styles.slot}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled, selected: active }}
        accessibilityLabel={accessibilityLabel ?? label ?? icon}
        hitSlop={8}
        style={({ pressed }) => [
          styles.button,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: background,
            // Feedback without a layout shift — scaling a round button
            // inside a fixed slot keeps the row from twitching.
            opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
          },
        ]}
      >
        <PoolseIcon name={icon} size={large ? 30 : 25} color={iconColor} label={null} />
      </Pressable>
      {label ? (
        <Text numberOfLines={1} style={styles.label}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Fixed width so captions of different lengths cannot shift the row.
  slot: { width: 76, alignItems: 'center', gap: 7 },
  button: { alignItems: 'center', justifyContent: 'center' },
  label: { color: callColors.textDim, fontSize: 11.5, fontWeight: '500' },
});
