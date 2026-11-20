// Token types shared by every poolse UI package. One `Theme` carries a
// light and a dark set of tokens; the web package turns a set into
// `--poolse-*` CSS variables, the React Native package into a plain
// object (`NativeTheme`).

export type ColorScheme = 'light' | 'dark';
/** What a provider takes: a fixed scheme, or follow the OS. */
export type ColorSchemePreference = ColorScheme | 'system';

/**
 * Every colour is a hex string: `#rrggbb`, or `#rrggbbaa` where
 * transparency matters (`overlay`).
 */
export interface ThemeColors {
  /** Page / chat-pane background. */
  background: string;
  /** Cards, panels, inputs on top of `background`. */
  surface: string;
  /** Insets, fields, hover fills. */
  surfaceAlt: string;
  /** Primary text. */
  text: string;
  /** Secondary text (timestamps, previews). */
  textMuted: string;
  /** Hints and placeholders — decorative, not for text that must be read. */
  textSubtle: string;
  border: string;
  /** Primary action fill (buttons, badges, the unread pill). */
  accent: string;
  /** Foreground on `accent`. */
  accentText: string;
  /** Tinted fills: selected rows, highlights. */
  accentSoft: string;
  /** Accent as text on `background` / `surface`. */
  accentStrong: string;
  /** Links in message bodies. */
  link: string;
  /** App sidebar / rail (the workspace apps; the chat UI doesn't draw one). */
  sidebar: string;
  sidebarText: string;
  /** Selected sidebar item fill. */
  sidebarActive: string;
  sidebarActiveText: string;
  /** Unread-count badges. */
  badge: string;
  badgeText: string;
  /** Background of an @-mention chip and of a message that mentions the viewer. */
  mention: string;
  mentionText: string;
  danger: string;
  warning: string;
  success: string;
  info: string;
  /** Online dot. */
  presence: string;
  ownBubble: string;
  ownBubbleText: string;
  otherBubble: string;
  otherBubbleText: string;
  /** Scrim behind sheets, lightboxes and drop targets. */
  overlay: string;
}

export interface ThemeFonts {
  /** CSS font-family list on the web; the first family is what React Native uses. */
  body: string;
  display: string;
  mono: string;
  /** Font sizes in px. `sizeMd` is the message body. */
  sizeXs: number;
  sizeSm: number;
  sizeMd: number;
  sizeLg: number;
  sizeXl: number;
  /** Unitless line-height multiplier for body text. */
  lineHeight: number;
}

/** Corner radii in px. */
export interface ThemeRadii {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  pill: number;
  /** Chat bubbles. */
  bubble: number;
}

/** Spacing steps in px. */
export interface ThemeSpacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

export interface ShadowLayer {
  x: number;
  y: number;
  blur: number;
  spread: number;
  /** `#rrggbb`. */
  color: string;
  /** 0–1. */
  opacity: number;
}

/**
 * The web draws every layer; React Native draws the last one (the
 * largest, by convention) and uses `elevation` on Android.
 */
export interface ShadowToken {
  layers: ShadowLayer[];
  elevation: number;
}

export interface ThemeShadows {
  sm: ShadowToken;
  md: ShadowToken;
  lg: ShadowToken;
}

/** One colour scheme's worth of tokens. */
export interface ThemeTokens {
  colors: ThemeColors;
  fonts: ThemeFonts;
  radii: ThemeRadii;
  spacing: ThemeSpacing;
  shadows: ThemeShadows;
}

export type BuiltInThemeId =
  | 'coral'
  | 'ocean'
  | 'forest'
  | 'grape'
  | 'slate'
  | 'sunset'
  | 'rose'
  | 'mono';

export interface Theme {
  /** Lowercase letters, digits and dashes. */
  id: string;
  name: string;
  /** The built-in theme this one was made from — what `encodeTheme` diffs against. */
  extends?: BuiltInThemeId;
  light: ThemeTokens;
  dark: ThemeTokens;
}

/** What the `theme` prop takes: a built-in theme's id, or a whole theme. */
export type ThemeInput = BuiltInThemeId | Theme;

/** A theme's tokens for one scheme, with the theme's identity. */
export interface ResolvedTheme extends ThemeTokens {
  id: string;
  name: string;
  scheme: ColorScheme;
}

/** Only the tokens you set replace the base theme's. */
export interface ThemeTokenOverrides {
  colors?: Partial<ThemeColors>;
  fonts?: Partial<ThemeFonts>;
  radii?: Partial<ThemeRadii>;
  spacing?: Partial<ThemeSpacing>;
  shadows?: Partial<ThemeShadows>;
}

/** A React Native shadow style. */
export interface NativeShadow {
  shadowColor: string;
  shadowOpacity: number;
  shadowOffset: { width: number; height: number };
  shadowRadius: number;
  elevation: number;
}

/** A resolved theme as React Native style values. */
export interface NativeTheme {
  id: string;
  name: string;
  scheme: ColorScheme;
  colors: ThemeColors;
  fonts: {
    /** A single family name (React Native takes no fallback list). */
    body: string;
    display: string;
    mono: string;
    sizeXs: number;
    sizeSm: number;
    sizeMd: number;
    sizeLg: number;
    sizeXl: number;
    /** Body line height in px. */
    lineHeight: number;
  };
  radii: ThemeRadii;
  spacing: ThemeSpacing;
  shadows: { sm: NativeShadow; md: NativeShadow; lg: NativeShadow };
}
