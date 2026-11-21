import { BUILT_IN_THEMES, DEFAULT_THEME_ID } from './themes.js';
import type { ThemeColors, ThemeTokenOverrides } from './types.js';

/**
 * A theme's tokens as one flat map, name → value: the shape the Workspace
 * API stores for a custom appearance (`theme: { tokens: { accent: '#…' } }`).
 */
export type FlatThemeTokens = Readonly<Record<string, unknown>>;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_NAMES = new Set<string>(Object.keys(BUILT_IN_THEMES[DEFAULT_THEME_ID].light.colors));

/**
 * Turn flat tokens into the overrides `createTheme`/`mergeTokens` take.
 * A key counts only if it names a colour token (`ThemeColors`) and its
 * value is a hex colour (#rgb, #rrggbb or #rrggbbaa); anything else is
 * dropped, so that token falls back to the base theme. Returns `{}` when
 * nothing counts.
 */
export function tokensFromFlat(tokens: FlatThemeTokens | null | undefined): ThemeTokenOverrides {
  const colors: Partial<ThemeColors> = {};
  for (const [name, value] of Object.entries(tokens ?? {})) {
    if (COLOR_NAMES.has(name) && typeof value === 'string' && HEX.test(value)) {
      (colors as Record<string, string>)[name] = value;
    }
  }
  return Object.keys(colors).length > 0 ? { colors } : {};
}
