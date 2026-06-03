import { Platform } from 'react-native';

// Lazy-resolve react-native-safe-area-context. Returns the real
// hook when available + a SafeAreaProvider is mounted; falls back
// to platform-typical iOS values otherwise. Used ONLY for computing
// keyboardVerticalOffset — never for adding safe-area padding to
// chrome (consumers' root SafeAreaView already handles that, and
// double-padding caused the earlier 0.1.6 bug).

export interface EdgeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const FALLBACK: EdgeInsets = {
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
  // Optional dep — only resolved when the host app installs
  // react-native-safe-area-context. Wrapped in try/catch so the
  // bundle still works without it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('react-native-safe-area-context') as SafeAreaModule;
  if (mod && typeof mod.useSafeAreaInsets === 'function') {
    realHook = mod.useSafeAreaInsets;
  }
} catch {
  /* not installed — fallback */
}

const useFallback = (): EdgeInsets => FALLBACK;

export const useSafeInsets: () => EdgeInsets = realHook ?? useFallback;
