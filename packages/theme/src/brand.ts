// A theme from a workspace's brand (AD15): the colours an admin set in
// the Workspace (`GET /branding` → `{name, colors: {primary, accent,
// background?}}`) turned into a full light and dark theme. Every text
// pair still reaches WCAG AA: colours that are too light or too dark for
// text are darkened or lightened until they do.

import { contrastRatio, parseHex } from './contrast.js';
import { createTheme } from './resolve.js';
import type { BuiltInThemeId, Theme, ThemeColors, ThemeTokenOverrides } from './types.js';
import { BUILT_IN_THEMES } from './themes.js';

export interface BrandColors {
  /** Buttons, badges, your own bubbles. `#rrggbb`. */
  primary: string;
  /** Links and highlights. Defaults to `primary`. */
  accent?: string | null;
  /** Light-scheme page background; ignored when text wouldn't read on it. */
  background?: string | null;
}

export interface BrandThemeOptions {
  /** Theme id; default `brand`. */
  id?: string;
  /** Shown name; default the brand name. */
  name?: string;
  /** Built-in theme for neutrals, fonts and radii. Default `coral`. */
  extends?: BuiltInThemeId;
}

type Rgb = { r: number; g: number; b: number };

function rgb(hex: string): Rgb | null {
  const c = parseHex(hex);
  return c ? { r: c.r, g: c.g, b: c.b } : null;
}

function hex({ r, g, b }: Rgb): string {
  const h = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** `a` moved toward `b` by `t` (0–1). */
export function mixColors(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) throw new Error(`not a hex colour: ${x ? b : a}`);
  return hex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

/**
 * `color`, darkened (toward black) or lightened (toward white) in small
 * steps until it reaches `min` contrast against `background`.
 */
export function ensureContrast(color: string, background: string, min = 4.5): string {
  if (contrastRatio(color, background) >= min) return color;
  const towards =
    contrastRatio('#000000', background) >= contrastRatio('#ffffff', background)
      ? '#000000'
      : '#ffffff';
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mixColors(color, towards, t);
    if (contrastRatio(c, background) >= min) return c;
  }
  return towards;
}

/** White or near-black, whichever reads better on `fill`. */
function textOn(fill: string): string {
  return contrastRatio('#ffffff', fill) >= contrastRatio('#111111', fill) ? '#ffffff' : '#111111';
}

/** A fill of `color` that `textOn` can reach AA on (darkened/lightened when needed). */
function fillFor(color: string): string {
  if (Math.max(contrastRatio('#ffffff', color), contrastRatio('#111111', color)) >= 4.5)
    return color;
  return ensureContrast(color, '#ffffff', 4.5);
}

function schemeColors(
  primary: string,
  accent: string,
  base: ThemeColors,
  dark: boolean,
): Partial<ThemeColors> {
  const bg = base.background;
  const fill = fillFor(primary);
  const onFill = textOn(fill);
  const strong = ensureContrast(dark ? mixColors(accent, '#ffffff', 0.35) : accent, bg);
  const soft = mixColors(bg, primary, dark ? 0.22 : 0.12);
  const linkOn = ensureContrast(strong, base.otherBubble);
  return {
    accent: fill,
    accentText: onFill,
    accentSoft: soft,
    accentStrong: strong,
    link: linkOn,
    sidebarActive: soft,
    sidebarActiveText: dark ? base.text : ensureContrast(strong, soft),
    badge: fill,
    badgeText: onFill,
    mention: soft,
    mentionText: ensureContrast(strong, soft),
    ownBubble: fill,
    ownBubbleText: onFill,
  };
}

/**
 * The brand's theme. Invalid colours fall back to the base theme's, so a
 * stale or half-filled branding never breaks the UI.
 *
 *     const brand = await ws.get('/branding');
 *     <PoolseTheme theme={themeFromBrand(brand.colors, { name: brand.name })}>
 */
export function themeFromBrand(colors: BrandColors, options: BrandThemeOptions = {}): Theme {
  const baseId = options.extends ?? 'coral';
  const base = BUILT_IN_THEMES[baseId];
  const primary = rgb(colors.primary) ? colors.primary : base.light.colors.accent;
  const accent = colors.accent && rgb(colors.accent) ? colors.accent : primary;
  const light: ThemeTokenOverrides = {
    colors: schemeColors(primary, accent, base.light.colors, false),
  };
  if (colors.background && rgb(colors.background)) {
    const bg = colors.background;
    const t = base.light.colors;
    const fits =
      contrastRatio(t.text, bg) >= 4.5 && contrastRatio(light.colors!.accentStrong!, bg) >= 4.5;
    if (fits) light.colors = { ...light.colors, background: bg };
  }
  return createTheme({
    id: options.id ?? 'brand',
    name: options.name ?? 'Brand',
    extends: baseId,
    light,
    dark: { colors: schemeColors(primary, accent, base.dark.colors, true) },
  });
}
