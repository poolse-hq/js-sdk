// Tokens → plain React Native style values.

import { resolveTheme } from './resolve.js';
import type {
  ColorScheme,
  NativeShadow,
  NativeTheme,
  ShadowToken,
  ThemeInput,
  ThemeTokens,
} from './types.js';

export interface NativeThemeOptions {
  /**
   * Font families to use. The theme's fonts are web font stacks, and
   * React Native fails on a family the app hasn't loaded, so by
   * default the platform fonts are used (`System`, and `Menlo` for
   * code). Pass the names you registered with expo-font to use your own.
   */
  fonts?: Partial<Pick<NativeTheme['fonts'], 'body' | 'display' | 'mono'>>;
}

function nativeShadow(token: ShadowToken): NativeShadow {
  const layer = token.layers[token.layers.length - 1];
  if (!layer) {
    return {
      shadowColor: '#000000',
      shadowOpacity: 0,
      shadowOffset: { width: 0, height: 0 },
      shadowRadius: 0,
      elevation: 0,
    };
  }
  return {
    shadowColor: layer.color,
    shadowOpacity: layer.opacity,
    shadowOffset: { width: layer.x, height: layer.y },
    // RN's radius is roughly half the CSS blur.
    shadowRadius: layer.blur / 2,
    elevation: token.elevation,
  };
}

/** Tokens → React Native values, without resolving a theme first. */
export function tokensToNative(
  t: ThemeTokens,
  identity: { id: string; name: string; scheme: ColorScheme },
  options: NativeThemeOptions = {},
): NativeTheme {
  return {
    ...identity,
    colors: { ...t.colors },
    fonts: {
      body: options.fonts?.body ?? 'System',
      display: options.fonts?.display ?? 'System',
      mono: options.fonts?.mono ?? 'Menlo',
      sizeXs: t.fonts.sizeXs,
      sizeSm: t.fonts.sizeSm,
      sizeMd: t.fonts.sizeMd,
      sizeLg: t.fonts.sizeLg,
      sizeXl: t.fonts.sizeXl,
      lineHeight: Math.round(t.fonts.sizeMd * t.fonts.lineHeight),
    },
    radii: { ...t.radii },
    spacing: { ...t.spacing },
    shadows: {
      sm: nativeShadow(t.shadows.sm),
      md: nativeShadow(t.shadows.md),
      lg: nativeShadow(t.shadows.lg),
    },
  };
}

/** A theme's tokens for one scheme as a plain React Native object. */
export function toNativeTheme(
  theme: ThemeInput,
  scheme: ColorScheme,
  options?: NativeThemeOptions,
): NativeTheme {
  const r = resolveTheme(theme, scheme);
  return tokensToNative(r, { id: r.id, name: r.name, scheme }, options);
}
