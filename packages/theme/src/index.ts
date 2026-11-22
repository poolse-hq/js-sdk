// @poolse/theme — design tokens for the poolse UI packages.
//
//   * `BUILT_IN_THEMES` — eight themes, each with a light and a dark
//     set of tokens; `coral` is the default.
//   * `toCssVariables` / `toCssText` — tokens as `--poolse-*` CSS
//     variables (what @poolse/react-ui's `<PoolseTheme>` applies).
//   * `toNativeTheme` — tokens as a plain React Native object (what
//     @poolse/react-native's `useTheme()` returns).
//   * `encodeTheme` / `decodeTheme` — a custom theme as a short code.
//
// No dependencies and no React: safe to import on a server.

export type {
  BuiltInThemeId,
  ColorScheme,
  ColorSchemePreference,
  NativeShadow,
  NativeTheme,
  ResolvedTheme,
  ShadowLayer,
  ShadowToken,
  Theme,
  ThemeColors,
  ThemeFonts,
  ThemeInput,
  ThemeRadii,
  ThemeShadows,
  ThemeSpacing,
  ThemeTokenOverrides,
  ThemeTokens,
} from './types.js';
export {
  BUILT_IN_THEMES,
  BUILT_IN_THEME_IDS,
  DEFAULT_THEME_ID,
  isBuiltInThemeId,
} from './themes.js';
export {
  createTheme,
  getTheme,
  mergeTokens,
  resolveTheme,
  type CreateThemeOptions,
} from './resolve.js';
export {
  cssShadow,
  toCssText,
  toCssVariables,
  tokensToCssVariables,
  type CssVariableOptions,
} from './css.js';
export { toNativeTheme, tokensToNative, type NativeThemeOptions } from './native.js';
export { decodeTheme, encodeTheme, ThemeCodeError } from './code.js';
export { tokensFromFlat, type FlatThemeTokens } from './flat.js';
export {
  CONTRAST_PAIRS,
  contrastIssues,
  contrastRatio,
  parseHex,
  relativeLuminance,
  type ContrastIssue,
} from './contrast.js';
export {
  ensureContrast,
  mixColors,
  themeFromBrand,
  type BrandColors,
  type BrandThemeOptions,
} from './brand.js';
