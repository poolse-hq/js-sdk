import type { NativeTheme } from '@poolse/theme';

import type { PoolseRNTheme, ThemeShadows } from './types.js';

// Values mirror the --poolse-* CSS variables in @poolse/react-ui's
// styles.css :root block. If the brand changes there, change here.

const lightColors = {
  brand: '#ff5436',
  brandStrong: '#d63415',
  brandSoft: '#ffe9e2',
  onBrand: '#fbf7f4',
  paper: '#fbf7f4',
  surface: '#ffffff',
  surface2: '#f4eee9',
  ink: '#1c1a19',
  ink2: '#6b6560',
  ink3: '#9a938c',
  border: '#eae3dc',
  presence: '#16c172',
  success: '#16a34a',
  warning: '#e08c16',
  error: '#e5484d',
  info: '#3b82f6',
  selfBubble: '#ff5436',
  selfBubbleText: '#fbf7f4',
  otherBubble: '#ffffff',
  otherBubbleText: '#1c1a19',
  unreadPill: '#ff5436',
  unreadPillText: '#fbf7f4',
};

const darkColors = {
  brand: '#ff6a4d',
  brandStrong: '#ff8366',
  brandSoft: '#2c1712',
  onBrand: '#fbf7f4',
  paper: '#0e0d10',
  surface: '#16141a',
  surface2: '#201d25',
  ink: '#f6f2ee',
  ink2: '#a8a29b',
  ink3: '#766f68',
  border: '#2a2630',
  presence: '#22d37a',
  success: '#34d399',
  warning: '#fbbf24',
  error: '#f87171',
  info: '#60a5fa',
  selfBubble: '#ff6a4d',
  selfBubbleText: '#fbf7f4',
  otherBubble: '#16141a',
  otherBubbleText: '#f6f2ee',
  unreadPill: '#ff6a4d',
  unreadPillText: '#fbf7f4',
};

const type = {
  // RN can't use Bricolage/Hanken/JetBrains without expo-font setup,
  // so we default to the platform sans-serif. Devs override via the
  // theme prop if they ship custom fonts.
  fontDisplay: 'System',
  fontBody: 'System',
  fontMono: 'Menlo',
  bodySize: 15,
  lineHeight: 22,
  weightRegular: '400' as const,
  weightMedium: '500' as const,
  weightSemibold: '600' as const,
  weightBold: '700' as const,
};

const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
  bubble: 18,
};

const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

const lightShadows: ThemeShadows = {
  sm: {
    shadowColor: '#1c1a19',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#1c1a19',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 30,
    elevation: 6,
  },
  lg: {
    shadowColor: '#1c1a19',
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 24 },
    shadowRadius: 60,
    elevation: 12,
  },
};

const darkShadows: ThemeShadows = {
  sm: {
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000000',
    shadowOpacity: 0.55,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 30,
    elevation: 6,
  },
  lg: {
    shadowColor: '#000000',
    shadowOpacity: 0.7,
    shadowOffset: { width: 0, height: 24 },
    shadowRadius: 60,
    elevation: 12,
  },
};

export const defaultLightTheme: PoolseRNTheme = {
  mode: 'light',
  colors: lightColors,
  type,
  radii,
  spacing,
  shadows: lightShadows,
};

export const defaultDarkTheme: PoolseRNTheme = {
  mode: 'dark',
  colors: darkColors,
  type,
  radii,
  spacing,
  shadows: darkShadows,
};

// ── Legacy shape ↔ @poolse/theme tokens ───────────────────────
// Components read the @poolse/theme token names (`useTheme()`). These
// two keep `<PoolseTheme theme={{ colors: { brand } }}>` overrides and
// `usePoolseTheme()` working on top of them.

/** A legacy-shaped theme as `useTheme()` tokens. */
export function legacyToNative(l: PoolseRNTheme): NativeTheme {
  const c = l.colors;
  return {
    id: 'default',
    name: 'Default',
    scheme: l.mode,
    colors: {
      background: c.paper,
      surface: c.surface,
      surfaceAlt: c.surface2,
      text: c.ink,
      textMuted: c.ink2,
      textSubtle: c.ink3,
      border: c.border,
      accent: c.brand,
      accentText: c.onBrand,
      accentSoft: c.brandSoft,
      accentStrong: c.brandStrong,
      // Links in other people's bubbles have always been brand-coloured.
      link: c.brand,
      sidebar: c.surface2,
      sidebarText: c.ink,
      sidebarActive: c.brandSoft,
      sidebarActiveText: c.brandStrong,
      badge: c.unreadPill,
      badgeText: c.unreadPillText,
      mention: c.brandSoft,
      mentionText: c.brandStrong,
      danger: c.error,
      warning: c.warning,
      success: c.success,
      info: c.info,
      presence: c.presence,
      ownBubble: c.selfBubble,
      ownBubbleText: c.selfBubbleText,
      otherBubble: c.otherBubble,
      otherBubbleText: c.otherBubbleText,
      overlay: '#00000073',
    },
    fonts: {
      body: l.type.fontBody,
      display: l.type.fontDisplay,
      mono: l.type.fontMono,
      sizeXs: 11,
      sizeSm: 13,
      sizeMd: l.type.bodySize,
      sizeLg: 17,
      sizeXl: 20,
      lineHeight: l.type.lineHeight,
    },
    radii: { ...l.radii },
    spacing: { ...l.spacing },
    shadows: { sm: l.shadows.sm, md: l.shadows.md, lg: l.shadows.lg },
  };
}

/** `useTheme()` tokens in the legacy shape, for `usePoolseTheme()`. */
export function nativeToLegacy(n: NativeTheme): PoolseRNTheme {
  const c = n.colors;
  return {
    mode: n.scheme,
    colors: {
      brand: c.accent,
      brandStrong: c.accentStrong,
      brandSoft: c.accentSoft,
      onBrand: c.accentText,
      paper: c.background,
      surface: c.surface,
      surface2: c.surfaceAlt,
      ink: c.text,
      ink2: c.textMuted,
      ink3: c.textSubtle,
      border: c.border,
      presence: c.presence,
      success: c.success,
      warning: c.warning,
      error: c.danger,
      info: c.info,
      selfBubble: c.ownBubble,
      selfBubbleText: c.ownBubbleText,
      otherBubble: c.otherBubble,
      otherBubbleText: c.otherBubbleText,
      unreadPill: c.badge,
      unreadPillText: c.badgeText,
    },
    type: {
      ...type,
      fontDisplay: n.fonts.display,
      fontBody: n.fonts.body,
      fontMono: n.fonts.mono,
      bodySize: n.fonts.sizeMd,
      lineHeight: n.fonts.lineHeight,
    },
    radii: { ...n.radii },
    spacing: { ...n.spacing },
    shadows: { ...n.shadows },
  };
}
