import { Platform } from 'react-native';

// Lazy-resolve `react-native-safe-area-context` if the consumer
// installed it (Expo apps almost always have it via expo-status-bar /
// @react-navigation transitively). Resolved ONCE at module load so
// the hook reference is stable — calling it conditionally would
// violate Rules of Hooks. Fall back to Platform-aware iOS defaults
// when the module is missing OR no SafeAreaProvider is mounted.

export interface EdgeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const FALLBACK_INSETS: EdgeInsets = {
  top: Platform.OS === 'ios' ? 50 : 24,
  bottom: Platform.OS === 'ios' ? 34 : 0,
  left: 0,
  right: 0,
};

type SafeAreaModule = {
  useSafeAreaInsets?: () => EdgeInsets;
};

let realHook: (() => EdgeInsets) | null = null;
try {
  const mod = require('react-native-safe-area-context') as SafeAreaModule;
  if (mod && typeof mod.useSafeAreaInsets === 'function') {
    realHook = mod.useSafeAreaInsets;
  }
} catch {
  /* safe-area-context not installed — fallback path below */
}

const useFallbackInsets = (): EdgeInsets => FALLBACK_INSETS;

/**
 * Returns the device's safe-area insets. When
 * `react-native-safe-area-context` is installed AND a
 * `<SafeAreaProvider>` is mounted above (Expo Router does this by
 * default), returns the real measured insets. Otherwise returns
 * Platform-aware defaults so chrome doesn't collide with the notch /
 * home indicator out of the box.
 */
export const useSafeInsets: () => EdgeInsets = realHook ?? useFallbackInsets;
