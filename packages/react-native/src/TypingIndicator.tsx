import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, Easing } from 'react-native';

import { useDisplayName } from './UserName.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface TypingIndicatorProps {
  /** Set of `external_id`s currently typing — what `useTyping` returns. */
  typing: Set<string>;
  /**
   * Resolves an `external_id` to a display label. Defaults to the
   * SDK's `userResolver` (and falls back to the external_id itself
   * when the resolver isn't configured).
   */
  labelFor?: (externalId: string) => string;
}

/**
 * Three animated dots + an inline "X is typing" label. Renders a
 * zero-height row when nobody is typing so the list doesn't jump.
 */
export function TypingIndicator({ typing, labelFor }: TypingIndicatorProps) {
  const ids = Array.from(typing);
  const isTyping = ids.length > 0;

  if (!isTyping) return <View style={{ height: 0 }} />;

  return (
    <View style={styles.row}>
      <TypingDots />
      <TypingLabel ids={ids} {...(labelFor ? { labelFor } : {})} />
    </View>
  );
}

function TypingDots() {
  const theme = usePoolseTheme();
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 1,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(val, {
            toValue: 0,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
    const animations = [loop(a, 0), loop(b, 150), loop(c, 300)];
    animations.forEach((anim) => anim.start());
    return () => animations.forEach((anim) => anim.stop());
  }, [a, b, c]);

  const dot = (val: Animated.Value) => ({
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.ink3,
    marginHorizontal: 2,
    transform: [
      {
        translateY: val.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }),
      },
    ],
    opacity: val.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
  });

  return (
    <View style={styles.dotsWrap}>
      <Animated.View style={dot(a)} />
      <Animated.View style={dot(b)} />
      <Animated.View style={dot(c)} />
    </View>
  );
}

function TypingLabel({
  ids,
  labelFor,
}: {
  ids: string[];
  labelFor?: (externalId: string) => string;
}) {
  const theme = usePoolseTheme();
  const id1 = ids[0] ?? null;
  const id2 = ids[1] ?? null;
  const name1 = useDisplayName(id1, labelFor);
  const name2 = useDisplayName(id2, labelFor);

  const text =
    ids.length === 1
      ? `${name1} is typing`
      : ids.length === 2
        ? `${name1} and ${name2} are typing`
        : `${ids.length} people are typing`;

  return (
    <Text style={[styles.label, { color: theme.colors.ink2, fontFamily: theme.type.fontBody }]}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  dotsWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginRight: 8,
    height: 12,
  },
  label: {
    fontSize: 12,
  },
});
