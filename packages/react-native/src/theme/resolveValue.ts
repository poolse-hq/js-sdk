// What <PoolseTheme> provides, as a pure function of its props and the
// OS scheme — kept free of react-native imports so it can be unit
// tested in Node.

import {
  isBuiltInThemeId,
  toNativeTheme,
  type ColorScheme,
  type ColorSchemePreference,
  type NativeTheme,
  type NativeThemeOptions,
  type Theme,
  type ThemeInput,
} from '@poolse/theme';

import { defaultDarkTheme, defaultLightTheme, legacyToNative, nativeToLegacy } from './default.js';
import type { PoolseRNTheme, PoolseRNThemeOverrides, ThemeMode } from './types.js';

export interface ThemeValue {
  native: NativeTheme;
  legacy: PoolseRNTheme;
}

export interface ThemeSelection {
  theme?: ThemeInput | PoolseRNThemeOverrides | undefined;
  colorScheme?: ColorSchemePreference | undefined;
  mode?: ThemeMode | undefined;
  fonts?: NativeThemeOptions['fonts'] | undefined;
}

function isTheme(value: unknown): value is Theme {
  return (
    typeof value === 'object' &&
    value !== null &&
    'light' in value &&
    'dark' in value &&
    'id' in value
  );
}

function mergeLegacy(base: PoolseRNTheme, theme: PoolseRNThemeOverrides): PoolseRNTheme {
  return {
    mode: theme.mode ?? base.mode,
    colors: { ...base.colors, ...theme.colors },
    type: { ...base.type, ...theme.type },
    radii: { ...base.radii, ...theme.radii },
    spacing: { ...base.spacing, ...theme.spacing },
    shadows: {
      sm: { ...base.shadows.sm, ...theme.shadows?.sm },
      md: { ...base.shadows.md, ...theme.shadows?.md },
      lg: { ...base.shadows.lg, ...theme.shadows?.lg },
    },
  };
}

/** Whether `theme` names a @poolse/theme theme (rather than a legacy override). */
export function isNamedTheme(theme: ThemeSelection['theme']): theme is ThemeInput {
  return isBuiltInThemeId(theme) || isTheme(theme);
}

/** The scheme a selection resolves to, given the OS's. */
export function selectedScheme(selection: ThemeSelection, system: ColorScheme): ColorScheme {
  const { theme } = selection;
  const named = isNamedTheme(theme);
  const legacyMode = !named && theme ? (theme as PoolseRNThemeOverrides).mode : undefined;
  const preference =
    selection.colorScheme ?? selection.mode ?? legacyMode ?? (named ? 'system' : 'light');
  return preference === 'system' ? system : preference;
}

export function resolveThemeValue(selection: ThemeSelection, scheme: ColorScheme): ThemeValue {
  const { theme, fonts } = selection;
  if (isNamedTheme(theme)) {
    const native = toNativeTheme(theme, scheme, {
      fonts: {
        ...(fonts?.body ? { body: fonts.body } : {}),
        ...(fonts?.display ? { display: fonts.display } : {}),
        ...(fonts?.mono ? { mono: fonts.mono } : {}),
      },
    });
    return { native, legacy: nativeToLegacy(native) };
  }
  const base = scheme === 'dark' ? defaultDarkTheme : defaultLightTheme;
  // The resolved scheme wins over the override's own `mode`.
  const legacy = theme ? { ...mergeLegacy(base, theme), mode: scheme } : base;
  return { native: legacyToNative(legacy), legacy };
}
