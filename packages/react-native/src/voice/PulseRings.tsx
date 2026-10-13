import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

/**
 * Concentric rings breathing outward from the avatar while a call
 * rings — the oldest signal in telephony, drawn instead of implied.
 * Three staggered loops; each ring scales up and fades as it goes.
 *
 * Driven by the native driver (transform + opacity only), so it costs
 * nothing on the JS thread while the call machinery works.
 */
export function PulseRings({ size, color }: { size: number; color: string }) {
  const phases = [useRef(new Animated.Value(0)), useRef(new Animated.Value(0)), useRef(new Animated.Value(0))];

  useEffect(() => {
    const loops = phases.map((p, i) => {
      p.current.setValue(0);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.delay(i * 700),
          Animated.timing(p.current, {
            toValue: 1,
            duration: 2100,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          // Restart the stagger from zero so the rings stay evenly
          // spaced instead of bunching after the first cycle.
          Animated.timing(p.current, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return loop;
    });
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
      {phases.map((p, i) => (
        <Animated.View
          key={i}
          style={[
            styles.ring,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: color,
              opacity: p.current.interpolate({
                inputRange: [0, 0.15, 1],
                outputRange: [0, 0.45, 0],
              }),
              transform: [
                {
                  scale: p.current.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 1.5 },
});
