// The built-in themes. Each is a small palette per scheme; the rest of
// the colour tokens (bubbles, links, mentions, the sidebar) derive from
// it so the eight themes stay consistent. Every text-bearing pair in
// `CONTRAST_PAIRS` reaches WCAG AA (4.5:1) in both schemes — the test
// suite checks it.

import type {
  BuiltInThemeId,
  ColorScheme,
  Theme,
  ThemeColors,
  ThemeFonts,
  ThemeRadii,
  ThemeShadows,
  ThemeSpacing,
  ThemeTokens,
} from './types.js';

interface Neutrals {
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  border: string;
}

interface Accent {
  accent: string;
  accentText: string;
  accentSoft: string;
  accentStrong: string;
}

// ── Neutrals ──────────────────────────────────────────────────

const warmLight: Neutrals = {
  background: '#fbf7f4',
  surface: '#ffffff',
  surfaceAlt: '#f4eee9',
  text: '#1c1a19',
  textMuted: '#6b6560',
  textSubtle: '#9a938c',
  border: '#eae3dc',
};
const warmDark: Neutrals = {
  background: '#0e0d10',
  surface: '#16141a',
  surfaceAlt: '#201d25',
  text: '#f6f2ee',
  textMuted: '#a8a29b',
  textSubtle: '#766f68',
  border: '#2a2630',
};
const coolLight: Neutrals = {
  background: '#f6f8fb',
  surface: '#ffffff',
  surfaceAlt: '#eef2f7',
  text: '#111827',
  textMuted: '#4b5563',
  textSubtle: '#8a94a3',
  border: '#e2e8f0',
};
const coolDark: Neutrals = {
  background: '#0b0f17',
  surface: '#121826',
  surfaceAlt: '#1b2232',
  text: '#e8edf5',
  textMuted: '#a0aabb',
  textSubtle: '#6b7588',
  border: '#263044',
};
const greenLight: Neutrals = {
  background: '#f6f8f5',
  surface: '#ffffff',
  surfaceAlt: '#edf2ec',
  text: '#142016',
  textMuted: '#4d5b4f',
  textSubtle: '#8b978c',
  border: '#dfe7dd',
};
const greenDark: Neutrals = {
  background: '#0c110d',
  surface: '#131a14',
  surfaceAlt: '#1b241c',
  text: '#e9f1ea',
  textMuted: '#a2b0a4',
  textSubtle: '#6e7c70',
  border: '#263228',
};
const greyLight: Neutrals = {
  background: '#f7f7f7',
  surface: '#ffffff',
  surfaceAlt: '#efefef',
  text: '#111111',
  textMuted: '#555555',
  textSubtle: '#8e8e8e',
  border: '#e2e2e2',
};
const greyDark: Neutrals = {
  background: '#0d0d0d',
  surface: '#161616',
  surfaceAlt: '#202020',
  text: '#f2f2f2',
  textMuted: '#a6a6a6',
  textSubtle: '#707070',
  border: '#2c2c2c',
};

// ── Shared by every theme ─────────────────────────────────────

const semantic: Record<
  ColorScheme,
  Pick<ThemeColors, 'danger' | 'warning' | 'success' | 'info' | 'presence' | 'overlay'>
> = {
  light: {
    danger: '#e5484d',
    warning: '#e08c16',
    success: '#16a34a',
    info: '#3b82f6',
    presence: '#16c172',
    overlay: '#110f0e8c',
  },
  dark: {
    danger: '#f87171',
    warning: '#fbbf24',
    success: '#34d399',
    info: '#60a5fa',
    presence: '#22d37a',
    overlay: '#000000b3',
  },
};

const fonts: ThemeFonts = {
  body: "'Hanken Grotesk', system-ui, -apple-system, sans-serif",
  display: "'Bricolage Grotesque', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  sizeXs: 11,
  sizeSm: 13,
  sizeMd: 15,
  sizeLg: 17,
  sizeXl: 20,
  lineHeight: 1.5,
};

const roundRadii: ThemeRadii = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999, bubble: 18 };
// Slate and mono read as tools rather than chat apps: tighter corners.
const squareRadii: ThemeRadii = { sm: 4, md: 6, lg: 8, xl: 12, pill: 999, bubble: 8 };

const spacing: ThemeSpacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

function shadows(color: string, dark: boolean): ThemeShadows {
  const a = dark ? 2.5 : 1;
  return {
    sm: {
      layers: [{ x: 0, y: 1, blur: 2, spread: 0, color, opacity: Math.min(1, 0.08 * a) }],
      elevation: 1,
    },
    md: {
      layers: [
        { x: 0, y: 1, blur: 2, spread: 0, color, opacity: Math.min(1, 0.06 * a) },
        { x: 0, y: 10, blur: 30, spread: -12, color, opacity: Math.min(1, 0.18 * a) },
      ],
      elevation: 6,
    },
    lg: {
      layers: [
        { x: 0, y: 1, blur: 2, spread: 0, color, opacity: Math.min(1, 0.06 * a) },
        { x: 0, y: 24, blur: 60, spread: -18, color, opacity: Math.min(1, 0.28 * a) },
      ],
      elevation: 12,
    },
  };
}

function tokens(
  scheme: ColorScheme,
  n: Neutrals,
  a: Accent,
  radii: ThemeRadii,
  shadowColor: string,
): ThemeTokens {
  const colors: ThemeColors = {
    ...n,
    ...a,
    link: a.accentStrong,
    sidebar: scheme === 'light' ? n.surfaceAlt : n.surface,
    sidebarText: n.text,
    sidebarActive: a.accentSoft,
    sidebarActiveText: scheme === 'light' ? a.accentStrong : n.text,
    badge: a.accent,
    badgeText: a.accentText,
    mention: a.accentSoft,
    mentionText: a.accentStrong,
    ...semantic[scheme],
    ownBubble: a.accent,
    ownBubbleText: a.accentText,
    otherBubble: n.surface,
    otherBubbleText: n.text,
  };
  return {
    colors,
    fonts,
    radii,
    spacing,
    shadows: shadows(scheme === 'dark' ? '#000000' : shadowColor, scheme === 'dark'),
  };
}

function theme(
  id: BuiltInThemeId,
  name: string,
  neutrals: [Neutrals, Neutrals],
  accents: [Accent, Accent],
  radii: ThemeRadii = roundRadii,
): Theme {
  return {
    id,
    name,
    extends: id,
    light: tokens('light', neutrals[0], accents[0], radii, neutrals[0].text),
    dark: tokens('dark', neutrals[1], accents[1], radii, neutrals[1].text),
  };
}

const WHITE = '#ffffff';

export const BUILT_IN_THEMES: Readonly<Record<BuiltInThemeId, Theme>> = {
  coral: theme(
    'coral',
    'Coral',
    [warmLight, warmDark],
    [
      { accent: '#d9381a', accentText: WHITE, accentSoft: '#ffe9e2', accentStrong: '#b52d10' },
      { accent: '#d9381a', accentText: WHITE, accentSoft: '#2c1712', accentStrong: '#ff8a70' },
    ],
  ),
  ocean: theme(
    'ocean',
    'Ocean',
    [coolLight, coolDark],
    [
      { accent: '#0b63c4', accentText: WHITE, accentSoft: '#e3effc', accentStrong: '#0a56a8' },
      { accent: '#1d6fd6', accentText: WHITE, accentSoft: '#10233d', accentStrong: '#7cb8ff' },
    ],
  ),
  forest: theme(
    'forest',
    'Forest',
    [greenLight, greenDark],
    [
      { accent: '#1f7a3f', accentText: WHITE, accentSoft: '#e2f2e6', accentStrong: '#1a6a36' },
      { accent: '#1f7a3f', accentText: WHITE, accentSoft: '#12291a', accentStrong: '#6fd08f' },
    ],
  ),
  grape: theme(
    'grape',
    'Grape',
    [coolLight, coolDark],
    [
      { accent: '#7c3aed', accentText: WHITE, accentSoft: '#efe7fd', accentStrong: '#6d28d9' },
      { accent: '#7c3aed', accentText: WHITE, accentSoft: '#241640', accentStrong: '#b99bff' },
    ],
  ),
  slate: theme(
    'slate',
    'Slate',
    [coolLight, coolDark],
    [
      { accent: '#475569', accentText: WHITE, accentSoft: '#e7ebf0', accentStrong: '#334155' },
      { accent: '#4b5d78', accentText: WHITE, accentSoft: '#1c2533', accentStrong: '#a9b8cf' },
    ],
    squareRadii,
  ),
  sunset: theme(
    'sunset',
    'Sunset',
    [warmLight, warmDark],
    [
      { accent: '#c2410c', accentText: WHITE, accentSoft: '#ffedd5', accentStrong: '#9a3412' },
      { accent: '#c2410c', accentText: WHITE, accentSoft: '#2e1608', accentStrong: '#ff9f5a' },
    ],
  ),
  rose: theme(
    'rose',
    'Rose',
    [warmLight, warmDark],
    [
      { accent: '#c81e5b', accentText: WHITE, accentSoft: '#fde6ee', accentStrong: '#a3164a' },
      { accent: '#c81e5b', accentText: WHITE, accentSoft: '#2e0f1b', accentStrong: '#ff86b0' },
    ],
  ),
  mono: theme(
    'mono',
    'Mono',
    [greyLight, greyDark],
    [
      { accent: '#1a1a1a', accentText: WHITE, accentSoft: '#ebebeb', accentStrong: '#1a1a1a' },
      { accent: '#f2f2f2', accentText: '#111111', accentSoft: '#2a2a2a', accentStrong: '#f2f2f2' },
    ],
    squareRadii,
  ),
};

/** In the order a theme picker should list them; `coral` first. */
export const BUILT_IN_THEME_IDS: readonly BuiltInThemeId[] = [
  'coral',
  'ocean',
  'forest',
  'grape',
  'slate',
  'sunset',
  'rose',
  'mono',
];

export const DEFAULT_THEME_ID: BuiltInThemeId = 'coral';

export function isBuiltInThemeId(value: unknown): value is BuiltInThemeId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BUILT_IN_THEMES, value);
}
