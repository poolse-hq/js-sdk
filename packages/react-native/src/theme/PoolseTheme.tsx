import type {
  ColorSchemePreference,
  NativeTheme,
  NativeThemeOptions,
  ThemeInput,
} from '@poolse/theme';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { defaultLightTheme, legacyToNative } from './default.js';
import { resolveThemeValue, selectedScheme, type ThemeValue } from './resolveValue.js';
import type { PoolseRNTheme, PoolseRNThemeOverrides, ThemeMode } from './types.js';

const ThemeContext = createContext<ThemeValue | null>(null);

const FALLBACK: ThemeValue = {
  native: legacyToNative(defaultLightTheme),
  legacy: defaultLightTheme,
};

export interface PoolseThemeProps {
  /**
   * A built-in theme's id (`'coral'`, `'ocean'`, `'forest'`, `'grape'`,
   * `'slate'`, `'sunset'`, `'rose'`, `'mono'`) or a whole `Theme` from
   * `@poolse/theme` (`createTheme`, `decodeTheme`).
   *
   * Still accepted, deprecated: a partial legacy override such as
   * `{ colors: { brand: '#000' } }`, deep-merged over the default
   * palette as before.
   */
  theme?: ThemeInput | PoolseRNThemeOverrides;
  /**
   * `'light'`, `'dark'`, or `'system'` to follow the OS (live). Defaults
   * to `'system'` when `theme` is a built-in id or a `Theme`; otherwise
   * to `mode`, then `'light'`, as before.
   */
  colorScheme?: ColorSchemePreference;
  /** @deprecated Use `colorScheme`. */
  mode?: ThemeMode;
  /**
   * Font families for a `theme` (React Native can't use the web font
   * stacks). Defaults to the platform fonts; pass the names you loaded
   * with expo-font.
   */
  fonts?: NativeThemeOptions['fonts'];
  children: ReactNode;
}

/**
 * Themes everything inside it. Switching `theme` or `colorScheme`
 * re-renders with the new tokens; nothing remounts.
 */
export function PoolseTheme({ theme, colorScheme, mode, fonts, children }: PoolseThemeProps) {
  const system = useColorScheme() === 'dark' ? 'dark' : 'light';
  const scheme = selectedScheme({ theme, colorScheme, mode }, system);
  const fontBody = fonts?.body;
  const fontDisplay = fonts?.display;
  const fontMono = fonts?.mono;
  const value = useMemo(
    () =>
      resolveThemeValue(
        {
          theme,
          fonts: {
            ...(fontBody ? { body: fontBody } : {}),
            ...(fontDisplay ? { display: fontDisplay } : {}),
            ...(fontMono ? { mono: fontMono } : {}),
          },
        },
        scheme,
      ),
    [theme, scheme, fontBody, fontDisplay, fontMono],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * The active theme's tokens (`@poolse/theme` names: `colors.accent`,
 * `fonts.body`, `radii.bubble`, …) for the active scheme. Without a
 * `<PoolseTheme>` ancestor: the default light palette.
 */
export function useTheme(): NativeTheme {
  return (useContext(ThemeContext) ?? FALLBACK).native;
}

/**
 * @deprecated Use `useTheme()`. The active theme in the original shape
 * (`colors.brand`, `colors.ink`, `type.fontBody`, …).
 */
export function usePoolseTheme(): PoolseRNTheme {
  return (useContext(ThemeContext) ?? FALLBACK).legacy;
}
