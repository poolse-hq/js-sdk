import { BUILT_IN_THEMES, DEFAULT_THEME_ID, isBuiltInThemeId } from './themes.js';
import type {
  BuiltInThemeId,
  ColorScheme,
  ResolvedTheme,
  Theme,
  ThemeInput,
  ThemeTokenOverrides,
  ThemeTokens,
} from './types.js';

/**
 * The theme a `theme` prop names. An unknown id falls back to the
 * default theme rather than throwing — a stale saved preference must
 * not take the UI down.
 */
export function getTheme(input: ThemeInput | null | undefined): Theme {
  if (input && typeof input === 'object') return input;
  if (isBuiltInThemeId(input)) return BUILT_IN_THEMES[input];
  return BUILT_IN_THEMES[DEFAULT_THEME_ID];
}

/** One scheme of a theme, with the theme's id and name. */
export function resolveTheme(
  input: ThemeInput | null | undefined,
  scheme: ColorScheme,
): ResolvedTheme {
  const theme = getTheme(input);
  return { id: theme.id, name: theme.name, scheme, ...theme[scheme] };
}

/** `base` with `overrides` laid over it, group by group. */
export function mergeTokens(base: ThemeTokens, overrides?: ThemeTokenOverrides): ThemeTokens {
  if (!overrides) return base;
  return {
    colors: { ...base.colors, ...overrides.colors },
    fonts: { ...base.fonts, ...overrides.fonts },
    radii: { ...base.radii, ...overrides.radii },
    spacing: { ...base.spacing, ...overrides.spacing },
    shadows: { ...base.shadows, ...overrides.shadows },
  };
}

export interface CreateThemeOptions {
  id: string;
  name: string;
  /** Built-in theme to start from. Defaults to `coral`. */
  extends?: BuiltInThemeId;
  /** Overrides for both schemes, applied before `light` / `dark`. */
  tokens?: ThemeTokenOverrides;
  light?: ThemeTokenOverrides;
  dark?: ThemeTokenOverrides;
}

/**
 * A custom theme: a built-in one with some tokens replaced.
 *
 *     createTheme({ id: 'acme', name: 'Acme', extends: 'ocean',
 *                   tokens: { colors: { accent: '#0a7d5a' } } })
 */
export function createTheme(options: CreateThemeOptions): Theme {
  const baseId = options.extends ?? DEFAULT_THEME_ID;
  const base = BUILT_IN_THEMES[baseId];
  return {
    id: options.id,
    name: options.name,
    extends: baseId,
    light: mergeTokens(mergeTokens(base.light, options.tokens), options.light),
    dark: mergeTokens(mergeTokens(base.dark, options.tokens), options.dark),
  };
}
