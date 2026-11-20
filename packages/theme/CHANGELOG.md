# Changelog

All notable changes to `@poolse/theme` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org).

## [Unreleased]

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
