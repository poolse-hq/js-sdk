# Changelog

All notable changes to `@poolse/theme` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org).

## [Unreleased]

### Added

- `themeFromBrand({primary, accent?, background?}, {name})` (AD15): a light
  and dark theme from the Workspace branding that keeps every text pair
  at WCAG AA; `ensureContrast`, `mixColors`.

## [3.9.0] - 2026-11-22

- No changes; released with the other `@poolse/*` packages at 3.9.0.

## [3.8.0] - 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.8.0.

## [3.7.1] - 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.7.1.

## [3.7.0] - 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.7.0.

## [3.6.2] - 2026-11-21

### Added

- `tokensFromFlat(tokens)`: turns the Workspace API's flat custom-theme tokens
  (`{name: value}`) into the overrides `createTheme`/`mergeTokens` take. A key
  counts only if it names a `ThemeColors` token and its value is a hex colour
  (#rgb, #rrggbb or #rrggbbaa); anything else falls back to the base theme.

## [3.6.1] - 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.6.1.

## [3.6.0] - 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.6.0.

## [3.5.0] - 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.5.0.

## [3.4.0] - 2026-11-21

### Added

- First release. Typed design tokens (`ThemeColors`, `ThemeFonts`,
  `ThemeRadii`, `ThemeSpacing`, `ThemeShadows`), each `Theme` with a light and
  a dark set.
- Eight built-in themes — `coral` (the default), `ocean`, `forest`, `grape`,
  `slate`, `sunset`, `rose`, `mono` — every text-bearing colour pair at WCAG AA
  (4.5:1) in both schemes.
- `toCssVariables(theme, scheme)` / `toCssText(theme, scheme, selector)` for
  `--poolse-*` CSS variables (including the names `@poolse/react-ui`'s
  stylesheet has always read), `toNativeTheme(theme, scheme)` for React
  Native.
- `encodeTheme` / `decodeTheme`: a custom theme as a short, versioned,
  validated code (`pt1.…`); `ThemeCodeError` says why a code was refused.
- `createTheme`, `getTheme`, `resolveTheme`, `mergeTokens`, and the contrast
  helpers `contrastRatio`, `contrastIssues`, `CONTRAST_PAIRS`.
