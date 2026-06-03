// JS mirror of the @poolse/react-ui CSS-variable surface. Same token
// groups, same names, just typed objects instead of `var(--poolse-*)`.

export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
  brand: string;
  brandStrong: string;
  brandSoft: string;
  onBrand: string;
  paper: string;
  surface: string;
  surface2: string;
  ink: string;
  ink2: string;
  ink3: string;
  border: string;
  presence: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  selfBubble: string;
  selfBubbleText: string;
  otherBubble: string;
  otherBubbleText: string;
  unreadPill: string;
  unreadPillText: string;
}

export interface ThemeType {
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
  bodySize: number;
  lineHeight: number;
  weightRegular: '400';
  weightMedium: '500';
  weightSemibold: '600';
  weightBold: '700';
}

export interface ThemeRadii {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  pill: number;
  bubble: number;
}

export interface ThemeSpacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

export interface ShadowTokens {
  shadowColor: string;
  shadowOpacity: number;
  shadowOffset: { width: number; height: number };
  shadowRadius: number;
  elevation: number;
}

export interface ThemeShadows {
  sm: ShadowTokens;
  md: ShadowTokens;
  lg: ShadowTokens;
}

export interface PoolseRNTheme {
  mode: ThemeMode;
  colors: ThemeColors;
  type: ThemeType;
  radii: ThemeRadii;
  spacing: ThemeSpacing;
  shadows: ThemeShadows;
}

// Overrides are deep-partial; consumers only specify what they want
// to change and we deep-merge over the default theme.
export type PoolseRNThemeOverrides = {
  mode?: ThemeMode;
  colors?: Partial<ThemeColors>;
  type?: Partial<ThemeType>;
  radii?: Partial<ThemeRadii>;
  spacing?: Partial<ThemeSpacing>;
  shadows?: Partial<ThemeShadows>;
};
