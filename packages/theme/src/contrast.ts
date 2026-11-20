// WCAG 2.x contrast, for the built-in themes' tests and for apps that
// let people make their own theme.

import type { ColorScheme, Theme, ThemeColors } from './types.js';

/** Parse `#rgb`, `#rrggbb` or `#rrggbbaa` into 0–255 channels (alpha 0–1). */
export function parseHex(hex: string): { r: number; g: number; b: number; a: number } | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

/** WCAG relative luminance of an opaque colour (alpha is ignored). */
export function relativeLuminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) throw new Error(`not a hex colour: ${hex}`);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG contrast ratio between two colours, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The foreground/background pairs that carry text, each of which must
 * reach WCAG AA for body text (4.5:1).
 */
export const CONTRAST_PAIRS: ReadonlyArray<readonly [keyof ThemeColors, keyof ThemeColors]> = [
  ['text', 'background'],
  ['text', 'surface'],
  ['textMuted', 'surface'],
  ['accentText', 'accent'],
  ['accentStrong', 'background'],
  ['link', 'otherBubble'],
  ['ownBubbleText', 'ownBubble'],
  ['otherBubbleText', 'otherBubble'],
  ['sidebarText', 'sidebar'],
  ['sidebarActiveText', 'sidebarActive'],
  ['mentionText', 'mention'],
  ['badgeText', 'badge'],
];

export interface ContrastIssue {
  scheme: ColorScheme;
  foreground: keyof ThemeColors;
  background: keyof ThemeColors;
  ratio: number;
}

/**
 * Every pair in `CONTRAST_PAIRS` below `min` (default 4.5), in both
 * schemes. Empty means the theme passes — use it to warn someone
 * building a custom theme.
 */
export function contrastIssues(theme: Theme, min = 4.5): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    const colors = theme[scheme].colors;
    for (const [fg, bg] of CONTRAST_PAIRS) {
      const ratio = contrastRatio(colors[fg], colors[bg]);
      if (ratio < min) issues.push({ scheme, foreground: fg, background: bg, ratio });
    }
  }
  return issues;
}
